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
      return { ...base, richText: { plainText: [String(value)] } };
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

export function contentTools(client: CrystallizeClient): ToolDefinition[] {
  const defaultLang = () => client.config.defaultLanguage ?? 'en';
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
          .optional()
          .describe(
            'Language code for the item name and components (defaults to tenant language)',
          ),
      },
      handler: async params => {
        const { name, shapeIdentifier, parentPath, components } = params;
        const language = (params.language as string) || defaultLang();

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
                `  Edit: ${client.itemLink(created.id, itemType, language)}`,
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
        'Update a single component on a catalogue item. Use get_item to see current values and get_shape to understand component types. Respects CRYSTALLIZE_DRY_RUN — when enabled, returns a before/after preview without changing anything.',
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
            'Component ID to update — use get_shape to see available components',
          ),
        value: z.unknown().describe('New value for the component'),
        language: z
          .string()
          .optional()
          .describe('Language code (defaults to tenant language)'),
      },
      handler: async params => {
        const { itemId, componentId, value } = params;
        const language = (params.language as string) || defaultLang();

        // Fetch current item to get shape and current component value
        const itemQuery = `
          query GetItemForUpdate($id: ID!, $language: String!) {
            item {
              get(id: $id, language: $language, versionLabel: draft) {
                id
                name
                type
                shape { identifier name components { id name type } }
                components {
                  componentId
                  type
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
          }
        `;

        const itemData = (await client.api.pimApi(itemQuery, {
          id: itemId,
          language,
        })) as CoreItemResponse;
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
        const compDef = item.shape?.components?.find(c => c.id === componentId);
        if (!compDef) {
          const available = (item.shape?.components ?? [])
            .map(c => c.id)
            .join(', ');
          return {
            content: [
              {
                type: 'text',
                text: `Component "${componentId}" not found on shape "${item.shape?.identifier}". Available: ${available}`,
              },
            ],
            isError: true,
          };
        }

        const currentComp = item.components?.find(
          c => c.componentId === componentId,
        );
        const currentValue = formatCurrentValue(currentComp);

        const componentInput = buildComponentInput(
          componentId,
          compDef.type,
          value,
        );

        // Dry-run preview
        if (client.config.dryRun) {
          const lines = [
            `Would update component on: "${item.name}" (${item.type})`,
            `  Item ID: ${itemId}`,
            `  Component: ${compDef.name} (${componentId}, type: ${compDef.type})`,
            `  Language: ${language}`,
            '',
            `Current value: ${currentValue}`,
            `New value: ${JSON.stringify(value)}`,
            '',
            `Mutation: item.updateComponent(itemId: "${itemId}", language: "${language}", component: ${JSON.stringify(componentInput)})`,
            '',
            `Edit: ${client.itemLink(itemId, item.type, language)}`,
          ];
          return dryRunResult(lines);
        }

        // Execute mutation via Core API (nextPimApi)
        const mutation = `
          mutation UpdateComponent($itemId: ID!, $language: String!, $component: ComponentInput!) {
            item {
              updateComponent(
                itemId: $itemId
                language: $language
                component: $component
              ) {
                ... on UpdatedItem { itemId }
                ... on BasicError { errorName message }
              }
            }
          }
        `;

        const result = (await client.api.nextPimApi(mutation, {
          itemId,
          language,
          component: componentInput,
        })) as UpdateComponentResponse;

        const updateResult = result.item?.updateComponent;
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
                `Updated "${compDef.name}" on "${item.name}"`,
                `  Component: ${componentId} (${compDef.type})`,
                `  Previous: ${currentValue}`,
                `  New: ${JSON.stringify(value)}`,
                `  Edit: ${client.itemLink(itemId, item.type, language)}`,
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

function formatCurrentValue(comp: CoreComponentContent | undefined): string {
  const c = comp?.content;
  if (!c) {
    return '(empty)';
  }
  if (c.text != null) {
    return String(c.text);
  }
  if (c.plainText != null) {
    return String(c.plainText);
  }
  if (c.value != null) {
    return String(c.value);
  }
  if (c.number != null) {
    return c.unit ? `${c.number} ${c.unit}` : String(c.number);
  }
  if (c.options) {
    return c.options.map(o => o.value).join(', ');
  }
  return '(unknown)';
}

// --- Internal types ---

interface ShapeComponent {
  id: string;
  name: string;
  type: string;
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

interface CoreComponentContent {
  componentId: string;
  type: string;
  content?: {
    text?: string;
    plainText?: string;
    value?: boolean;
    number?: number;
    unit?: string;
    options?: { key: string; value: string }[];
  };
}

interface CoreItemResponse {
  item?: {
    get?: {
      id: string;
      name: string;
      type: string;
      shape?: {
        identifier: string;
        name: string;
        components?: ShapeComponent[];
      };
      components?: CoreComponentContent[];
    };
  };
}

interface UpdateComponentResponse {
  item?: {
    updateComponent?: {
      itemId?: string;
      errorName?: string;
      message?: string;
    };
  };
}
