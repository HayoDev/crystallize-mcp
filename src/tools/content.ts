/**
 * Content write tools — create items and update components.
 *
 * Gated behind CRYSTALLIZE_ACCESS_MODE=write|admin.
 * Supports dry-run mode via CRYSTALLIZE_DRY_RUN=true.
 */

import { z } from 'zod';
import type { CrystallizeClient } from '../client.js';
import type { ToolDefinition, ToolResult } from '../types.js';

/** Build a dry-run preview response. */
function dryRunResult(lines: string[]): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: ['[DRY RUN] No changes made.', '', ...lines].join('\n'),
      },
    ],
  };
}

interface ComponentInput {
  componentId: string;
  [key: string]: unknown;
}

/** Map simple component values to PIM API input format. */
function buildComponentInput(
  componentId: string,
  componentType: string,
  value: unknown,
): ComponentInput {
  const base = { componentId };

  switch (componentType) {
    case 'singleLine':
      return { ...base, singleLine: { text: String(value) } };
    case 'richText':
      return {
        ...base,
        richText: {
          json: [
            {
              kind: 'block',
              type: 'paragraph',
              children: [{ kind: 'inline', textContent: String(value) }],
            },
          ],
        },
      };
    case 'boolean':
      return { ...base, boolean: { value: Boolean(value) } };
    case 'numeric':
      return { ...base, numeric: { number: Number(value) } };
    case 'selection':
      return {
        ...base,
        selection: { keys: Array.isArray(value) ? value : [String(value)] },
      };
    case 'images':
      return {
        ...base,
        images: (Array.isArray(value) ? value : [value])
          .filter(v => v != null)
          .map(v => {
            const imageValue =
              v != null && typeof v === 'object'
                ? (v as Record<string, unknown>)
                : {};
            return {
              ...imageValue,
              key: typeof v === 'string' ? v : String(imageValue.key ?? ''),
            };
          }),
      };
    default:
      return { ...base, [componentType]: value };
  }
}

/** Convert PIM API component read content back to ComponentInput for round-trip mutations. */
function contentToInput(
  componentId: string,
  componentType: string,
  content: Record<string, unknown> | null | undefined,
): ComponentInput | null {
  const base = { componentId };
  if (!content) {
    return null;
  }

  switch (componentType) {
    case 'singleLine': {
      if (content.text == null) {
        return null;
      }
      return { ...base, singleLine: { text: String(content.text) } };
    }
    case 'richText': {
      if (content.json != null) {
        return { ...base, richText: { json: content.json } };
      }
      if (content.plainText != null) {
        const text = Array.isArray(content.plainText)
          ? content.plainText.join('\n')
          : String(content.plainText);
        return {
          ...base,
          richText: {
            json: [
              {
                kind: 'block',
                type: 'paragraph',
                children: [{ kind: 'inline', textContent: text }],
              },
            ],
          },
        };
      }
      return null;
    }
    case 'boolean': {
      if (content.value == null) {
        return null;
      }
      return { ...base, boolean: { value: Boolean(content.value) } };
    }
    case 'numeric': {
      if (content.number == null) {
        return null;
      }
      const num: Record<string, unknown> = { number: Number(content.number) };
      if (content.unit) {
        num.unit = String(content.unit);
      }
      return { ...base, numeric: num };
    }
    case 'selection': {
      const opts = content.options;
      if (!Array.isArray(opts) || opts.length === 0) {
        return null;
      }
      return {
        ...base,
        selection: {
          keys: opts.map((o: Record<string, unknown>) => String(o.key)),
        },
      };
    }
    case 'images': {
      const imgs = content.images;
      if (!Array.isArray(imgs) || imgs.length === 0) {
        return null;
      }
      return {
        ...base,
        images: imgs.map((img: Record<string, unknown>) => {
          const out: Record<string, unknown> = {
            key: String(img.key ?? ''),
          };
          if (img.altText) {
            out.altText = String(img.altText);
          }
          return out;
        }),
      };
    }
    case 'itemRelations': {
      const items = content.items;
      if (!Array.isArray(items) || items.length === 0) {
        return null;
      }
      return {
        ...base,
        itemRelations: {
          itemIds: items.map((i: Record<string, unknown>) => String(i.id)),
        },
      };
    }
    default:
      return null;
  }
}

export function contentTools(client: CrystallizeClient): ToolDefinition[] {
  return [
    {
      name: 'create_item',
      description:
        'Create a new item (product, document, or folder) in the catalogue. The item type is determined by the shape. Use get_shape first to understand available components. Respects CRYSTALLIZE_DRY_RUN — when enabled, returns a preview without creating.',
      mode: 'write',
      schema: {
        name: z.string().min(1).describe('Item name'),
        shapeIdentifier: z
          .string()
          .min(1)
          .describe(
            'Shape identifier — use list_shapes to find available shapes',
          ),
        parentPath: z
          .string()
          .default('/')
          .describe(
            'Parent catalogue path to create the item under, e.g. "/shop/plants"',
          ),
        components: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'Components as { componentId: value } — use get_shape to see available component IDs and types',
          ),
        language: z
          .string()
          .default('en')
          .describe('Language code for the item name and components'),
      },
      handler: async params => {
        const { name, shapeIdentifier, parentPath, components, language } =
          params;

        // Validate shape exists and get its type + components
        const shapeQuery = `
          query GetShape($identifier: String!, $tenantId: ID!) {
            shape { get(identifier: $identifier, tenantId: $tenantId) {
              identifier
              name
              type
              components { id name type }
            }}
          }
        `;
        const shapeData = (await client.api.pimApi(shapeQuery, {
          identifier: shapeIdentifier,
          tenantId: client.config.tenantId,
        })) as ShapeResponse;
        const shape = shapeData.shape?.get;

        if (!shape) {
          return {
            content: [
              {
                type: 'text',
                text: `Shape "${shapeIdentifier}" not found. Use list_shapes to see available shapes.`,
              },
            ],
            isError: true,
          };
        }

        // Build component inputs
        const componentInputs: ComponentInput[] = [];
        if (components) {
          for (const [compId, value] of Object.entries(components)) {
            const compDef = shape.components?.find(c => c.id === compId);
            if (!compDef) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `Component "${compId}" not found on shape "${shapeIdentifier}". Available: ${(shape.components ?? []).map(c => c.id).join(', ')}`,
                  },
                ],
                isError: true,
              };
            }
            componentInputs.push(
              buildComponentInput(compId, compDef.type, value),
            );
          }
        }

        const itemType = shape.type.toLowerCase();

        // Dry-run preview
        if (client.config.dryRun) {
          const lines = [
            `Would create ${itemType}: "${name}"`,
            `  Shape: ${shape.name} (${shape.identifier})`,
            `  Parent: ${parentPath}`,
            `  Language: ${language}`,
          ];
          if (componentInputs.length > 0) {
            lines.push('', 'Components:');
            for (const input of componentInputs) {
              lines.push(
                `  ${input.componentId}: ${JSON.stringify(input, null, 2)}`,
              );
            }
          }
          lines.push(
            '',
            `Mutation: item.create(name: "${name}", shapeIdentifier: "${shapeIdentifier}", tree.parentPath: "${parentPath}")`,
          );
          return dryRunResult(lines);
        }

        // Execute mutation via PIM API
        const createInput: Record<string, unknown> = {
          name: [{ language, value: name }],
          shapeIdentifier,
          tenantId: client.config.tenantId,
          tree: { parentPath },
        };
        if (componentInputs.length > 0) {
          createInput.components = componentInputs;
        }

        const mutation = `
          mutation CreateItem($input: Create${capitalize(itemType)}Input!, $language: String!) {
            ${itemType} {
              create(input: $input, language: $language) {
                id
                name
                tree { path }
              }
            }
          }
        `;

        const result = (await client.api.pimApi(mutation, {
          input: createInput,
          language,
        })) as CreateItemResponse;
        const created = result[itemType]?.create;

        if (!created) {
          return {
            content: [
              {
                type: 'text',
                text: 'Item creation failed — no response from API.',
              },
            ],
            isError: true,
          };
        }

        const path = created.tree?.path ?? parentPath;
        return {
          content: [
            {
              type: 'text',
              text: [
                `Created ${itemType}: "${created.name}"`,
                `  ID: ${created.id}`,
                `  Path: ${path}`,
                `  Link: ${client.itemLink(created.id, itemType, language)}`,
                `  Shape: ${client.shapeLink(shapeIdentifier, language)}`,
              ].join('\n'),
            },
          ],
          mutation: {
            type: 'create',
            after: {
              id: created.id,
              name: created.name,
              path,
              shapeIdentifier,
            },
          },
        };
      },
    },

    {
      name: 'update_component',
      description:
        'Update a single component on a catalogue item. Supports nested components inside content chunks using dot notation (e.g. "image-and-title.title"). Use get_item to see current values and get_shape to understand component types. Respects CRYSTALLIZE_DRY_RUN — when enabled, returns a before/after preview without changing anything.',
      mode: 'write',
      schema: {
        itemId: z
          .string()
          .min(1)
          .describe('Item ID — use get_item or browse_catalogue to find it'),
        componentId: z
          .string()
          .min(1)
          .describe(
            'Component ID to update. For nested components inside content chunks, use dot notation: "chunkId.childId" (e.g. "image-and-title.title")',
          ),
        value: z.unknown().describe('New value for the component'),
        language: z.string().default('en').describe('Language code'),
      },
      handler: async params => {
        const { itemId, value, language } = params;
        const componentId = String(params.componentId);

        // Parse dot notation for nested components
        const parts = componentId.split('.');
        const topLevelId = parts[0];
        const childId = parts.length > 1 ? parts.slice(1).join('.') : undefined;

        // Fetch current item via PIM API for shape info (including chunk children)
        const itemQuery = `
          query GetItemForUpdate($id: ID!, $language: String!) {
            item {
              get(id: $id, language: $language, versionLabel: draft) {
                id
                name
                type
                tree { path }
                shape {
                  identifier
                  name
                  components {
                    id
                    name
                    type
                    config {
                      ... on ContentChunkComponentConfig {
                        components { id name type }
                      }
                    }
                  }
                }
              }
            }
          }
        `;

        const itemData = (await client.api.pimApi(itemQuery, {
          id: itemId,
          language,
        })) as ItemForUpdateResponse;
        const item = itemData.item?.get;

        if (!item) {
          return {
            content: [
              {
                type: 'text',
                text: `Item "${itemId}" not found. Use browse_catalogue or search_catalogue to find items.`,
              },
            ],
            isError: true,
          };
        }

        // Find the component definition on the shape
        const topLevelComp = item.shape?.components?.find(
          c => c.id === topLevelId,
        );
        if (!topLevelComp) {
          const available = (item.shape?.components ?? [])
            .map(c => c.id)
            .join(', ');
          return {
            content: [
              {
                type: 'text',
                text: `Component "${topLevelId}" not found on shape "${item.shape?.identifier}". Available: ${available}`,
              },
            ],
            isError: true,
          };
        }

        // Resolve the target component type (may be nested in a chunk)
        let targetType = topLevelComp.type;
        let targetName = topLevelComp.name;
        if (childId && topLevelComp.type === 'contentChunk') {
          const chunkChildren = topLevelComp.config?.components ?? [];
          const childComp = chunkChildren.find(
            (c: ShapeComponent) => c.id === childId,
          );
          if (!childComp) {
            const available = chunkChildren
              .map((c: ShapeComponent) => c.id)
              .join(', ');
            return {
              content: [
                {
                  type: 'text',
                  text: `Child component "${childId}" not found in chunk "${topLevelId}". Available: ${available}`,
                },
              ],
              isError: true,
            };
          }
          targetType = childComp.type;
          targetName = `${topLevelComp.name} → ${childComp.name}`;
        } else if (childId) {
          return {
            content: [
              {
                type: 'text',
                text: `Dot notation "${componentId}" is only supported for contentChunk components. "${topLevelId}" is type "${topLevelComp.type}".`,
              },
            ],
            isError: true,
          };
        }

        // Build the component input for the Core API
        const innerInput = buildComponentInput(
          childId ?? topLevelId,
          targetType,
          value,
        );

        // Fetch current value and build mutation input
        let currentValue = '(not available)';
        let componentInput: ComponentInput;

        if (childId) {
          // For chunk children: fetch existing siblings via PIM API,
          // extract previous value from the target child, and merge
          let allChunkChildren: ComponentInput[] = [innerInput];
          try {
            const chunkQuery = `
              query GetChunkContent($id: ID!, $language: String!) {
                item {
                  get(id: $id, language: $language, versionLabel: draft) {
                    components {
                      componentId
                      type
                      content {
                        ... on ContentChunkContent {
                          chunks {
                            componentId
                            type
                            content {
                              ... on SingleLineContent { text }
                              ... on RichTextContent { json plainText }
                              ... on BooleanContent { value }
                              ... on NumericContent { number unit }
                              ... on SelectionContent { options { key value } }
                              ... on ImageContent { images { url key altText } }
                              ... on ItemRelationsContent { items { id } }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            `;
            const chunkData = (await client.api.pimApi(chunkQuery, {
              id: itemId,
              language,
            })) as ChunkContentResponse;
            const components = chunkData?.item?.get?.components ?? [];
            const chunkComp = components.find(
              (c: { componentId: string }) => c.componentId === topLevelId,
            );
            const firstRow = chunkComp?.content?.chunks?.[0];
            if (firstRow) {
              // Extract the current value from the target child
              const targetChild = firstRow.find(
                (c: ChunkChild) => c.componentId === childId,
              );
              if (targetChild?.content) {
                currentValue = formatContentValue(targetChild.content);
              }

              let foundTarget = false;
              const merged = firstRow
                .map((c: ChunkChild) => {
                  if (c.componentId === childId) {
                    foundTarget = true;
                    return innerInput;
                  }
                  return contentToInput(c.componentId, c.type, c.content);
                })
                .filter(
                  (v: ComponentInput | null): v is ComponentInput => v !== null,
                );
              if (!foundTarget) {
                merged.push(innerInput);
              }
              allChunkChildren = merged;
            }
          } catch {
            // Non-critical — fall back to sending only the target child
          }

          componentInput = {
            componentId: topLevelId,
            contentChunk: {
              chunks: [allChunkChildren],
            },
          };
        } else {
          // For top-level components: fetch current value via Catalogue API
          const itemPath = item.tree?.path;
          if (itemPath) {
            try {
              const catQuery = `
                query GetComponentValue($path: String!, $language: String!) {
                  catalogue(path: $path, language: $language) {
                    component(id: "${topLevelId}") {
                      content {
                        ... on SingleLineContent { text }
                        ... on RichTextContent { plainText }
                        ... on BooleanContent { value }
                        ... on NumericContent { number unit }
                        ... on SelectionContent { options { key value } }
                      }
                    }
                  }
                }
              `;
              const catData = (await client.api.catalogueApi(catQuery, {
                path: itemPath,
                language,
              })) as CatalogueComponentResponse;
              const content = catData.catalogue?.component?.content;
              if (content) {
                currentValue = formatContentValue(content);
              }
            } catch {
              // Non-critical — proceed with update even if we can't read current value
            }
          }
          componentInput = innerInput;
        }

        // Dry-run preview
        if (client.config.dryRun) {
          const lines = [
            `Would update component on: "${item.name}" (${item.type})`,
            `  Item ID: ${itemId}`,
            `  Component: ${targetName} (${componentId}, type: ${targetType})`,
            `  Language: ${language}`,
            '',
            `Current value: ${currentValue}`,
            `New value: ${JSON.stringify(value)}`,
            '',
            `Mutation: item.updateComponent(itemId: "${itemId}", language: "${language}", component: ${JSON.stringify(componentInput)})`,
            '',
            `Link: ${client.itemLink(itemId, item.type, language)}`,
          ];
          return dryRunResult(lines);
        }

        // Execute mutation via Core API (nextPimApi)
        // updateComponent targets a single component without affecting others
        const mutation = `
          mutation UpdateComponent($itemId: ID!, $language: String!, $component: ComponentInput!) {
            updateComponent(
              itemId: $itemId
              language: $language
              component: $component
            ) {
              ... on UpdatedComponent { item { id } }
              ... on BasicError { errorName message }
            }
          }
        `;

        const result = (await client.api.nextPimApi(mutation, {
          itemId,
          language,
          component: componentInput,
        })) as UpdateComponentResponse;

        const updateResult = result.updateComponent;
        if (updateResult?.errorName) {
          return {
            content: [
              {
                type: 'text',
                text: `Update failed: ${updateResult.errorName} — ${updateResult.message}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: [
                `Updated "${targetName}" on "${item.name}"`,
                `  Component: ${componentId} (${targetType})`,
                `  Previous: ${currentValue}`,
                `  New: ${JSON.stringify(value)}`,
                `  Link: ${client.itemLink(itemId, item.type, language)}`,
              ].join('\n'),
            },
          ],
          mutation: {
            type: 'update',
            before: { [componentId]: currentValue },
            after: { [componentId]: value },
          },
        };
      },
    },
  ];
}

// --- Helpers ---

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatContentValue(content: Record<string, unknown>): string {
  if ('text' in content && content.text != null) {
    return String(content.text);
  }
  if ('plainText' in content && content.plainText != null) {
    return String(content.plainText);
  }
  if ('value' in content && content.value != null) {
    return String(content.value);
  }
  if ('number' in content && content.number != null) {
    const unit = 'unit' in content && content.unit ? ` ${content.unit}` : '';
    return `${content.number}${unit}`;
  }
  if ('options' in content && Array.isArray(content.options)) {
    return content.options
      .map((o: Record<string, unknown>) => o.value ?? o.key)
      .join(', ');
  }
  if ('images' in content && Array.isArray(content.images)) {
    const imgs = content.images as { key?: string; altText?: string }[];
    if (imgs.length === 0) {
      return '(no images)';
    }
    const label = imgs[0].altText || imgs[0].key || 'image';
    return imgs.length === 1 ? label : `${label} (+${imgs.length - 1} more)`;
  }
  if ('items' in content && Array.isArray(content.items)) {
    const n = content.items.length;
    return n === 0 ? '(no relations)' : `${n} related item${n > 1 ? 's' : ''}`;
  }
  if ('files' in content && Array.isArray(content.files)) {
    const n = content.files.length;
    return n === 0 ? '(no files)' : `${n} file${n > 1 ? 's' : ''}`;
  }
  if ('json' in content) {
    return '(rich text)';
  }
  return '(complex value)';
}

// --- Internal types ---

interface ShapeComponent {
  id: string;
  name: string;
  type: string;
  config?: {
    components?: ShapeComponent[];
  };
}

interface ShapeResponse {
  shape?: {
    get?: {
      identifier: string;
      name: string;
      type: string;
      components?: ShapeComponent[];
    };
  };
}

interface CreateItemResponse {
  [key: string]: {
    create?: {
      id: string;
      name: string;
      tree?: { path?: string };
    };
  };
}

interface ItemForUpdateResponse {
  item?: {
    get?: {
      id: string;
      name: string;
      type: string;
      tree?: { path?: string };
      shape?: {
        identifier: string;
        name: string;
        components?: ShapeComponent[];
      };
    };
  };
}

interface ChunkChild {
  componentId: string;
  type: string;
  content?: Record<string, unknown> | null;
}

interface ChunkContentResponse {
  item?: {
    get?: {
      components?: {
        componentId: string;
        type: string;
        content?: {
          chunks?: ChunkChild[][];
        };
      }[];
    };
  };
}

interface CatalogueComponentResponse {
  catalogue?: {
    component?: {
      content?: Record<string, unknown>;
    };
  };
}

interface UpdateComponentResponse {
  updateComponent?: {
    item?: { id: string };
    errorName?: string;
    message?: string;
  };
}
