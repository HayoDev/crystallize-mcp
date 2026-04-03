/**
 * Customer tools — search and inspect customers.
 */

import { z } from 'zod';
import type { CrystallizeClient } from '../client.js';
import type { ToolDefinition } from '../types.js';
import { maskEmail, maskPhone } from '../pii.js';

export function customerTools(client: CrystallizeClient): ToolDefinition[] {
  return [
    {
      name: 'list_customers',
      description:
        'Search and list customers in the tenant. Supports filtering by name or email. Returned fields depend on CRYSTALLIZE_PII_MODE: full (default) returns all contact data, masked returns partial email/phone and city+country only, none returns identifiers only.',
      schema: {
        searchTerm: z
          .string()
          .optional()
          .describe('Filter customers by name or email (partial match)'),
        first: z.number().default(20).describe('Max customers to return'),
        after: z
          .string()
          .optional()
          .describe('Pagination cursor from a previous response'),
      },
      handler: async params => {
        const { searchTerm, first, after } = params;

        const filterArg = searchTerm
          ? `, filter: { searchTerm: "${searchTerm}" }`
          : '';
        const afterArg = after ? `, after: "${after}"` : '';

        const query = `
          query ListCustomers($tenantId: ID!, $first: Int) {
            customer {
              getMany(
                tenantId: $tenantId
                first: $first${afterArg}${filterArg}
              ) {
                pageInfo {
                  hasNextPage
                  hasPreviousPage
                  startCursor
                  endCursor
                  totalNodes
                }
                edges {
                  node {
                    identifier
                    firstName
                    lastName
                    email
                    companyName
                    phone
                  }
                }
              }
            }
          }
        `;

        const data = await client.api.pimApi(query, {
          tenantId: client.config.tenantId,
          first,
        });
        const result = (data as CustomerListResponse).customer?.getMany;

        if (!result) {
          return {
            content: [
              {
                type: 'text',
                text: `No customers found${searchTerm ? ` matching "${searchTerm}"` : ''}.`,
              },
            ],
          };
        }

        const customers = result.edges.map(e => e.node);

        if (customers.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No customers found${searchTerm ? ` matching "${searchTerm}"` : ''}.`,
              },
            ],
          };
        }

        const total = result.pageInfo.totalNodes ?? customers.length;
        const lines: string[] = [
          `Customers (${customers.length} of ${total}):`,
          '',
        ];

        const pii = client.config.piiMode;

        for (const c of customers) {
          if (pii === 'none') {
            lines.push(`${c.identifier}`);
          } else {
            const name = [c.firstName, c.lastName].filter(Boolean).join(' ');
            lines.push(`${name || c.identifier} (${c.identifier})`);
            if (c.email) {
              lines.push(
                `  Email: ${pii === 'masked' ? maskEmail(c.email) : c.email}`,
              );
            }
            if (c.companyName) {
              lines.push(`  Company: ${c.companyName}`);
            }
            if (c.phone) {
              lines.push(
                `  Phone: ${pii === 'masked' ? maskPhone(c.phone) : c.phone}`,
              );
            }
          }
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
      name: 'get_customer',
      description:
        'Get full profile for a customer by their identifier (UUID from list_customers). Returns name, email, addresses, meta, and external references.',
      schema: {
        identifier: z
          .string()
          .describe('Customer identifier UUID — use list_customers to find it'),
      },
      handler: async params => {
        const { identifier } = params;

        const query = `
          query GetCustomer($identifier: String!, $tenantId: ID!) {
            customer {
              get(identifier: $identifier, tenantId: $tenantId) {
                identifier
                firstName
                lastName
                email
                companyName
                phone
                taxNumber
                birthDate
                meta {
                  key
                  value
                }
                externalReferences {
                  key
                  value
                }
                addresses {
                  type
                  firstName
                  lastName
                  street
                  street2
                  streetNumber
                  city
                  state
                  postalCode
                  country
                  email
                  phone
                }
              }
            }
          }
        `;

        const data = await client.api.pimApi(query, {
          identifier,
          tenantId: client.config.tenantId,
        });
        const customer = (data as CustomerGetResponse).customer?.get;

        if (!customer) {
          return {
            content: [
              {
                type: 'text',
                text: `Customer "${identifier}" not found. Use list_customers to search.`,
              },
            ],
            isError: true,
          };
        }

        const pii = client.config.piiMode;

        const lines: string[] = [`  Identifier: ${customer.identifier}`];

        if (pii !== 'none') {
          const name = [customer.firstName, customer.lastName]
            .filter(Boolean)
            .join(' ');
          if (name) {
            lines.unshift(name);
          } else {
            lines.unshift(customer.identifier);
          }

          if (customer.email) {
            lines.push(
              `  Email: ${pii === 'masked' ? maskEmail(customer.email) : customer.email}`,
            );
          }
          if (customer.phone) {
            lines.push(
              `  Phone: ${pii === 'masked' ? maskPhone(customer.phone) : customer.phone}`,
            );
          }
          if (customer.companyName) {
            lines.push(`  Company: ${customer.companyName}`);
          }
          if (customer.taxNumber) {
            lines.push(`  Tax number: ${customer.taxNumber}`);
          }
          if (customer.birthDate) {
            lines.push(`  Birth date: ${customer.birthDate}`);
          }
        } else {
          lines.unshift(customer.identifier);
        }

        if (pii !== 'none' && customer.addresses?.length) {
          lines.push('');
          lines.push(`Addresses (${customer.addresses.length}):`);
          for (const addr of customer.addresses) {
            if (pii === 'masked') {
              // City + country only
              const addrStr = [addr.city, addr.country]
                .filter(Boolean)
                .join(', ');
              lines.push(`  [${addr.type}] ${addrStr || '(masked)'}`);
            } else {
              const addrName = [addr.firstName, addr.lastName]
                .filter(Boolean)
                .join(' ');
              const addrStr = [
                addr.streetNumber,
                addr.street,
                addr.street2,
                addr.city,
                addr.state,
                addr.postalCode,
                addr.country,
              ]
                .filter(Boolean)
                .join(', ');
              lines.push(`  [${addr.type}] ${addrName}`);
              if (addrStr) {
                lines.push(`    ${addrStr}`);
              }
              if (addr.email) {
                lines.push(`    Email: ${addr.email}`);
              }
              if (addr.phone) {
                lines.push(`    Phone: ${addr.phone}`);
              }
            }
          }
        }

        if (pii !== 'none') {
          if (customer.externalReferences?.length) {
            lines.push('');
            lines.push('External references:');
            for (const ref of customer.externalReferences) {
              lines.push(`  ${ref.key}: ${ref.value ?? ''}`);
            }
          }

          if (customer.meta?.length) {
            lines.push('');
            lines.push('Meta:');
            for (const m of customer.meta) {
              lines.push(`  ${m.key}: ${m.value ?? ''}`);
            }
          }
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

interface CustomerSummary {
  identifier: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  companyName?: string;
  phone?: string;
}

interface AddressDetail {
  type: string;
  firstName?: string;
  lastName?: string;
  street?: string;
  street2?: string;
  streetNumber?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  email?: string;
  phone?: string;
}

interface CustomerDetail extends CustomerSummary {
  taxNumber?: string;
  birthDate?: string;
  addresses?: AddressDetail[];
  externalReferences?: { key: string; value?: string }[];
  meta?: { key: string; value?: string }[];
}

interface CustomerListResponse {
  customer?: {
    getMany?: {
      pageInfo: PageInfo;
      edges: { node: CustomerSummary }[];
    };
  };
}

interface CustomerGetResponse {
  customer?: {
    get?: CustomerDetail;
  };
}
