/**
 * Shape & tenant tools — inspect shapes, components, and tenant configuration.
 */

import {z} from 'zod';
import type {CrystallizeClient} from '../client.js';
import type {ToolDefinition} from '../types.js';

export function shapeTools(client: CrystallizeClient): ToolDefinition[] {
  return [
    {
      name: 'list_shapes',
      description:
        'List all shapes defined in the tenant. Returns shape names, identifiers, types, and component counts with deep links to the Crystallize UI.',
      schema: {},
      handler: async () => {
        const query = `
          query ListShapes {
            shape {
              getMany {
                identifier
                name
                type
                components {
                  id
                  name
                  type
                }
              }
            }
          }
        `;

        const data = await client.api.pimApi(query);
        const shapes = (data as {shape: {getMany: ShapeSummary[]}}).shape.getMany;

        if (!shapes?.length) {
          return {
            content: [{type: 'text', text: 'No shapes found in this tenant.'}],
          };
        }

        const lines: string[] = [`${shapes.length} shape(s) in tenant "${client.config.tenantIdentifier}":\n`];

        for (const shape of shapes) {
          lines.push(`${shape.name} (${shape.identifier}) [${shape.type}]`);
          lines.push(`  Components: ${shape.components?.length ?? 0}`);
          if (shape.components?.length) {
            const componentList = shape.components.map(c => `${c.id} (${c.type})`).join(', ');
            lines.push(`  ${componentList}`);
          }
          lines.push(`  Link: ${client.shapeLink(shape.identifier)}`);
          lines.push('');
        }

        return {
          content: [{type: 'text', text: lines.join('\n')}],
        };
      },
    },

    {
      name: 'get_shape',
      description:
        'Get the full component definition for a shape. Shows all components with their types, descriptions, and configuration. Useful for understanding what data a shape expects.',
      schema: {
        identifier: z.string().describe('Shape identifier, e.g. "product" or "blog-post"'),
      },
      handler: async (params) => {
        const {identifier} = params;

        const query = `
          query GetShape($identifier: String!) {
            shape {
              get(identifier: $identifier) {
                identifier
                name
                type
                components {
                  id
                  name
                  type
                  description
                  config {
                    ... on ComponentConfig {
                      min
                      max
                    }
                  }
                }
                variantComponents {
                  id
                  name
                  type
                  description
                }
              }
            }
          }
        `;

        const data = await client.api.pimApi(query, {identifier});
        const shape = (data as {shape: {get: ShapeDetail | null}}).shape.get;

        if (!shape) {
          return {
            content: [{type: 'text', text: `Shape "${identifier}" not found. Use list_shapes to see available shapes.`}],
            isError: true,
          };
        }

        const lines: string[] = [
          `${shape.name} (${shape.identifier}) [${shape.type}]`,
          `Link: ${client.shapeLink(shape.identifier)}`,
          '',
        ];

        if (shape.components?.length) {
          lines.push(`Item Components (${shape.components.length}):`);
          for (const comp of shape.components) {
            lines.push(`  ${comp.id} — ${comp.name} [${comp.type}]`);
            if (comp.description) {
              lines.push(`    ${comp.description}`);
            }
          }
          lines.push('');
        }

        if (shape.variantComponents?.length) {
          lines.push(`Variant Components (${shape.variantComponents.length}):`);
          for (const comp of shape.variantComponents) {
            lines.push(`  ${comp.id} — ${comp.name} [${comp.type}]`);
            if (comp.description) {
              lines.push(`    ${comp.description}`);
            }
          }
        }

        return {
          content: [{type: 'text', text: lines.join('\n')}],
        };
      },
    },

    {
      name: 'get_tenant_info',
      description:
        'Get tenant configuration including name, identifier, available languages, and default language.',
      schema: {},
      handler: async () => {
        const query = `
          query GetTenant {
            tenant {
              get {
                id
                identifier
                name
                defaults {
                  language
                  currency
                }
                availableLanguages {
                  code
                  name
                }
              }
            }
          }
        `;

        const data = await client.api.pimApi(query);
        const tenant = (data as {tenant: {get: TenantInfo}}).tenant.get;

        const lines: string[] = [
          `${tenant.name}`,
          `  Identifier: ${tenant.identifier}`,
          `  ID: ${tenant.id}`,
          `  Default language: ${tenant.defaults?.language ?? 'en'}`,
          `  Default currency: ${tenant.defaults?.currency ?? 'n/a'}`,
          `  UI: https://app.crystallize.com/${tenant.identifier}`,
        ];

        if (tenant.availableLanguages?.length) {
          const langs = tenant.availableLanguages.map(l => `${l.name} (${l.code})`).join(', ');
          lines.push(`  Languages: ${langs}`);
        }

        return {
          content: [{type: 'text', text: lines.join('\n')}],
        };
      },
    },
  ];
}

// --- Internal types ---

interface ShapeSummary {
  identifier: string;
  name: string;
  type: string;
  components?: {id: string; name: string; type: string}[];
}

interface ShapeDetail extends ShapeSummary {
  components?: ComponentDetail[];
  variantComponents?: ComponentDetail[];
}

interface ComponentDetail {
  id: string;
  name: string;
  type: string;
  description?: string;
  config?: Record<string, unknown>;
}

interface TenantInfo {
  id: string;
  identifier: string;
  name: string;
  defaults?: {language?: string; currency?: string};
  availableLanguages?: {code: string; name: string}[];
}
