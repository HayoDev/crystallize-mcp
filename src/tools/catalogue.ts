/**
 * Catalogue tools — browse, get items, search, and product variants.
 *
 * All queries are built dynamically via Catalogue API introspection.
 */

import { z } from 'zod';
import type { CrystallizeClient } from '../client.js';
import type { ToolDefinition } from '../types.js';
import {
  introspectApi,
  execRootWithRetry,
  buildSelection,
  getRootFieldReturnType,
  hasRequiredArgs,
  isScalar,
  resolveTypeName,
  type ApiSchema,
  type ApiCaller,
  type IntroType,
} from './introspect.js';

// --- Catalogue API introspection ---

function introspectCatalogue(client: CrystallizeClient): Promise<ApiSchema> {
  return introspectApi(
    'catalogue',
    (q, v) => client.api.catalogueApi(q, v),
    [['catalogue'], ['search']],
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export function catalogueTools(client: CrystallizeClient): ToolDefinition[] {
  const catCall: ApiCaller = (q, v) => client.api.catalogueApi(q, v);
  const defaultLang = () => client.config.defaultLanguage ?? 'en';

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
        language: z.string().optional().describe('Language code (defaults to tenant language)'),
        depth: z
          .number()
          .default(1)
          .describe('How many levels deep to fetch children (1-3)'),
      },
      handler: async params => {
        const { path, depth } = params;
        const language = (params.language as string) || defaultLang();
        const clampedDepth = Math.min(Math.max(depth, 1), 3);
        const schema = await introspectCatalogue(client);

        // Build a children fragment dynamically based on introspected schema.
        // The catalogue root returns an Item interface; children is a field on Item.
        const itemType = getRootFieldReturnType(schema, 'catalogue');
        const childrenField = itemType?.fields?.find(f => f.name === 'children');
        let childrenFragment = '';
        if (childrenField && itemType) {
          childrenFragment = buildChildrenFromSchema(schema, itemType, clampedDepth);
        }

        const data = (await execRootWithRetry(
          catCall, schema, 'catalogue',
          { path, language }, 1, childrenFragment,
        )) as any;

        const catalogue = data?.catalogue;

        if (!catalogue) {
          return {
            content: [
              { type: 'text', text: `No item found at path "${path}"` },
            ],
            isError: true,
          };
        }

        const lines = formatCatalogueNode(catalogue, client, 0, language);
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
        language: z.string().optional().describe('Language code (defaults to tenant language)'),
      },
      handler: async params => {
        const path = params.path as string;
        const language = (params.language as string) || defaultLang();
        const schema = await introspectCatalogue(client);

        // Request 1: Fetch item basics + shallow components (scalars only per content type).
        // Also fetch default variant for products (price, sku, stock).
        const componentContentSel = buildShallowComponentContent(schema);
        const extraSel = [
          `components { id name type content { ${componentContentSel} } }`,
          `... on Product { defaultVariant { sku name price stock } }`,
        ].join(' ');
        const data = (await execRootWithRetry(
          catCall, schema, 'catalogue',
          { path, language }, 1,
          extraSel,
        )) as any;

        const item = data?.catalogue;

        if (!item) {
          return {
            content: [
              { type: 'text', text: `No item found at path "${path}"` },
            ],
            isError: true,
          };
        }

        // Request 2: For contentChunk components, fetch chunks with their
        // nested component content in a targeted follow-up query.
        const chunkComponents = (item.components ?? []).filter(
          (c: any) => c.type === 'contentChunk',
        );
        if (chunkComponents.length > 0) {
          const chunkSel = buildChunkContentSelection(schema);
          if (chunkSel) {
            const chunkQuery = `
              query($path: String!, $language: String!) {
                catalogue(path: $path, language: $language) {
                  components {
                    id
                    type
                    content {
                      ... on ContentChunkContent {
                        chunks {
                          id name type
                          content { ${componentContentSel} }
                        }
                      }
                    }
                  }
                }
              }
            `;

            try {
              const chunkData = (await catCall(chunkQuery, { path, language })) as any;
              const deepComponents = chunkData?.catalogue?.components ?? [];

              // Merge chunk data back into the shallow components
              for (const comp of item.components ?? []) {
                if (comp.type !== 'contentChunk') {
                  continue;
                }
                const deep = deepComponents.find(
                  (dc: any) => dc.id === comp.id && dc.type === 'contentChunk',
                );
                if (deep?.content?.chunks) {
                  comp.content = deep.content;
                }
              }
            } catch {
              // If chunk query fails, the shallow data is still usable
            }
          }
        }

        const publishedStatus = item.publishedAt
          ? `Published: ${item.publishedAt}`
          : 'Status: draft (not published)';

        const lines: string[] = [
          `${item.name}`,
          `  Type: ${item.type}`,
          `  Path: ${item.path}`,
          `  Shape: ${item.shape?.name ?? 'unknown'} (${item.shape?.identifier ?? '?'})`,
          `  ${publishedStatus}`,
          `  Edit: ${client.itemLink(item.id, item.type, language)}`,
          `  Shape: ${item.shape ? client.shapeLink(item.shape.identifier, language) : 'n/a'}`,
        ];

        const isDraft = !item.publishedAt;
        const frontendLink = client.catalogueLink(item.path, isDraft);
        if (frontendLink) {
          lines.push(`  Frontend: ${frontendLink}`);
        }

        // Show default variant for products (price, SKU, stock)
        if (item.defaultVariant) {
          const dv = item.defaultVariant;
          const variantParts: string[] = [];
          if (dv.sku) {variantParts.push(`SKU: ${dv.sku}`);}
          if (dv.price != null) {variantParts.push(`Price: ${dv.price}`);}
          if (dv.stock != null) {variantParts.push(`Stock: ${dv.stock}`);}
          if (variantParts.length) {
            lines.push(`  Default variant: ${dv.name ?? dv.sku} — ${variantParts.join(', ')}`);
          }
        }

        if (item.components?.length) {
          const nonEmpty: string[] = [];
          const emptyIds: string[] = [];
          for (const comp of item.components) {
            const val = formatComponentContent(comp.content, client, language);
            if (isEmptyValue(val)) {
              emptyIds.push(comp.id);
            } else {
              nonEmpty.push(
                `  ${comp.id} (${comp.type}): ${val}`,
              );
            }
          }
          if (nonEmpty.length) {
            lines.push('', 'Components:');
            lines.push(...nonEmpty);
          }
          if (emptyIds.length) {
            lines.push('', `Empty components (${emptyIds.length}): ${emptyIds.join(', ')}`);
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
        language: z.string().optional().describe('Language code (defaults to tenant language)'),
        limit: z.number().default(20).describe('Max results to return'),
        after: z.string().optional().describe('Pagination cursor from a previous search result'),
      },
      handler: async params => {
        const { term, type, limit, after } = params;
        const language = (params.language as string) || defaultLang();
        const schema = await introspectCatalogue(client);

        // The search query is special: it uses a `filter` input, not simple
        // variable passthrough. We introspect the search.edges.node type to
        // build a dynamic selection, but construct the query shell ourselves.
        const searchType = getRootFieldReturnType(schema, 'search');
        const edgesField = searchType?.fields?.find(f => f.name === 'edges');
        let nodeSelection = 'id name path type';
        if (edgesField) {
          const edgesTypeName = resolveTypeNameFromField(edgesField);
          const edgesType = schema.types.get(edgesTypeName);
          const nodeField = edgesType?.fields?.find(f => f.name === 'node');
          if (nodeField) {
            const nodeTypeName = resolveTypeNameFromField(nodeField);
            const nodeType = schema.types.get(nodeTypeName);
            if (nodeType) {
              const sel = buildSelection(schema, nodeType, 0);
              if (sel) {
                nodeSelection = sel;
              }
            }
          }
        }

        const typeFilter = type ? `, type: ${type}` : '';
        const afterVarDecl = after ? ', $after: String!' : '';
        const query = `
          query Search($term: String!, $language: String!${afterVarDecl}) {
            search(
              language: $language
              first: ${limit}
              ${after ? 'after: $after' : ''}
              filter: { searchTerm: $term${typeFilter} }
            ) {
              edges {
                node {
                  ${nodeSelection}
                }
                cursor
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `;

        const variables: Record<string, unknown> = { term, language };
        if (after) {variables.after = after;}

        const response = await fetch(
          `https://api.crystallize.com/${client.config.tenantIdentifier}/search`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, variables }),
          },
        );

        const json = (await response.json()) as {
          data?: {
            search?: {
              edges?: { node: Record<string, unknown>; cursor?: string }[];
              pageInfo?: { hasNextPage?: boolean; endCursor?: string };
            };
          };
        };
        const edges = (json.data?.search?.edges ?? []).slice(0, limit);
        const pageInfo = json.data?.search?.pageInfo;

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
            `   Edit: ${client.itemLink(String(node.id), String(node.type), language)}`,
          ];
          const frontendLink = client.catalogueLink(String(node.path));
          if (frontendLink) {
            parts.push(`   Frontend: ${frontendLink}`);
          }
          return parts.join('\n');
        });

        let resultText = `Search results for "${term}" (${edges.length} hits):\n\n${lines.join('\n\n')}`;

        if (pageInfo?.hasNextPage && pageInfo.endCursor) {
          resultText += `\n\n--- More results available. Use after: "${pageInfo.endCursor}" to paginate ---`;
        }

        return {
          content: [
            {
              type: 'text',
              text: resultText,
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
        language: z.string().optional().describe('Language code (defaults to tenant language)'),
      },
      handler: async params => {
        const path = params.path as string;
        const language = (params.language as string) || defaultLang();
        const schema = await introspectCatalogue(client);

        // Product is a type that implements Item. We need to use an inline
        // fragment (... on Product { variants { ... } }) to access variants.
        // Build the variants selection dynamically.
        const productType = schema.types.get('Product');
        let variantFragment = '';
        if (productType) {
          const variantsField = productType.fields?.find(f => f.name === 'variants');
          if (variantsField) {
            const variantTypeName = resolveTypeNameFromField(variantsField);
            const variantType = schema.types.get(variantTypeName);
            if (variantType) {
              const variantSel = buildSelection(schema, variantType, 1);
              if (variantSel) {
                variantFragment = `... on Product { variants { ${variantSel} } }`;
              }
            }
          }
        }

        const data = (await execRootWithRetry(
          catCall, schema, 'catalogue',
          { path, language }, 1, variantFragment,
        )) as any;

        const product = data?.catalogue;

        if (!product) {
          return {
            content: [
              { type: 'text', text: `No product found at path "${path}"` },
            ],
            isError: true,
          };
        }

        const variants = (product.variants ?? []) as any[];
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
          `Edit: ${client.itemLink(product.id, 'product', language)}`,
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

// --- Helpers ---

/** Resolve the named type from a field's type ref. */
function resolveTypeNameFromField(field: { type: { kind: string; name?: string | null; ofType?: any } }): string {
  return resolveTypeName(field.type);
}

/**
 * Build a shallow inline-fragment selection for ComponentContent union.
 * Only includes scalar fields from each union member — keeps queries small.
 * Handles field-name conflicts across members (same as buildUnionFragments).
 */
function buildShallowComponentContent(schema: ApiSchema): string {
  // Find the ComponentContent union type (content field on Component)
  const componentType = findComponentType(schema);
  if (!componentType) {
    return '';
  }

  const contentField = componentType.fields?.find(f => f.name === 'content');
  if (!contentField) {
    return '';
  }

  const contentTypeName = resolveTypeName(contentField.type);
  const contentType = schema.types.get(contentTypeName);
  if (!contentType?.possibleTypes?.length) {
    return '';
  }

  // Build shallow fragments: only scalars + one level of simple objects
  const members = contentType.possibleTypes
    .map(m => schema.types.get(m.name))
    .filter((t): t is IntroType => !!t?.fields?.length);

  // Detect conflicting fields
  const fieldTypeMap = new Map<string, Set<string>>();
  for (const member of members) {
    for (const field of member.fields ?? []) {
      const types = fieldTypeMap.get(field.name) ?? new Set<string>();
      types.add(resolveTypeName(field.type));
      fieldTypeMap.set(field.name, types);
    }
  }
  const conflicting = new Set<string>();
  for (const [name, types] of fieldTypeMap) {
    if (types.size > 1) {
      conflicting.add(name);
    }
  }

  const fragments: string[] = [];
  for (const member of members) {
    const fields: string[] = [];
    for (const field of member.fields ?? []) {
      if (hasRequiredArgs(field) || conflicting.has(field.name)) {
        continue;
      }
      if (isScalar(field.type)) {
        fields.push(field.name);
      } else {
        const nested = schema.types.get(resolveTypeName(field.type));
        if (!nested?.fields?.length && nested?.kind !== 'INTERFACE') {
          continue;
        }

        // For media and relation types, go two levels deep to capture URLs
        // and nested objects like thumbnails, items with paths, etc.
        if (nested?.kind === 'OBJECT' || nested?.kind === 'INTERFACE') {
          const subFields: string[] = [];
          for (const sub of nested.fields ?? []) {
            if (hasRequiredArgs(sub)) {
              continue;
            }
            if (isScalar(sub.type)) {
              subFields.push(sub.name);
            } else {
              // Second level: only scalars
              const deep = schema.types.get(resolveTypeName(sub.type));
              if ((deep?.kind === 'OBJECT' || deep?.kind === 'INTERFACE') && deep.fields?.length) {
                const deepScalars = deep.fields
                  .filter(f => isScalar(f.type) && !hasRequiredArgs(f))
                  .map(f => f.name);
                if (deepScalars.length) {
                  subFields.push(`${sub.name} { ${deepScalars.join(' ')} }`);
                }
              }
            }
          }
          if (subFields.length) {
            fields.push(`${field.name} { ${subFields.join(' ')} }`);
          }
        }
      }
    }
    if (fields.length) {
      fragments.push(`... on ${member.name} { ${fields.join(' ')} }`);
    }
  }

  // Post-process: inject shallow content fragments into types that reference
  // Component (which has id, type, content: ComponentContent). This covers:
  // - ComponentChoiceContent.selectedComponent
  // - ComponentMultipleChoiceContent.selectedComponents
  // - PieceContent.components
  const componentHolders = [
    { type: 'ComponentChoiceContent', field: 'selectedComponent' },
    { type: 'ComponentMultipleChoiceContent', field: 'selectedComponents' },
    { type: 'PieceContent', field: 'components' },
  ];
  for (const holder of componentHolders) {
    const idx = fragments.findIndex(f => f.includes(holder.type));
    if (idx < 0) {continue;}
    const otherFragments = fragments
      .filter((_, i) => i !== idx)
      .join(' ');
    if (!otherFragments) {continue;}
    const fieldRe = new RegExp(`${holder.field}\\s*\\{[^}]*\\}`);
    fragments[idx] = fragments[idx].replace(
      fieldRe,
      `${holder.field} { id name type content { ${otherFragments} } }`,
    );
  }

  return fragments.join(' ');
}

/**
 * Build a focused selection for ContentChunkContent.chunks.
 * Returns the inner component content selection for chunks,
 * reusing the shallow component content builder.
 */
function buildChunkContentSelection(schema: ApiSchema): string {
  const contentChunkType = schema.types.get('ContentChunkContent');
  if (!contentChunkType?.fields) {
    return '';
  }
  const chunksField = contentChunkType.fields.find(f => f.name === 'chunks');
  if (!chunksField) {
    return '';
  }
  return 'ok';
}

/** Find the Component type in the schema (used inside catalogue items). */
function findComponentType(schema: ApiSchema): IntroType | undefined {
  return schema.types.get('Component');
}

/**
 * Build a recursive children selection from introspected schema.
 * Generates: children { id name type path children { ... } }
 */
function buildChildrenFromSchema(
  schema: ApiSchema,
  itemType: { fields?: { name: string; type: any }[] },
  depth: number,
): string {
  if (depth <= 0) {
    return '';
  }
  // Build a minimal selection for children: scalars only + recurse
  const scalarFields = (itemType.fields ?? [])
    .filter(f => {
      const k = f.type.kind === 'NON_NULL' || f.type.kind === 'LIST'
        ? f.type.ofType?.kind ?? f.type.kind
        : f.type.kind;
      return k === 'SCALAR' || k === 'ENUM';
    })
    .map(f => f.name);

  // Ensure essential fields are included
  const essentials = ['id', 'name', 'type', 'path'];
  const fields = [...new Set([...essentials.filter(e => scalarFields.includes(e)), ...scalarFields.slice(0, 6)])];

  const inner = depth > 1 ? buildChildrenFromSchema(schema, itemType, depth - 1) : '';
  return `children { ${fields.join(' ')} ${inner} }`;
}

function formatCatalogueNode(
  node: any,
  client: CrystallizeClient,
  indent: number,
  language = 'en',
): string[] {
  const prefix = '  '.repeat(indent);
  const lines: string[] = [
    `${prefix}${node.name} [${node.type}]`,
    `${prefix}  Path: ${node.path}`,
    `${prefix}  Edit: ${client.itemLink(node.id, node.type, language)}`,
  ];

  const frontendLink = client.catalogueLink(node.path);
  if (frontendLink) {
    lines.push(`${prefix}  Frontend: ${frontendLink}`);
  }

  if (node.children?.length) {
    for (const child of node.children) {
      lines.push(...formatCatalogueNode(child, client, indent + 1, language));
    }
  }

  return lines;
}

function formatComponentContent(
  content: Record<string, unknown> | null,
  client?: CrystallizeClient,
  language?: string,
): string {
  if (!content) {
    return '(empty)';
  }

  // SingleLineContent / RichTextContent (text field)
  if ('text' in content) {
    const text = String(content.text);
    return linkifyText(text, client);
  }

  // RichTextContent (plainText field)
  if ('plainText' in content) {
    const pt = String(content.plainText);
    return truncate(pt, 200);
  }

  // BooleanContent
  if ('value' in content && typeof content.value === 'boolean') {
    return String(content.value);
  }

  // NumericContent
  if ('number' in content) {
    const unit = content.unit ? ` ${content.unit}` : '';
    return `${content.number}${unit}`;
  }

  // DatetimeContent
  if ('datetime' in content) {
    return String(content.datetime ?? '(no date)');
  }

  // ImageContent
  if ('images' in content || 'firstImage' in content) {
    let images = (content.images ?? []) as { url?: string; key?: string; altText?: string }[];
    // Fallback to firstImage if images array is empty
    if (!images.length && (content as any).firstImage) {
      images = [(content as any).firstImage];
    }
    if (!images.length) {
      return '(no images)';
    }
    return images.map(img => {
      const url = img.url || (img.key && client ? client.mediaUrl(img.key) : null);
      return url ?? img.altText ?? img.key ?? 'image';
    }).join(', ');
  }

  // VideoContent
  if ('videos' in content || 'firstVideo' in content) {
    let videos = ((content.videos ?? []) as { id?: string; title?: string; key?: string; playlists?: string[]; thumbnails?: { url: string }[] }[]);
    // Fallback to firstVideo if videos array is empty
    if (!videos.length && (content as any).firstVideo) {
      videos = [(content as any).firstVideo];
    }
    if (!videos.length) {
      return '(no videos)';
    }
    return videos.map(v => {
      const url = v.playlists?.length
        ? v.playlists[v.playlists.length - 1]
        : v.thumbnails?.[0]?.url
          ?? (v.key && client ? client.mediaUrl(v.key) : null);
      return url ?? v.title ?? v.id ?? 'video';
    }).join(', ');
  }

  // FileContent
  if ('files' in content) {
    const files = content.files as { url: string; key?: string; title?: string; size?: number }[];
    if (!files?.length) {
      return '(no files)';
    }
    return files.map(f => f.url).join(', ');
  }

  // SelectionContent
  if ('options' in content) {
    const options = content.options as { key: string; value: string }[];
    return options.map(o => o.value).join(', ');
  }

  // LocationContent
  if ('lat' in content && 'long' in content) {
    return `${content.lat}, ${content.long}`;
  }

  // PropertiesTableContent
  if ('sections' in content) {
    const sections = content.sections as { title?: string; properties?: { key: string; value?: string }[] }[];
    if (!sections?.length) {
      return '(empty properties)';
    }
    const lines: string[] = [];
    for (const sec of sections) {
      if (sec.title) {
        lines.push(sec.title);
      }
      for (const prop of sec.properties ?? []) {
        const val = prop.value ?? '';
        const linked = linkifyText(val, client);
        if (linked !== val) {
          lines.push(`  ${prop.key}: ${linked}`);
        } else {
          lines.push(`  ${prop.key}: ${val}`);
        }
      }
    }
    return lines.join('\n');
  }

  // ItemRelationsContent / GridRelationsContent
  if ('items' in content) {
    const items = content.items as { id?: string; name: string; path: string; type: string }[] | null;
    const variants = content.productVariants as { id?: string; name: string; sku: string }[] | null;
    const parts: string[] = [];
    if (items?.length) {
      parts.push(items.map(item => {
        const lines: string[] = [];
        lines.push(`${item.name} [${item.type}]`);
        // Crystallize edit deeplink
        if (item.id && client) {
          lines.push(`Edit: ${client.itemLink(item.id, item.type, language)}`);
        }
        // Frontend link
        if (item.path && client) {
          const frontendLink = client.catalogueLink(item.path);
          if (frontendLink) {
            lines.push(`Frontend: ${frontendLink}`);
          }
        }
        return lines.join(' | ');
      }).join(', '));
    }
    if (variants?.length) {
      parts.push(variants.map(v => `${v.name ?? v.sku} [variant]`).join(', '));
    }
    return parts.length ? parts.join('; ') : '(no related items)';
  }

  // ParagraphCollectionContent
  if ('paragraphs' in content) {
    const paragraphs = content.paragraphs as { title?: { text?: string }; body?: { plainText?: string[] }; images?: { url: string; key?: string }[] }[];
    if (!paragraphs?.length) {
      return '(empty paragraphs)';
    }
    const lines: string[] = [];
    for (const p of paragraphs) {
      if (p.title?.text) {
        lines.push(`**${p.title.text}**`);
      }
      if (p.body?.plainText?.length) {
        lines.push(truncate(p.body.plainText.join(' '), 200));
      }
      if (p.images?.length) {
        lines.push(p.images.map(img => img.url || (img.key && client ? client.mediaUrl(img.key) : img.key || 'image')).join(', '));
      }
    }
    return lines.join('\n');
  }

  // ContentChunkContent
  if ('chunks' in content) {
    const chunks = content.chunks as any[][];
    if (!chunks?.length) {
      return '(empty chunks)';
    }
    const lines: string[] = [`${chunks.length} chunk(s):`];
    for (let i = 0; i < chunks.length; i++) {
      const chunkLines: string[] = [];
      for (const comp of chunks[i]) {
        const val = comp.content
          ? formatComponentContent(comp.content, client, language)
          : '(no content)';
        if (!isEmptyValue(val)) {
          chunkLines.push(`    ${comp.id} (${comp.type}): ${val}`);
        }
      }
      if (chunkLines.length) {
        lines.push(`  Chunk ${i + 1}:`);
        lines.push(...chunkLines);
      }
    }
    return lines.length > 1 ? lines.join('\n') : '(empty chunks)';
  }

  // PieceContent — a component-in-component structure
  if ('components' in content && !('chunks' in content) && !('paragraphs' in content) && !('items' in content)) {
    const components = content.components as { id?: string; type?: string; name?: string; content?: Record<string, unknown> }[] | null;
    if (!components?.length) {
      return '(empty piece)';
    }
    const parts: string[] = [];
    for (const comp of components) {
      const val = comp.content
        ? formatComponentContent(comp.content, client, language)
        : '(no content)';
      if (!isEmptyValue(val)) {
        parts.push(`${comp.id ?? comp.name ?? 'field'}: ${val}`);
      }
    }
    return parts.length ? parts.join(', ') : '(empty piece)';
  }

  // ComponentChoiceContent
  if ('selectedComponent' in content) {
    const sel = content.selectedComponent as { id?: string; type?: string; content?: Record<string, unknown> } | null;
    if (!sel) {
      return '(no choice selected)';
    }
    const val = sel.content
      ? formatComponentContent(sel.content, client, language)
      : '(no content)';
    return `${sel.id ?? sel.type ?? 'choice'}: ${val}`;
  }

  // Fallback: extract and linkify any URL-like strings from the content
  return linkifyJsonContent(content, client);
}

/** Common media file extensions — used to avoid false-matching filenames as domains. */
const MEDIA_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|avif|svg|mp4|webm|mov|avi|mp3|wav|pdf|zip)$/i;

/**
 * Convert text that looks like a URL or catalogue path into a markdown link.
 * - Full URLs (https://...) → [url](url)
 * - Internal paths (/something) → [path](frontendUrl/path) if frontend configured
 * - Domain-like strings (foo.bar/...) → [text](https://text) (but NOT filenames)
 * - Plain text → returned unchanged
 */
function linkifyText(text: string, client?: CrystallizeClient): string {
  if (!text) {
    return '(empty)';
  }

  // Already a full URL
  if (/^https?:\/\//.test(text)) {
    return text;
  }

  // Internal catalogue path (starts with /)
  if (/^\/\S/.test(text)) {
    const frontendLink = client?.catalogueLink(text);
    if (frontendLink) {
      return frontendLink;
    }
    return text;
  }

  // Domain-like string without protocol (e.g. "dm.hageland.no/something")
  // But NOT bare filenames like "photo.jpg" or "video.mp4"
  if (
    /^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}/.test(text) &&
    !MEDIA_EXTENSIONS.test(text)
  ) {
    return `https://${text}`;
  }

  // Bare media filename — construct a Crystallize CDN link if we have a client
  if (MEDIA_EXTENSIONS.test(text) && client) {
    return client.mediaUrl(text);
  }

  return text;
}

/**
 * Walk a content object and extract any URL-like string values,
 * producing a readable line with links rather than raw JSON.
 */
function linkifyJsonContent(
  obj: Record<string, unknown>,
  client?: CrystallizeClient,
): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value === 'string') {
      if (!value) {
        continue;
      }
      const linked = linkifyText(value, client);
      parts.push(`${key}: ${linked}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}: ${value}`);
    } else if (Array.isArray(value)) {
      if (!value.length) {
        continue;
      }
      // For arrays of objects, try to extract name/url/path from each
      const items = value.map(item => {
        if (typeof item === 'string') {
          return linkifyText(item, client);
        }
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>;
          const url = o.url as string | undefined;
          if (url) {
            return url;
          }
          const label = String(o.name ?? o.title ?? o.key ?? o.id ?? '');
          if (label) {
            return label;
          }
        }
        return JSON.stringify(item);
      });
      parts.push(`${key}: ${items.join(', ')}`);
    } else if (typeof value === 'object') {
      // Nested object — try to find url/name
      const o = value as Record<string, unknown>;
      const url = o.url as string | undefined;
      if (url) {
        parts.push(`${key}: ${url}`);
      }
    }
  }

  return parts.length ? parts.join(' | ') : JSON.stringify(obj);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max) + '...';
}

/** Check if a formatted component value represents empty/no content. */
function isEmptyValue(val: string): boolean {
  return val === '(empty)' || val === '(no content)' || val === '(empty chunks)' || val === '(no images)' || val === '(no videos)' || val === '(no files)' || val === '(empty paragraphs)' || val === '(empty properties)' || val === '(no related items)' || val === '(no choice selected)' || val === '(no date)' || val === '(empty piece)';
}
