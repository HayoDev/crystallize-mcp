/**
 * Discovery API tools — browse shapes, introspect schema, search via browse.
 *
 * Uses the Discovery API's semantic browse queries where each shape
 * is a top-level field with its own filters, pagination, and fields.
 */

import { z } from 'zod';
import type { CrystallizeClient } from '../client.js';
import type { ToolDefinition } from '../types.js';

/** Cache introspected schema per tenant to avoid repeated introspection. */
let schemaCache: { shapes: ShapeInfo[]; timestamp: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface ShapeInfo {
  name: string;
  queryTypeName: string;
  hitTypeName: string;
  fields: FieldInfo[];
}

interface FieldInfo {
  name: string;
  typeName: string;
  kind: string;
  isScalar: boolean;
}

async function introspectShapes(
  client: CrystallizeClient,
): Promise<ShapeInfo[]> {
  if (schemaCache && Date.now() - schemaCache.timestamp < CACHE_TTL_MS) {
    return schemaCache.shapes;
  }

  // Step 1: Get all browse entry points (shapes)
  const browseData = (await client.api.discoveryApi(`{
    __type(name: "BrowseQuery") {
      fields {
        name
        type { kind ofType { name kind } }
      }
    }
  }`)) as {
    __type: {
      fields: {
        name: string;
        type: { kind: string; ofType: { name: string; kind: string } };
      }[];
    };
  };

  const shapeEntries = browseData.__type.fields;

  // Step 2: For each shape, get the hit type's fields
  // Batch introspect hit types (the hit type name = lowercase shape name)
  const hitTypeQueries = shapeEntries
    .map(
      (s, i) =>
        `s${i}: __type(name: "${s.name}") { fields { name type { name kind ofType { name kind ofType { name } } } } }`,
    )
    .join('\n');

  const hitData = (await client.api.discoveryApi(
    `{ ${hitTypeQueries} }`,
  )) as Record<
    string,
    {
      fields: {
        name: string;
        type: {
          name: string | null;
          kind: string;
          ofType: {
            name: string | null;
            kind: string;
            ofType: { name: string | null } | null;
          } | null;
        };
      }[];
    } | null
  >;

  const shapes: ShapeInfo[] = shapeEntries.map((entry, i) => {
    const hitType = hitData[`s${i}`];
    const fields: FieldInfo[] = (hitType?.fields ?? []).map(f => {
      const t = f.type;
      const typeName =
        t.name ?? t.ofType?.name ?? t.ofType?.ofType?.name ?? t.kind;
      const isScalar = t.kind === 'SCALAR' || t.kind === 'ENUM';
      return { name: f.name, typeName, kind: t.kind, isScalar };
    });

    return {
      name: entry.name,
      queryTypeName: entry.type.ofType?.name ?? entry.name,
      hitTypeName: entry.name,
      fields,
    };
  });

  schemaCache = { shapes, timestamp: Date.now() };
  return shapes;
}

/** Get scalar fields for a shape that are useful for a summary view. */
function getDefaultFields(shape: ShapeInfo): string[] {
  const always = ['name', 'path', 'itemId'];
  const useful = [
    'externalReference',
    'language',
    'type',
    'shape',
    'publishedAt',
  ];
  const result = always.filter(f => shape.fields.some(sf => sf.name === f));

  for (const field of useful) {
    if (shape.fields.some(sf => sf.name === field && sf.isScalar)) {
      result.push(field);
    }
  }
  return result;
}

export function discoveryTools(client: CrystallizeClient): ToolDefinition[] {
  return [
    {
      name: 'list_discovery_shapes',
      description:
        'List all shapes available in the Discovery API with their queryable fields. Use this to understand what shapes exist and what data you can query before calling browse_shape.',
      schema: {
        verbose: z
          .boolean()
          .default(false)
          .describe(
            'If true, show all fields per shape. If false, show only shape names and field counts.',
          ),
      },
      handler: async params => {
        const shapes = await introspectShapes(client);

        const lines: string[] = [
          `${shapes.length} shapes in tenant "${client.config.tenantIdentifier}":\n`,
        ];

        for (const shape of shapes) {
          if (params.verbose) {
            lines.push(`${shape.name} (${shape.fields.length} fields)`);
            const scalarFields = shape.fields.filter(f => f.isScalar);
            const objectFields = shape.fields.filter(f => !f.isScalar);

            if (scalarFields.length > 0) {
              lines.push(
                `  Scalar: ${scalarFields.map(f => f.name).join(', ')}`,
              );
            }
            if (objectFields.length > 0) {
              lines.push(
                `  Objects: ${objectFields.map(f => `${f.name} (${f.typeName})`).join(', ')}`,
              );
            }
            lines.push('');
          } else {
            const scalarCount = shape.fields.filter(f => f.isScalar).length;
            const objectCount = shape.fields.filter(f => !f.isScalar).length;
            lines.push(
              `  ${shape.name} — ${scalarCount} scalar, ${objectCount} object fields`,
            );
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      },
    },

    {
      name: 'browse_shape',
      description:
        'Browse items of a specific shape using the Discovery API. Supports pagination, search terms, and selecting specific fields. Use list_discovery_shapes first to see available shapes and fields.',
      schema: {
        shape: z
          .string()
          .describe(
            'Shape name to browse, e.g. "produktHageland", "hagesenter", "kategori"',
          ),
        fields: z
          .array(z.string())
          .optional()
          .describe(
            'Fields to return on each hit. Omit for default fields (name, path, itemId). Use list_discovery_shapes with verbose=true to see available fields.',
          ),
        variant_fields: z
          .array(z.string())
          .optional()
          .describe(
            'Fields to return on defaultVariant (for product shapes), e.g. ["sku", "name", "defaultPrice"]',
          ),
        term: z
          .string()
          .optional()
          .describe('Search term to filter results within this shape'),
        limit: z.number().default(10).describe('Number of results (max 100)'),
        after: z
          .string()
          .optional()
          .describe('Pagination token from a previous result (endToken)'),
      },
      handler: async params => {
        const shapes = await introspectShapes(client);
        const shape = shapes.find(s => s.name === params.shape);

        if (!shape) {
          const available = shapes.map(s => s.name).join(', ');
          return {
            content: [
              {
                type: 'text',
                text: `Shape "${params.shape}" not found.\n\nAvailable shapes: ${available}`,
              },
            ],
            isError: true,
          };
        }

        const limit = Math.min(Math.max(params.limit, 1), 100);

        // Build field selection
        const selectedFields = params.fields ?? getDefaultFields(shape);
        // Validate fields exist on shape
        const invalidFields = selectedFields.filter(
          (f: string) => !shape.fields.some(sf => sf.name === f),
        );
        if (invalidFields.length > 0) {
          const available = shape.fields.map(f => f.name).join(', ');
          return {
            content: [
              {
                type: 'text',
                text: `Invalid fields for shape "${params.shape}": ${invalidFields.join(', ')}\n\nAvailable: ${available}`,
              },
            ],
            isError: true,
          };
        }

        // Build variant fields if requested
        let variantSelection = '';
        if (params.variant_fields?.length) {
          const hasVariants = shape.fields.some(
            f => f.name === 'defaultVariant',
          );
          if (hasVariants) {
            variantSelection = `defaultVariant { ${params.variant_fields.join(' ')} }`;
          }
        }

        // Build query args
        const args: string[] = [
          `pagination: { limit: ${limit}${params.after ? `, after: "${params.after}"` : ''} }`,
        ];
        if (params.term) {
          args.push(`term: "${params.term.replace(/"/g, '\\"')}"`);
        }

        const query = `{
          browse {
            ${params.shape}(${args.join(', ')}) {
              summary { totalHits hasMoreHits endToken }
              hits {
                ${selectedFields.join('\n                ')}
                ${variantSelection}
              }
            }
          }
        }`;

        const data = (await client.api.discoveryApi(query)) as {
          browse: Record<
            string,
            { summary: Summary; hits: Record<string, unknown>[] }
          >;
        };

        const result = data.browse[params.shape];

        if (!result?.hits?.length) {
          return {
            content: [
              {
                type: 'text',
                text: `No results for shape "${params.shape}"${params.term ? ` with term "${params.term}"` : ''}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: formatBrowseResult(params.shape, result, client),
            },
          ],
        };
      },
    },

    {
      name: 'get_shape_fields',
      description:
        'Get detailed field information for a specific shape in the Discovery API. Shows all scalar and object fields with their types.',
      schema: {
        shape: z.string().describe('Shape name, e.g. "produktHageland"'),
      },
      handler: async params => {
        const shapes = await introspectShapes(client);
        const shape = shapes.find(s => s.name === params.shape);

        if (!shape) {
          const available = shapes.map(s => s.name).join(', ');
          return {
            content: [
              {
                type: 'text',
                text: `Shape "${params.shape}" not found.\n\nAvailable: ${available}`,
              },
            ],
            isError: true,
          };
        }

        const lines: string[] = [
          `${shape.name} — ${shape.fields.length} fields`,
          `Link: ${client.shapeLink(shape.name)}`,
          '',
          'Fields:',
        ];

        for (const field of shape.fields) {
          const scalar = field.isScalar ? '' : ' (object)';
          lines.push(`  ${field.name}: ${field.typeName}${scalar}`);
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      },
    },
  ];
}

// --- Internal types ---

interface Summary {
  totalHits: number;
  hasMoreHits: boolean;
  endToken: string | null;
}

// --- Formatters ---

function formatBrowseResult(
  shapeName: string,
  result: { summary: Summary; hits: Record<string, unknown>[] },
  client: CrystallizeClient,
): string {
  const { summary, hits } = result;

  const lines: string[] = [
    `${shapeName} — ${summary.totalHits} total, showing ${hits.length}`,
    '',
  ];

  for (const hit of hits) {
    const name = (hit.name as string) ?? 'Unnamed';
    const itemId = hit.itemId as string | undefined;

    lines.push(`${name}`);

    // Show all scalar fields except name (already shown)
    for (const [key, value] of Object.entries(hit)) {
      if (key === 'name') {
        continue;
      }
      if (value === null || value === undefined) {
        continue;
      }

      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        lines.push(`  ${key}: ${value}`);
      } else if (typeof value === 'object') {
        lines.push(`  ${key}: ${JSON.stringify(value)}`);
      }
    }

    if (itemId) {
      lines.push(`  Link: ${client.itemLink(itemId)}`);
    }
    lines.push('');
  }

  if (summary.hasMoreHits && summary.endToken) {
    lines.push(
      `--- More results available. Use after: "${summary.endToken}" to paginate ---`,
    );
  }

  return lines.join('\n');
}
