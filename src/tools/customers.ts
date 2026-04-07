/**
 * Customer tools — search and inspect customers.
 */

import { z } from 'zod';
import type { CrystallizeClient } from '../client.js';
import type { ToolDefinition, ToolResult, PiiMode } from '../types.js';
import { maskEmail, maskPhone } from '../pii.js';

export function customerTools(client: CrystallizeClient): ToolDefinition[] {
  return [
    {
      name: 'list_customers',
      description:
        'Search and list customers in the tenant. Supports filtering by name or email. Returned fields depend on CRYSTALLIZE_PII_MODE: full (default) returns name, identifier, email, company, and phone; masked returns name, identifier, company, and masked email/phone; none returns identifiers only.',
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

        const query = `
          query ListCustomers($tenantId: ID!, $first: Int, $after: String) {
            customer {
              getMany(
                tenantId: $tenantId
                first: $first
                after: $after
              ) {
                pageInfo {
                  hasNextPage
                  endCursor
                  totalNodes
                }
                edges {
                  cursor
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

        // Without a search term, do a single paginated fetch.
        if (!searchTerm) {
          const data = await client.api.pimApi(query, {
            tenantId: client.config.tenantId,
            first,
            after: after ?? null,
          });
          const result = (data as CustomerListResponse).customer?.getMany;

          if (!result || result.edges.length === 0) {
            return {
              content: [{ type: 'text', text: 'No customers found.' }],
            };
          }

          return formatCustomerPage(
            result.edges.map(e => e.node),
            result.pageInfo.totalNodes ?? result.edges.length,
            result.pageInfo.hasNextPage ? result.pageInfo.endCursor : undefined,
            client.config.piiMode ?? 'full',
          );
        }

        // With a search term the API has no server-side filter, so we paginate
        // through all pages in batches and filter client-side. We collect
        // first+1 matches so we can tell whether a next page exists, and use
        // per-edge cursors so the returned cursor always points to the exact
        // last matched item (not the end of a raw batch).
        const BATCH = 100;
        const normalize = (s: string) =>
          s
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
            .replace(/[łŁ]/g, 'l')
            .replace(/[øØ]/g, 'o')
            .replace(/[æÆ]/g, 'ae')
            .replace(/[œŒ]/g, 'oe')
            .replace(/[ðÐ]/g, 'd')
            .replace(/[þÞ]/g, 'th')
            .replace(/ß/g, 'ss')
            .toLowerCase();
        const term = normalize(searchTerm);
        const matchedEdges: { node: CustomerSummary; cursor: string }[] = [];
        let currentAfter: string | null = after ?? null;
        let hasMore = true;

        while (hasMore && matchedEdges.length < first + 1) {
          const data = await client.api.pimApi(query, {
            tenantId: client.config.tenantId,
            first: BATCH,
            after: currentAfter,
          });
          const batch = (data as CustomerListResponse).customer?.getMany;
          if (!batch) {
            break;
          }

          for (const edge of batch.edges) {
            const c = edge.node;
            const name = normalize(
              [c.firstName, c.lastName].filter(Boolean).join(' '),
            );
            if (
              name.includes(term) ||
              (c.email && normalize(c.email).includes(term)) ||
              normalize(c.identifier).includes(term)
            ) {
              matchedEdges.push(
                edge as { node: CustomerSummary; cursor: string },
              );
            }
          }

          hasMore = batch.pageInfo.hasNextPage ?? false;
          currentAfter = batch.pageInfo.endCursor ?? null;
        }

        if (matchedEdges.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No customers found matching "${searchTerm}".`,
              },
            ],
          };
        }

        const page = matchedEdges.slice(0, first);
        const nextCursor =
          matchedEdges.length > first
            ? matchedEdges[first - 1].cursor
            : undefined;

        return formatCustomerPage(
          page.map(e => e.node),
          undefined, // total unknown when filtering client-side
          nextCursor,
          client.config.piiMode ?? 'full',
          searchTerm,
        );
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

        const maskedId =
          pii !== 'full' && customer.identifier.includes('@')
            ? maskEmail(customer.identifier)
            : customer.identifier;

        const lines: string[] = [`  Identifier: ${maskedId}`];

        if (pii !== 'none') {
          const name = [customer.firstName, customer.lastName]
            .filter(Boolean)
            .join(' ');
          if (name) {
            lines.unshift(name);
          } else {
            lines.unshift(maskedId);
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
          lines.unshift(maskedId);
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

// --- Helpers ---

function formatCustomerPage(
  customers: CustomerSummary[],
  total: number | undefined,
  nextCursor: string | undefined,
  pii: PiiMode,
  searchTerm?: string,
): ToolResult {
  const header = searchTerm
    ? `Customers matching "${searchTerm}" (${customers.length}${total !== undefined ? ` of ${total}` : ''}):`
    : `Customers (${customers.length}${total !== undefined ? ` of ${total}` : ''}):`;

  const lines: string[] = [header, ''];

  for (const c of customers) {
    const maskedId =
      pii !== 'full' && c.identifier.includes('@')
        ? maskEmail(c.identifier)
        : c.identifier;
    if (pii === 'none') {
      lines.push(maskedId);
    } else {
      const name = [c.firstName, c.lastName].filter(Boolean).join(' ');
      lines.push(`${name || maskedId} (${maskedId})`);
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

  if (nextCursor) {
    lines.push(`Next page cursor: ${nextCursor}`);
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] };
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
