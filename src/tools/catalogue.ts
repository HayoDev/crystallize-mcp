/**
 * Catalogue tools — browse, get items, search, and product variants.
 */

import { z } from 'zod';
import type { CrystallizeClient } from '../client.js';
import type { ToolDefinition } from '../types.js';

export function catalogueTools(client: CrystallizeClient): ToolDefinition[] {
  return [
    {
      name: 'browse_catalogue',
      description:
        'Browse the catalogue tree by path. Returns child items (folders, products, documents) with names, paths, and types. Start with "/" to see the root.',
      schema: {
        path: z
          .string()
          .default('/')
          .describe('Catalogue path to browse, e.g. "/" or "/shop/plants"'),
        language: z.string().default('en').describe('Language code'),
        depth: z
          .number()
          .default(1)
          .describe('How many levels deep to fetch children (1-3)'),
      },
      handler: async params => {
        const { path, language, depth } = params;
        const clampedDepth = Math.min(Math.max(depth, 1), 3);

        const childrenFragment = buildChildrenFragment(clampedDepth);
        const query = `
          query BrowseCatalogue($path: String!, $language: String!) {
            catalogue(path: $path, language: $language) {
              id
              name
              type
              path
              ${childrenFragment}
            }
          }
        `;

        const data = await client.api.catalogueApi(query, { path, language });
        const catalogue = (data as { catalogue: CatalogueNode | null })
          .catalogue;

        if (!catalogue) {
          return {
            content: [
              { type: 'text', text: `No item found at path "${path}"` },
            ],
            isError: true,
          };
        }

        const lines = formatCatalogueNode(catalogue, client, 0);
        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      },
    },

    {
      name: 'get_item',
      description:
        'Get a catalogue item by path with its full component data. Returns name, type, shape, components, and a deep link to the Crystallize UI.',
      schema: {
        path: z.string().describe('Item path, e.g. "/shop/plants/monstera"'),
        language: z.string().default('en').describe('Language code'),
      },
      handler: async params => {
        const { path, language } = params;

        const query = `
          query GetItem($path: String!, $language: String!) {
            catalogue(path: $path, language: $language) {
              id
              name
              type
              path
              shape {
                identifier
                name
              }
              components {
                id
                name
                type
                content {
                  ... on SingleLineContent { text }
                  ... on RichTextContent { plainText }
                  ... on BooleanContent { value }
                  ... on NumericContent { number unit }
                  ... on SelectionContent { options { key value } }
                  ... on ImageContent {
                    images { url altText width height }
                  }
                  ... on ComponentChoiceContent {
                    selectedComponent { id name type }
                  }
                }
              }
            }
          }
        `;

        const data = await client.api.catalogueApi(query, { path, language });
        const item = (data as { catalogue: ItemNode | null }).catalogue;

        if (!item) {
          return {
            content: [
              { type: 'text', text: `No item found at path "${path}"` },
            ],
            isError: true,
          };
        }

        const lines: string[] = [
          `${item.name}`,
          `  Type: ${item.type}`,
          `  Path: ${item.path}`,
          `  Shape: ${item.shape?.name ?? 'unknown'} (${item.shape?.identifier ?? '?'})`,
          `  Link: ${client.itemLink(item.id)}`,
          `  Shape link: ${item.shape ? client.shapeLink(item.shape.identifier) : 'n/a'}`,
        ];

        if (item.components?.length) {
          lines.push('', 'Components:');
          for (const comp of item.components) {
            lines.push(
              `  ${comp.id} (${comp.type}): ${formatComponentContent(comp.content)}`,
            );
          }
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      },
    },

    {
      name: 'search_catalogue',
      description:
        'Search across the catalogue for products, documents, and folders. Supports filtering by type (PRODUCT, DOCUMENT, FOLDER). Returns names, paths, types, and deep links.',
      schema: {
        term: z.string().describe('Search term'),
        type: z
          .enum(['PRODUCT', 'DOCUMENT', 'FOLDER'])
          .optional()
          .describe('Filter by item type'),
        language: z.string().default('no').describe('Language code'),
        limit: z.number().default(20).describe('Max results to return'),
      },
      handler: async params => {
        const { term, type, language, limit } = params;

        const typeFilter = type ? `, type: ${type}` : '';
        const query = `
          query Search($term: String!, $language: String!) {
            search(
              language: $language
              filter: { searchTerm: $term${typeFilter} }
            ) {
              edges {
                node {
                  id
                  name
                  path
                  type
                }
              }
            }
          }
        `;

        const response = await fetch(
          `https://api.crystallize.com/${client.config.tenantIdentifier}/search`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, variables: { term, language } }),
          },
        );

        const json = (await response.json()) as {
          data?: { search?: { edges?: SearchEdge[] } };
        };
        const edges = (json.data?.search?.edges ?? []).slice(0, limit);

        if (edges.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No results for "${term}"${type ? ` (type: ${type})` : ''}`,
              },
            ],
          };
        }

        const lines = edges.map((edge, i) => {
          const node = edge.node;
          const parts = [
            `${i + 1}. ${node.name} [${node.type}]`,
            `   Path: ${node.path}`,
            `   Link: ${client.itemLink(node.id, language)}`,
          ];
          return parts.join('\n');
        });

        return {
          content: [
            {
              type: 'text',
              text: `Search results for "${term}" (${edges.length} hits):\n\n${lines.join('\n\n')}`,
            },
          ],
        };
      },
    },

    {
      name: 'get_product_variants',
      description:
        'Get all variants for a product by path. Returns SKUs, names, pricing, stock, and attributes.',
      schema: {
        path: z.string().describe('Product path, e.g. "/shop/plants/monstera"'),
        language: z.string().default('en').describe('Language code'),
      },
      handler: async params => {
        const { path, language } = params;

        const query = `
          query GetVariants($path: String!, $language: String!) {
            catalogue(path: $path, language: $language) {
              id
              name
              ... on Product {
                variants {
                  sku
                  name
                  isDefault
                  price
                  stock
                  attributes {
                    attribute
                    value
                  }
                  images {
                    url
                    altText
                  }
                }
              }
            }
          }
        `;

        const data = await client.api.catalogueApi(query, { path, language });
        const product = (data as { catalogue: ProductNode | null }).catalogue;

        if (!product) {
          return {
            content: [
              { type: 'text', text: `No product found at path "${path}"` },
            ],
            isError: true,
          };
        }

        const variants = product.variants ?? [];
        if (variants.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `Product "${product.name}" has no variants.`,
              },
            ],
          };
        }

        const lines: string[] = [
          `${product.name} — ${variants.length} variant(s)`,
          `Link: ${client.itemLink(product.id)}`,
          '',
        ];

        for (const v of variants) {
          lines.push(`${v.isDefault ? '* ' : '  '}${v.name ?? v.sku}`);
          lines.push(`    SKU: ${v.sku}`);
          if (v.price != null) {
            lines.push(`    Price: ${v.price}`);
          }
          if (v.stock != null) {
            lines.push(`    Stock: ${v.stock}`);
          }
          if (v.attributes?.length) {
            for (const attr of v.attributes) {
              lines.push(`    ${attr.attribute}: ${attr.value}`);
            }
          }
          lines.push('');
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      },
    },
  ];
}

// --- Internal types ---

interface CatalogueNode {
  id: string;
  name: string;
  type: string;
  path: string;
  children?: CatalogueNode[];
}

interface ItemNode {
  id: string;
  name: string;
  type: string;
  path: string;
  shape?: { identifier: string; name: string };
  components?: ComponentNode[];
}

interface ComponentNode {
  id: string;
  name: string;
  type: string;
  content: Record<string, unknown> | null;
}

interface SearchEdge {
  node: {
    id: string;
    name: string;
    path: string;
    type: string;
  };
}

interface ProductNode {
  id: string;
  name: string;
  variants?: VariantNode[];
}

interface VariantNode {
  sku: string;
  name?: string;
  isDefault?: boolean;
  price?: number;
  stock?: number;
  attributes?: { attribute: string; value: string }[];
  images?: { url: string; altText?: string }[];
}

// --- Helpers ---

function buildChildrenFragment(depth: number): string {
  if (depth <= 0) {
    return '';
  }
  const inner = depth > 1 ? buildChildrenFragment(depth - 1) : '';
  return `children { id name type path ${inner} }`;
}

function formatCatalogueNode(
  node: CatalogueNode,
  client: CrystallizeClient,
  indent: number,
): string[] {
  const prefix = '  '.repeat(indent);
  const lines: string[] = [
    `${prefix}${node.name} [${node.type}]`,
    `${prefix}  Path: ${node.path}`,
    `${prefix}  Link: ${client.itemLink(node.id)}`,
  ];

  if (node.children?.length) {
    for (const child of node.children) {
      lines.push(...formatCatalogueNode(child, client, indent + 1));
    }
  }

  return lines;
}

function formatComponentContent(
  content: Record<string, unknown> | null,
): string {
  if (!content) {
    return '(empty)';
  }

  if ('text' in content) {
    return String(content.text);
  }
  if ('plainText' in content) {
    return truncate(String(content.plainText), 200);
  }
  if ('value' in content) {
    return String(content.value);
  }
  if ('number' in content) {
    const unit = content.unit ? ` ${content.unit}` : '';
    return `${content.number}${unit}`;
  }
  if ('images' in content) {
    const images = content.images as { url: string }[];
    return `${images.length} image(s)`;
  }
  if ('options' in content) {
    const options = content.options as { key: string; value: string }[];
    return options.map(o => o.value).join(', ');
  }

  return JSON.stringify(content);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max) + '...';
}
