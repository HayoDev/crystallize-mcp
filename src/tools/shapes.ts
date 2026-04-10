/**
 * Shape & tenant tools — inspect shapes, components, and tenant configuration.
 *
 * All queries are built dynamically via PIM API introspection — no hardcoded GraphQL.
 * Uses a multi-step approach: first introspect the schema to discover types,
 * then do targeted __type queries for any nested types that need deeper detail.
 */

import { z } from 'zod';
import type { CrystallizeClient } from '../client.js';
import type { ToolDefinition } from '../types.js';
import {
  introspectApi,
  execNestedWithRetry,
  type ApiSchema,
} from './introspect.js';

// --- PIM introspection (delegates to shared engine) ---

function introspectPim(client: CrystallizeClient): Promise<ApiSchema> {
  return introspectApi(
    'pim',
    (q, v) => client.api.pimApi(q, v ?? {}),
    [['shape', 'get'], ['shape', 'getMany'], ['tenant', 'get']],
  );
}

// --- Config formatting ---

/** Extract and format relevant config properties from a component. */
function formatComponentConfig(comp: any, lines: string[], indent: string): void {
  const config = comp.config;
  if (!config || typeof config !== 'object') {
    return;
  }

  const props: string[] = [];

  // Common config fields across component types
  if (config.repeatable !== undefined) {
    props.push(`repeatable: ${config.repeatable}`);
  }
  if (config.min !== undefined) {
    props.push(`min: ${config.min}`);
  }
  if (config.max !== undefined) {
    props.push(`max: ${config.max}`);
  }
  if (config.minItems !== undefined) {
    props.push(`minItems: ${config.minItems}`);
  }
  if (config.maxItems !== undefined) {
    props.push(`maxItems: ${config.maxItems}`);
  }
  if (config.acceptedContentTypes) {
    props.push(`acceptedContentTypes: ${JSON.stringify(config.acceptedContentTypes)}`);
  }

  // Show any remaining scalar config values we haven't listed
  for (const [key, value] of Object.entries(config)) {
    if (
      value !== null &&
      value !== undefined &&
      typeof value !== 'object' &&
      !['repeatable', 'min', 'max', 'minItems', 'maxItems', 'acceptedContentTypes'].includes(key)
    ) {
      props.push(`${key}: ${value}`);
    }
  }

  if (props.length) {
    lines.push(`${indent}Config: ${props.join(', ')}`);
  }

  // Show nested components (e.g. contentChunk's inner components)
  const nested = config.components ?? config.choices;
  if (Array.isArray(nested) && nested.length) {
    const label = config.components ? 'Nested components' : 'Choices';
    lines.push(`${indent}${label}:`);
    for (const sub of nested) {
      lines.push(`${indent}  ${sub.id ?? sub.name ?? '?'} — ${sub.name ?? ''} [${sub.type ?? '?'}]`);
      if (sub.description) {
        lines.push(`${indent}    ${sub.description}`);
      }
    }
  }
}

// --- Tool definitions ---

/* eslint-disable @typescript-eslint/no-explicit-any */

export function shapeTools(client: CrystallizeClient): ToolDefinition[] {
  const pimCall = (q: string, v?: Record<string, unknown>) =>
    client.api.pimApi(q, v ?? {});

  return [
    {
      name: 'list_shapes',
      description:
        'List all shapes defined in the tenant. Returns shape names, identifiers, types, and component counts with deep links to the Crystallize UI.',
      schema: {},
      handler: async () => {
        const schema = await introspectPim(client);

        const data = (await execNestedWithRetry(
          pimCall, schema, 'shape', 'getMany',
          { tenantId: client.config.tenantId }, 1,
        )) as any;

        const shapes = data.shape?.getMany as any[] | undefined;

        if (!shapes?.length) {
          return {
            content: [
              { type: 'text', text: 'No shapes found in this tenant.' },
            ],
          };
        }

        const lines: string[] = [
          `${shapes.length} shape(s) in tenant "${client.config.tenantIdentifier}":\n`,
        ];

        for (const shape of shapes) {
          lines.push(`${shape.name} (${shape.identifier}) [${shape.type}]`);
          const components = shape.components as any[] | undefined;
          lines.push(`  Components: ${components?.length ?? 0}`);
          if (components?.length) {
            const componentList = components
              .map((c: any) => `${c.id} (${c.type})`)
              .join(', ');
            lines.push(`  ${componentList}`);
          }
          lines.push(`  Edit: ${client.shapeLink(shape.identifier)}`);
          lines.push('');
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      },
    },

    {
      name: 'get_shape',
      description:
        'Get the full component definition for a shape. Shows all components with their types, descriptions, and configuration. Useful for understanding what data a shape expects.',
      schema: {
        identifier: z
          .string()
          .describe('Shape identifier, e.g. "product" or "blog-post"'),
      },
      handler: async params => {
        const { identifier } = params;
        const schema = await introspectPim(client);

        const data = (await execNestedWithRetry(
          pimCall, schema, 'shape', 'get',
          { identifier, tenantId: client.config.tenantId }, 2,
        )) as any;

        const shape = data.shape?.get;

        if (!shape) {
          return {
            content: [
              {
                type: 'text',
                text: `Shape "${identifier}" not found. Use list_shapes to see available shapes.`,
              },
            ],
            isError: true,
          };
        }

        const lines: string[] = [
          `${shape.name} (${shape.identifier}) [${shape.type}]`,
          `Edit: ${client.shapeLink(shape.identifier)}`,
          '',
        ];

        const components = shape.components as any[] | undefined;
        if (components?.length) {
          lines.push(`Item Components (${components.length}):`);
          for (const comp of components) {
            lines.push(`  ${comp.id} — ${comp.name} [${comp.type}]`);
            if (comp.description) {
              lines.push(`    ${comp.description}`);
            }
            formatComponentConfig(comp, lines, '    ');
          }
          lines.push('');
        }

        const variantComponents = shape.variantComponents as any[] | undefined;
        if (variantComponents?.length) {
          lines.push(`Variant Components (${variantComponents.length}):`);
          for (const comp of variantComponents) {
            lines.push(`  ${comp.id} — ${comp.name} [${comp.type}]`);
            if (comp.description) {
              lines.push(`    ${comp.description}`);
            }
            formatComponentConfig(comp, lines, '    ');
          }
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      },
    },

    {
      name: 'get_tenant_info',
      description:
        'Get tenant configuration including name, identifier, available languages, and default language.',
      schema: {},
      handler: async () => {
        const schema = await introspectPim(client);

        const data = (await execNestedWithRetry(
          pimCall, schema, 'tenant', 'get',
          { identifier: client.config.tenantIdentifier }, 1,
        )) as any;

        const tenant = data.tenant?.get;

        const lines: string[] = [
          `${tenant.name}`,
          `  Identifier: ${tenant.identifier}`,
          `  ID: ${tenant.id}`,
          `  Default language: ${tenant.defaults?.language ?? 'en'}`,
          `  Default currency: ${tenant.defaults?.currency ?? 'n/a'}`,
          `  UI: https://app.crystallize.com/${tenant.identifier}`,
        ];

        if (tenant.availableLanguages?.length) {
          const langs = tenant.availableLanguages
            .map((l: any) => `${l.name} (${l.code})`)
            .join(', ');
          lines.push(`  Languages: ${langs}`);
        }

        if (client.config.frontendUrl) {
          lines.push(`  Frontend: ${client.config.frontendUrl}`);
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      },
    },
  ];
}
