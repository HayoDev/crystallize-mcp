/**
 * Schema introspection tools — fetch and compact GraphQL schemas
 * for the Catalogue, Discovery, Core, and Shop Cart APIs.
 *
 * Helps AI agents understand the tenant's GraphQL schema before
 * writing or debugging queries.
 */

import { z } from 'zod';
import type { CrystallizeClient } from '../client.js';
import type { ToolDefinition, ToolResult } from '../types.js';

/**
 * Standard GraphQL introspection query — fetches types, fields,
 * enums, inputs, and their relationships.
 */
const INTROSPECTION_QUERY = `
  query IntrospectionQuery {
    __schema {
      queryType { name }
      mutationType { name }
      types {
        kind
        name
        description
        fields(includeDeprecated: false) {
          name
          description
          type {
            ...TypeRef
          }
          args {
            name
            type { ...TypeRef }
            defaultValue
          }
        }
        inputFields {
          name
          type { ...TypeRef }
          defaultValue
        }
        enumValues(includeDeprecated: false) {
          name
        }
        possibleTypes {
          name
        }
      }
    }
  }

  fragment TypeRef on __Type {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
          }
        }
      }
    }
  }
`;

/** Built-in GraphQL types to exclude from output. */
const BUILTIN_TYPES = new Set([
  'String',
  'Int',
  'Float',
  'Boolean',
  'ID',
  '__Schema',
  '__Type',
  '__Field',
  '__InputValue',
  '__EnumValue',
  '__Directive',
  '__DirectiveLocation',
  '__TypeKind',
]);

interface IntrospectionType {
  kind: string;
  name: string;
  description?: string;
  fields?: IntrospectionField[];
  inputFields?: IntrospectionInputField[];
  enumValues?: { name: string }[];
  possibleTypes?: { name: string }[];
}

interface TypeRef {
  kind: string;
  name?: string;
  ofType?: TypeRef;
}

interface IntrospectionField {
  name: string;
  description?: string;
  type: TypeRef;
  args?: IntrospectionInputField[];
}

interface IntrospectionInputField {
  name: string;
  type: TypeRef;
  defaultValue?: string;
}

interface IntrospectionResult {
  __schema: {
    queryType?: { name: string };
    mutationType?: { name: string };
    types: IntrospectionType[];
  };
}

/** Render a type reference as a compact string (e.g. "[String!]!"). */
function renderTypeRef(ref: TypeRef): string {
  if (ref.kind === 'NON_NULL') {
    return `${renderTypeRef(ref.ofType ?? { kind: 'SCALAR', name: '?' })}!`;
  }
  if (ref.kind === 'LIST') {
    return `[${renderTypeRef(ref.ofType ?? { kind: 'SCALAR', name: '?' })}]`;
  }
  return ref.name ?? '?';
}

/** Compact an introspection result into readable SDL-like text. */
function compactSchema(
  data: IntrospectionResult,
  options?: { domain?: string },
): string {
  const schema = data.__schema;
  const lines: string[] = [];

  if (schema.queryType) {
    lines.push(`# Query type: ${schema.queryType.name}`);
  }
  if (schema.mutationType) {
    lines.push(`# Mutation type: ${schema.mutationType.name}`);
  }
  lines.push('');

  const types = schema.types
    .filter(t => !BUILTIN_TYPES.has(t.name))
    .filter(t => !t.name.startsWith('__'))
    .sort((a, b) => a.name.localeCompare(b.name));

  // If domain filter, only include types related to that domain
  const filtered = options?.domain
    ? types.filter(
        t =>
          t.name.toLowerCase().includes(options.domain ?? '') ||
          isRootType(t.name, schema),
      )
    : types;

  for (const type of filtered) {
    switch (type.kind) {
      case 'OBJECT':
      case 'INPUT_OBJECT':
        lines.push(renderObjectType(type));
        break;
      case 'ENUM':
        lines.push(renderEnumType(type));
        break;
      case 'UNION':
        lines.push(renderUnionType(type));
        break;
      case 'INTERFACE':
        lines.push(renderInterfaceType(type));
        break;
      case 'SCALAR':
        if (type.name !== 'String' && type.name !== 'Boolean') {
          lines.push(`scalar ${type.name}`);
        }
        break;
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

function isRootType(
  name: string,
  schema: IntrospectionResult['__schema'],
): boolean {
  return name === schema.queryType?.name || name === schema.mutationType?.name;
}

function renderObjectType(type: IntrospectionType): string {
  const keyword = type.kind === 'INPUT_OBJECT' ? 'input' : 'type';
  const fields = type.kind === 'INPUT_OBJECT' ? type.inputFields : type.fields;

  if (!fields?.length) {
    return `${keyword} ${type.name} {}`;
  }

  const fieldLines = fields.map(f => {
    if ('args' in f && f.args?.length) {
      const args = f.args
        .map(a => `${a.name}: ${renderTypeRef(a.type)}`)
        .join(', ');
      return `  ${f.name}(${args}): ${renderTypeRef(f.type)}`;
    }
    return `  ${f.name}: ${renderTypeRef(f.type)}`;
  });

  return `${keyword} ${type.name} {\n${fieldLines.join('\n')}\n}`;
}

function renderEnumType(type: IntrospectionType): string {
  const values = (type.enumValues ?? []).map(v => `  ${v.name}`);
  return `enum ${type.name} {\n${values.join('\n')}\n}`;
}

function renderUnionType(type: IntrospectionType): string {
  const members = (type.possibleTypes ?? []).map(t => t.name);
  return `union ${type.name} = ${members.join(' | ')}`;
}

function renderInterfaceType(type: IntrospectionType): string {
  if (!type.fields?.length) {
    return `interface ${type.name} {}`;
  }

  const fieldLines = type.fields.map(
    f => `  ${f.name}: ${renderTypeRef(f.type)}`,
  );
  return `interface ${type.name} {\n${fieldLines.join('\n')}\n}`;
}

/** Max output chars before auto-switching to summary mode. */
const MAX_FULL_SCHEMA_LENGTH = 50_000;

/** Generate a summary: root fields + type name list. */
function summariseSchema(data: IntrospectionResult): string {
  const schema = data.__schema;
  const lines: string[] = [];

  const types = schema.types
    .filter(t => !BUILTIN_TYPES.has(t.name))
    .filter(t => !t.name.startsWith('__'));

  // Root query fields
  const queryType = types.find(t => t.name === schema.queryType?.name);
  if (queryType?.fields?.length) {
    lines.push('# Root Query Fields', '');
    for (const f of queryType.fields) {
      lines.push(`  ${f.name}: ${renderTypeRef(f.type)}`);
    }
    lines.push('');
  }

  // Root mutation fields
  const mutationType = types.find(t => t.name === schema.mutationType?.name);
  if (mutationType?.fields?.length) {
    lines.push('# Root Mutation Fields', '');
    for (const f of mutationType.fields) {
      lines.push(`  ${f.name}: ${renderTypeRef(f.type)}`);
    }
    lines.push('');
  }

  // Group type names by kind
  const grouped: Record<string, string[]> = {};
  for (const t of types) {
    if (t.name === queryType?.name || t.name === mutationType?.name) {
      continue;
    }
    const group = grouped[t.kind] ?? [];
    group.push(t.name);
    grouped[t.kind] = group;
  }

  for (const [kind, names] of Object.entries(grouped)) {
    lines.push(`# ${kind} (${names.length})`, names.sort().join(', '), '');
  }

  return lines.join('\n').trim();
}

/** Run an introspection query via the given API caller. */
async function introspect(
  apiCaller: (
    query: string,
    variables?: Record<string, unknown>,
  ) => Promise<unknown>,
  options?: { domain?: string; summary?: boolean },
): Promise<ToolResult> {
  try {
    const data = (await apiCaller(INTROSPECTION_QUERY)) as IntrospectionResult;

    if (!data.__schema) {
      return {
        content: [
          {
            type: 'text',
            text: 'Introspection query returned no schema. The API may not support introspection or authentication may be missing.',
          },
        ],
        isError: true,
      };
    }

    const typeCount = data.__schema.types.filter(
      t => !BUILTIN_TYPES.has(t.name) && !t.name.startsWith('__'),
    ).length;

    const useSummary = options?.summary === true;
    const compacted = useSummary
      ? summariseSchema(data)
      : compactSchema(data, options);

    // Auto-switch to summary if full schema is too large
    if (!useSummary && compacted.length > MAX_FULL_SCHEMA_LENGTH) {
      const summary = summariseSchema(data);
      return {
        content: [
          {
            type: 'text',
            text: [
              `# GraphQL Schema Summary (${typeCount} types — full schema too large at ${Math.round(compacted.length / 1000)}k chars)`,
              '',
              'Use the `domain` parameter or `summary: true` to get a focused view.',
              '',
              summary,
            ].join('\n'),
          },
        ],
      };
    }

    const label = useSummary ? 'Summary' : 'Schema';
    return {
      content: [
        {
          type: 'text',
          text: [`# GraphQL ${label} (${typeCount} types)`, '', compacted].join(
            '\n',
          ),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Failed to fetch schema: ${message}`,
        },
      ],
      isError: true,
    };
  }
}

export function schemaTools(client: CrystallizeClient): ToolDefinition[] {
  return [
    {
      name: 'fetch_catalogue_schema',
      description:
        'Fetch the GraphQL schema of the Crystallize Catalogue API. ' +
        'The Catalogue API is a storefront API for fetching items, products, and content — ' +
        'it provides path-based reads with strong consistency and union types for components. ' +
        'Use this to understand available queries, types, and fields before writing catalogue queries.',
      schema: {},
      handler: async () => {
        return introspect(q => client.api.catalogueApi(q));
      },
    },

    {
      name: 'fetch_discovery_schema',
      description:
        'Fetch the GraphQL schema of the Crystallize Discovery API. ' +
        'The Discovery API is a storefront API for searching, browsing, filtering, and faceting items. ' +
        'It uses a shape-typed schema where each shape in the tenant becomes a GraphQL type. ' +
        'Use this to understand the tenant-specific types and available browse/search queries. ' +
        'Set summary to true for large tenants to get a compact overview.',
      schema: {
        summary: z
          .boolean()
          .optional()
          .describe(
            'Return only root fields and type names instead of the full schema. Recommended for large tenants.',
          ),
      },
      handler: async params => {
        const summary =
          typeof params.summary === 'boolean' ? params.summary : undefined;
        return introspect(q => client.api.discoveryApi(q), {
          summary,
        });
      },
    },

    {
      name: 'fetch_core_schema',
      description:
        'Fetch the GraphQL schema of the Crystallize Core API (admin API). ' +
        'The Core API is large, so provide a domain to filter the schema (e.g. "order", "customer", "item"). ' +
        'Common domains: order, customer, subscription, subscriptionPlan, pricelist, pipeline, flow, app, user, webhook, stockLocation. ' +
        'Omit domain to get a summary of available types. Set summary to true for a compact overview.',
      schema: {
        domain: z
          .string()
          .optional()
          .describe(
            'Filter schema to a specific domain (e.g. "order", "customer", "item"). ' +
              'Omit to get the full schema.',
          ),
        summary: z
          .boolean()
          .optional()
          .describe(
            'Return only root fields and type names instead of the full schema.',
          ),
      },
      handler: async params => {
        const domain =
          typeof params.domain === 'string'
            ? params.domain.toLowerCase()
            : undefined;
        const summary =
          typeof params.summary === 'boolean' ? params.summary : undefined;
        return introspect(q => client.api.nextPimApi(q), {
          domain,
          summary,
        });
      },
    },

    {
      name: 'fetch_shop_cart_schema',
      description:
        'Fetch the GraphQL schema of the Crystallize Shop Cart API. ' +
        'The Shop Cart API handles cart and wishlist operations — creating carts, ' +
        'adding/removing items, applying discounts, and reading cart state. ' +
        'Use this to understand available cart queries and types.',
      schema: {},
      handler: async () => {
        return introspect(q => client.api.shopCartApi(q));
      },
    },
  ];
}
