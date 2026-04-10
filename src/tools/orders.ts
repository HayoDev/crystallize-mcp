/**
 * Order tools — list and inspect orders.
 */

import { z } from 'zod';
import type { CrystallizeClient } from '../client.js';
import type { ToolDefinition } from '../types.js';
import { maskEmail } from '../pii.js';

export function orderTools(client: CrystallizeClient): ToolDefinition[] {
  return [
    {
      name: 'list_orders',
      description:
        'List orders across the tenant, optionally filtered by customerIdentifier. Returns order IDs, dates, totals, and deep links to the Crystallize UI. Supports pagination.',
      schema: {
        customerIdentifier: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Customer identifier (email or unique ID) — omit to list all orders',
          ),
        first: z.number().default(20).describe('Max orders to return'),
        after: z
          .string()
          .optional()
          .describe('Pagination cursor from a previous response'),
      },
      handler: async params => {
        const { customerIdentifier, first, after } = params;

        const query = `
          query ListOrders($customerIdentifier: String, $first: Int, $after: String) {
            orders {
              getAll(customerIdentifier: $customerIdentifier, first: $first, after: $after) {
                pageInfo {
                  hasNextPage
                  hasPreviousPage
                  startCursor
                  endCursor
                  totalNodes
                }
                edges {
                  node {
                    id
                    createdAt
                    updatedAt
                    customer {
                      identifier
                      firstName
                      lastName
                    }
                    total {
                      gross
                      net
                      currency
                    }
                  }
                }
              }
            }
          }
        `;

        const data = await client.api.orderApi(query, {
          customerIdentifier,
          first,
          after,
        });
        const result = (data as OrdersListResponse).orders?.getAll;

        if (!result) {
          return {
            content: [
              {
                type: 'text',
                text: customerIdentifier
                  ? `No orders found for customer "${customerIdentifier}"`
                  : 'No orders found.',
              },
            ],
          };
        }

        const orders = (result.edges ?? []).map(e => e.node);

        if (orders.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: customerIdentifier
                  ? `No orders found for customer "${customerIdentifier}"`
                  : 'No orders found.',
              },
            ],
          };
        }

        const total = result.pageInfo.totalNodes ?? orders.length;
        const pii = client.config.piiMode;

        let displayIdentifier = customerIdentifier;
        if (
          customerIdentifier &&
          pii !== 'full' &&
          customerIdentifier.includes('@')
        ) {
          displayIdentifier = maskEmail(customerIdentifier);
        }

        const lines: string[] = [
          customerIdentifier
            ? `Orders for "${displayIdentifier}" (${orders.length} of ${total}):`
            : `Orders (${orders.length} of ${total}):`,
          '',
        ];

        for (const order of orders) {
          lines.push(`Order ${order.id}`);
          lines.push(`  Created: ${order.createdAt}`);
          if (pii !== 'none') {
            const name = [order.customer?.firstName, order.customer?.lastName]
              .filter(Boolean)
              .join(' ');
            if (name) {
              lines.push(`  Customer: ${name}`);
            }
          }
          if (order.total) {
            lines.push(
              `  Total: ${order.total.gross} ${order.total.currency} (net: ${order.total.net})`,
            );
          }
          lines.push(`  Edit: ${client.orderLink(order.id)}`);
          lines.push('');
        }

        if (result.pageInfo.hasNextPage && result.pageInfo.endCursor) {
          lines.push(`Next page cursor: ${result.pageInfo.endCursor}`);
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      },
    },

    {
      name: 'get_order',
      description:
        'Get full details for an order by ID. Returns cart items, customer info, totals, payment provider, and a deep link to the Crystallize UI.',
      schema: {
        id: z.string().describe('Order ID'),
      },
      handler: async params => {
        const { id } = params;

        const query = `
          query GetOrder($id: ID!) {
            orders {
              get(id: $id) {
                id
                createdAt
                updatedAt
                customer {
                  identifier
                  firstName
                  lastName
                  addresses {
                    type
                    street
                    city
                    country
                    email
                    phone
                  }
                }
                cart {
                  name
                  sku
                  quantity
                  imageUrl
                  price {
                    gross
                    net
                    discounts { percent }
                  }
                }
                total {
                  gross
                  net
                  currency
                  tax { name percent }
                }
                payment {
                  __typename
                  ... on CustomPayment { provider }
                }
              }
            }
          }
        `;

        const data = await client.api.orderApi(query, { id });
        const order = (data as OrderGetResponse).orders?.get;

        if (!order) {
          return {
            content: [{ type: 'text', text: `Order "${id}" not found.` }],
            isError: true,
          };
        }

        const lines: string[] = [
          `Order ${order.id}`,
          `  Created: ${order.createdAt}`,
          `  Updated: ${order.updatedAt}`,
          `  Edit: ${client.orderLink(order.id)}`,
        ];

        const pii = client.config.piiMode;

        if (order.customer) {
          const c = order.customer;
          lines.push('');
          const maskedId =
            pii !== 'full' && c.identifier.includes('@')
              ? maskEmail(c.identifier)
              : c.identifier;
          if (pii === 'none') {
            lines.push(`Customer: ${maskedId}`);
          } else {
            const name = [c.firstName, c.lastName].filter(Boolean).join(' ');
            lines.push(`Customer: ${name || maskedId} (${maskedId})`);
            for (const addr of c.addresses ?? []) {
              if (pii === 'masked') {
                const addrStr = [addr.city, addr.country]
                  .filter(Boolean)
                  .join(', ');
                lines.push(`  ${addr.type}: ${addrStr || '(masked)'}`);
              } else {
                const addrStr = [addr.street, addr.city, addr.country]
                  .filter(Boolean)
                  .join(', ');
                lines.push(`  ${addr.type}: ${addrStr}`);
                if (addr.email) {
                  lines.push(`    Email: ${addr.email}`);
                }
                if (addr.phone) {
                  lines.push(`    Phone: ${addr.phone}`);
                }
              }
            }
          }
        }

        if (order.cart?.length) {
          lines.push('');
          lines.push(`Cart (${order.cart.length} item(s)):`);
          for (const item of order.cart) {
            lines.push(`  ${item.name ?? item.sku} × ${item.quantity}`);
            lines.push(`    SKU: ${item.sku}`);
            if (item.price) {
              lines.push(
                `    Price: ${item.price.gross} (net: ${item.price.net})`,
              );
            }
          }
        }

        if (order.total) {
          lines.push('');
          lines.push(
            `Total: ${order.total.gross} ${order.total.currency} (net: ${order.total.net})`,
          );
          if (order.total.tax) {
            lines.push(
              `  Tax: ${order.total.tax.name} ${order.total.tax.percent}%`,
            );
          }
        }

        if (order.payment?.length) {
          const providers = order.payment
            .map(p => p.provider ?? p.__typename ?? 'unknown')
            .join(', ');
          lines.push('');
          lines.push(`Payment: ${providers}`);
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      },
    },
  ];
}

// --- Internal types ---

interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string;
  endCursor?: string;
  totalNodes?: number;
}

interface OrderCustomer {
  identifier: string;
  firstName?: string;
  lastName?: string;
  addresses?: AddressNode[];
}

interface AddressNode {
  type: string;
  street?: string;
  city?: string;
  country?: string;
  email?: string;
  phone?: string;
}

interface CartItem {
  name?: string;
  sku: string;
  quantity: number;
  imageUrl?: string;
  price?: { gross: number; net: number };
}

interface OrderSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  customer?: OrderCustomer;
  total?: { gross: number; net: number; currency: string };
}

interface OrderDetail extends OrderSummary {
  cart?: CartItem[];
  total?: {
    gross: number;
    net: number;
    currency: string;
    tax?: { name: string; percent: number };
  };
  payment?: { provider?: string; __typename?: string }[];
}

interface OrdersListResponse {
  orders?: {
    getAll?: {
      pageInfo: PageInfo;
      edges: { node: OrderSummary }[];
    };
  };
}

interface OrderGetResponse {
  orders?: {
    get?: OrderDetail;
  };
}
