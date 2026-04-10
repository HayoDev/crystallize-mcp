/**
 * Shared GraphQL introspection engine.
 *
 * Provides schema introspection, dynamic query building, union-safe inline
 * fragments, and automatic retry for null non-nullable field errors.
 * Used by shapes.ts, catalogue.ts, and any tool that needs dynamic queries.
 */

// --- Types ---

export interface TypeRef {
  kind: string;
  name?: string | null;
  ofType?: TypeRef | null;
}

export interface IntroField {
  name: string;
  type: TypeRef;
  args?: { name: string; type: TypeRef }[];
}

export interface IntroType {
  kind: string;
  name: string;
  fields?: IntroField[];
  possibleTypes?: { name: string }[];
}

export interface ApiSchema {
  types: Map<string, IntroType>;
  queryTypeName: string;
}

/** A function that executes a GraphQL query and returns raw data. */
export type ApiCaller = (
  query: string,
  variables?: Record<string, unknown>,
) => Promise<unknown>;

// --- Cache ---

const caches = new Map<string, { schema: ApiSchema; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

// --- Type resolution helpers ---

/** Unwrap NON_NULL/LIST wrappers to get the named type. */
export function resolveTypeName(ref: TypeRef): string {
  if (ref.name) {
    return ref.name;
  }
  if (ref.ofType) {
    return resolveTypeName(ref.ofType);
  }
  return ref.kind;
}

/** Check if the base type is a scalar or enum. */
export function isScalar(ref: TypeRef): boolean {
  const k = baseKind(ref);
  return k === 'SCALAR' || k === 'ENUM';
}

function baseKind(ref: TypeRef): string {
  if ((ref.kind === 'NON_NULL' || ref.kind === 'LIST') && ref.ofType) {
    return baseKind(ref.ofType);
  }
  return ref.kind;
}

/** Render a type reference as a compact string (e.g. "[String!]!"). */
export function renderTypeRef(ref: TypeRef): string {
  if (ref.kind === 'NON_NULL') {
    return `${renderTypeRef(ref.ofType!)}!`;
  }
  if (ref.kind === 'LIST') {
    return `[${renderTypeRef(ref.ofType!)}]`;
  }
  return ref.name ?? '?';
}

// --- Multi-step introspection ---

const SCHEMA_QUERY = `{
  __schema {
    queryType { name }
    types {
      kind name
      fields(includeDeprecated: false) {
        name
        type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
        args { name type { kind name ofType { kind name ofType { kind name } } } }
      }
      possibleTypes { name }
    }
  }
}`;

const TYPE_FIELDS_QUERY = (names: string[]) =>
  `{ ${names.map((n, i) => `t${i}: __type(name: "${n}") { kind name fields(includeDeprecated: false) { name type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } args { name type { kind name ofType { kind name ofType { kind name } } } } } possibleTypes { name } }`).join('\n')} }`;

/**
 * Introspect any GraphQL API. Uses a two-step approach:
 * 1. Broad __schema query to discover the type graph.
 * 2. Targeted __type queries to fill in shallow types.
 *
 * @param cacheKey  Unique key for caching (e.g. "pim", "catalogue").
 * @param apiCall   Function to execute a query against the target API.
 * @param seedPaths Root field paths to walk for finding shallow types
 *                  (e.g. [["shape","get"], ["catalogue"]]).
 */
export async function introspectApi(
  cacheKey: string,
  apiCall: ApiCaller,
  seedPaths: string[][],
): Promise<ApiSchema> {
  const cached = caches.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.schema;
  }

  // Step 1: Full schema overview
  const data = (await apiCall(SCHEMA_QUERY, {})) as {
    __schema: { queryType: { name: string }; types: IntroType[] };
  };

  const types = new Map<string, IntroType>();
  for (const t of data.__schema.types) {
    if (t.name && !t.name.startsWith('__')) {
      types.set(t.name, t);
    }
  }

  // Step 2: Find shallow types along the seed paths
  const typesToDeepen = new Set<string>();
  for (const path of seedPaths) {
    collectShallowTypesAlongPath(types, data.__schema.queryType.name, path, typesToDeepen, 3);
  }

  // Step 2b: Batch-fetch detailed fields for shallow types
  if (typesToDeepen.size > 0) {
    const names = [...typesToDeepen];
    const deepData = (await apiCall(TYPE_FIELDS_QUERY(names), {})) as Record<
      string,
      IntroType | null
    >;

    for (let i = 0; i < names.length; i++) {
      const t = deepData[`t${i}`];
      if (t) {
        types.set(names[i], t);
      }
    }

    // After deepening, check if the newly fetched types reference further
    // shallow types (one more round). This handles cases like
    // catalogue → Item → components → [ComponentContent union members].
    const moreToDeepen = new Set<string>();
    for (const name of names) {
      const t = types.get(name);
      if (!t) {
        continue;
      }
      collectShallowFieldTypes(types, t, moreToDeepen, 2);
    }

    // Remove already-fetched types
    for (const name of names) {
      moreToDeepen.delete(name);
    }

    if (moreToDeepen.size > 0) {
      const moreNames = [...moreToDeepen];
      const moreData = (await apiCall(
        TYPE_FIELDS_QUERY(moreNames),
        {},
      )) as Record<string, IntroType | null>;

      for (let i = 0; i < moreNames.length; i++) {
        const t = moreData[`t${i}`];
        if (t) {
          types.set(moreNames[i], t);
        }
      }
    }
  }

  const schema: ApiSchema = {
    types,
    queryTypeName: data.__schema.queryType.name,
  };
  caches.set(cacheKey, { schema, timestamp: Date.now() });
  return schema;
}

/**
 * Walk an arbitrary-length field path from the query root and collect
 * shallow types at each level along the way.
 */
function collectShallowTypesAlongPath(
  types: Map<string, IntroType>,
  queryTypeName: string,
  path: string[],
  result: Set<string>,
  depth: number,
): void {
  let currentType = types.get(queryTypeName);
  if (!currentType) {
    return;
  }

  // Walk the path to find the return type
  for (const fieldName of path) {
    const field = currentType?.fields?.find(f => f.name === fieldName);
    if (!field) {
      return;
    }
    const returnTypeName = resolveTypeName(field.type);
    currentType = types.get(returnTypeName);
    if (!currentType) {
      // The type itself is shallow
      if (returnTypeName && !returnTypeName.startsWith('__')) {
        result.add(returnTypeName);
      }
      return;
    }
  }

  // Now collect shallow types within the reached type
  if (currentType) {
    collectShallowFieldTypes(types, currentType, result, depth);
  }
}

/**
 * From a given type, collect shallow types referenced by its fields.
 */
function collectShallowFieldTypes(
  types: Map<string, IntroType>,
  type: IntroType,
  result: Set<string>,
  depth: number,
): void {
  if (depth <= 0 || !type.fields) {
    return;
  }

  for (const field of type.fields) {
    if (isScalar(field.type)) {
      continue;
    }
    const typeName = resolveTypeName(field.type);
    const existing = types.get(typeName);

    if (!existing || !existing.fields?.length) {
      if (typeName && !typeName.startsWith('__')) {
        result.add(typeName);
      }
      // Also collect union members
      if (existing?.kind === 'UNION' && existing.possibleTypes?.length) {
        for (const member of existing.possibleTypes) {
          const memberType = types.get(member.name);
          if (!memberType || !memberType.fields?.length) {
            result.add(member.name);
          }
        }
      }
    } else if (existing.kind === 'UNION' && existing.possibleTypes?.length) {
      for (const member of existing.possibleTypes) {
        const memberType = types.get(member.name);
        if (!memberType || !memberType.fields?.length) {
          result.add(member.name);
        }
      }
    } else if (existing.kind === 'OBJECT' || existing.kind === 'INTERFACE') {
      // Recurse one level to find deeper shallow refs
      collectShallowFieldTypes(types, existing, result, depth - 1);
    }
  }
}

// --- Dynamic query building ---

/** Resolve a root-level field's return type. */
export function getRootFieldReturnType(
  schema: ApiSchema,
  fieldName: string,
): IntroType | undefined {
  const q = schema.types.get(schema.queryTypeName);
  const f = q?.fields?.find(f => f.name === fieldName);
  if (!f) {
    return undefined;
  }
  return schema.types.get(resolveTypeName(f.type));
}

/** Get args for a root-level field. */
export function getRootFieldArgs(
  schema: ApiSchema,
  fieldName: string,
): { name: string; gqlType: string }[] {
  const q = schema.types.get(schema.queryTypeName);
  const f = q?.fields?.find(f => f.name === fieldName);
  return (f?.args ?? []).map(a => ({
    name: a.name,
    gqlType: renderTypeRef(a.type),
  }));
}

/** Walk root → field → subField to resolve the return type. */
export function getNestedReturnType(
  schema: ApiSchema,
  rootField: string,
  subField: string,
): IntroType | undefined {
  const q = schema.types.get(schema.queryTypeName);
  const f1 = q?.fields?.find(f => f.name === rootField);
  if (!f1) {
    return undefined;
  }

  const mid = schema.types.get(resolveTypeName(f1.type));
  const f2 = mid?.fields?.find(f => f.name === subField);
  if (!f2) {
    return undefined;
  }

  return schema.types.get(resolveTypeName(f2.type));
}

/** Get declared args for a nested field (rootField.subField). */
export function getNestedFieldArgs(
  schema: ApiSchema,
  rootField: string,
  subField: string,
): { name: string; gqlType: string }[] {
  const q = schema.types.get(schema.queryTypeName);
  const f1 = q?.fields?.find(f => f.name === rootField);
  if (!f1) {
    return [];
  }

  const mid = schema.types.get(resolveTypeName(f1.type));
  const f2 = mid?.fields?.find(f => f.name === subField);
  return (f2?.args ?? []).map(a => ({
    name: a.name,
    gqlType: renderTypeRef(a.type),
  }));
}

/** Check if a field has any required (NON_NULL) arguments. */
export function hasRequiredArgs(field: IntroField): boolean {
  return (field.args ?? []).some(a => a.type.kind === 'NON_NULL');
}

/**
 * Build a GraphQL selection set from introspected type fields.
 * Includes all scalar/enum fields, plus nested OBJECT sub-fields recursively.
 * For UNION/INTERFACE types, generates inline fragments.
 * Skips fields with required arguments and any names in `skipFields`.
 */
export function buildSelection(
  schema: ApiSchema,
  type: IntroType,
  depth = 2,
  visited = new Set<string>(),
  skipFields = new Set<string>(),
): string {
  const parts: string[] = [];

  if (visited.has(type.name)) {
    return '';
  }
  visited.add(type.name);

  for (const field of type.fields ?? []) {
    if (hasRequiredArgs(field) || skipFields.has(field.name)) {
      continue;
    }
    if (isScalar(field.type)) {
      parts.push(field.name);
    } else if (depth > 0) {
      const typeName = resolveTypeName(field.type);
      const nested = schema.types.get(typeName);

      if (nested?.kind === 'OBJECT' && nested.fields?.length) {
        const sub = buildSelection(schema, nested, depth - 1, new Set(visited), skipFields);
        if (sub) {
          parts.push(`${field.name} { ${sub} }`);
        }
      } else if (
        (nested?.kind === 'UNION' || nested?.kind === 'INTERFACE') &&
        nested.possibleTypes?.length
      ) {
        const fragments = buildUnionFragments(schema, nested, depth - 1, new Set(visited));
        if (fragments) {
          parts.push(`${field.name} { ${fragments} }`);
        }
      }
    }
  }

  return parts.join(' ');
}

/**
 * Build inline fragments for a UNION or INTERFACE type.
 * Pre-scans members to detect fields with conflicting return types
 * across members and excludes them to avoid field-merging errors.
 */
export function buildUnionFragments(
  schema: ApiSchema,
  unionType: IntroType,
  depth: number,
  visited: Set<string>,
): string {
  const members = (unionType.possibleTypes ?? [])
    .map(m => schema.types.get(m.name))
    .filter((t): t is IntroType => !!t?.fields?.length);

  // Detect conflicting field names across members
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
    // Each member starts with a fresh visited set. The ancestor visited set
    // would incorrectly block self-referential types (e.g. Component → content
    // → ContentChunkContent → chunks → Component). The finite depth parameter
    // is sufficient to prevent infinite recursion.
    const sub = buildSelectionExcluding(schema, member, depth, new Set(), conflicting);
    if (sub) {
      fragments.push(`... on ${member.name} { ${sub} }`);
    }
  }

  return fragments.join(' ');
}

/**
 * Like buildSelection but also skips fields in `exclude`.
 * Used inside inline fragments to avoid field-merging conflicts.
 */
function buildSelectionExcluding(
  schema: ApiSchema,
  type: IntroType,
  depth: number,
  visited: Set<string>,
  exclude: Set<string>,
): string {
  const parts: string[] = [];

  if (visited.has(type.name)) {
    return '';
  }
  visited.add(type.name);

  for (const field of type.fields ?? []) {
    if (hasRequiredArgs(field) || exclude.has(field.name)) {
      continue;
    }
    if (isScalar(field.type)) {
      parts.push(field.name);
    } else if (depth > 0) {
      const typeName = resolveTypeName(field.type);
      const nested = schema.types.get(typeName);

      if (nested?.kind === 'OBJECT' && nested.fields?.length) {
        const sub = buildSelection(schema, nested, depth - 1, new Set(visited));
        if (sub) {
          parts.push(`${field.name} { ${sub} }`);
        }
      } else if (
        (nested?.kind === 'UNION' || nested?.kind === 'INTERFACE') &&
        nested.possibleTypes?.length
      ) {
        const fragments = buildUnionFragments(schema, nested, depth - 1, new Set(visited));
        if (fragments) {
          parts.push(`${field.name} { ${fragments} }`);
        }
      }
    }
  }

  return parts.join(' ');
}

// --- Query builders ---

/**
 * Build a query for a nested field path like shape.get or shape.getMany.
 */
export function buildNestedQuery(
  schema: ApiSchema,
  rootField: string,
  subField: string,
  depth = 2,
  skipFields = new Set<string>(),
): string {
  const returnType = getNestedReturnType(schema, rootField, subField);
  if (!returnType) {
    throw new Error(`Cannot introspect ${rootField}.${subField}`);
  }

  const selection = buildSelection(schema, returnType, depth, new Set(), skipFields);
  const args = getNestedFieldArgs(schema, rootField, subField);

  const varDecls = args.map(a => `$${a.name}: ${a.gqlType}`).join(', ');
  const argPass = args.map(a => `${a.name}: $${a.name}`).join(', ');

  const varPart = args.length ? `(${varDecls})` : '';
  const argPart = args.length ? `(${argPass})` : '';

  return `query${varPart} { ${rootField} { ${subField}${argPart} { ${selection} } } }`;
}

/**
 * Build a query for a root-level field like catalogue(path, language).
 * Supports optional extra selection (inline fragments for interface sub-types).
 */
export function buildRootQuery(
  schema: ApiSchema,
  rootField: string,
  depth = 2,
  skipFields = new Set<string>(),
  extraSelection = '',
): string {
  const returnType = getRootFieldReturnType(schema, rootField);
  if (!returnType) {
    throw new Error(`Cannot introspect root field "${rootField}"`);
  }

  let selection = buildSelection(schema, returnType, depth, new Set(), skipFields);

  // For INTERFACE return types, add inline fragments for each implementor
  if (returnType.kind === 'INTERFACE' && returnType.possibleTypes?.length) {
    const fragments = buildUnionFragments(schema, returnType, depth, new Set());
    if (fragments) {
      selection += ' ' + fragments;
    }
  }

  if (extraSelection) {
    selection += ' ' + extraSelection;
  }

  const args = getRootFieldArgs(schema, rootField);
  const varDecls = args.map(a => `$${a.name}: ${a.gqlType}`).join(', ');
  const argPass = args.map(a => `${a.name}: $${a.name}`).join(', ');

  const varPart = args.length ? `(${varDecls})` : '';
  const argPart = args.length ? `(${argPass})` : '';

  return `query${varPart} { ${rootField}${argPart} { ${selection} } }`;
}

// --- Retry logic ---

const NULL_FIELD_RE = /Cannot return null for non-nullable field \w+\.(\w+)/g;
const FIELD_CONFLICT_RE = /Fields "(\w+)" conflict/g;

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Execute a dynamically built nested query with automatic retry.
 * On null-field or field-conflict errors, excludes the failing fields
 * and retries (up to 3 times).
 */
export async function execNestedWithRetry(
  apiCall: ApiCaller,
  schema: ApiSchema,
  rootField: string,
  subField: string,
  variables: Record<string, unknown>,
  depth = 2,
): Promise<any> {
  const skipFields = new Set<string>();
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const query = buildNestedQuery(schema, rootField, subField, depth, skipFields);
    try {
      return await apiCall(query, variables);
    } catch (err: any) {
      const added = extractErrorFields(err, skipFields);
      if (!added || attempt === maxRetries) {
        throw err;
      }
    }
  }
}

/**
 * Execute a dynamically built root-level query with automatic retry.
 */
export async function execRootWithRetry(
  apiCall: ApiCaller,
  schema: ApiSchema,
  rootField: string,
  variables: Record<string, unknown>,
  depth = 2,
  extraSelection = '',
): Promise<any> {
  const skipFields = new Set<string>();
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const query = buildRootQuery(schema, rootField, depth, skipFields, extraSelection);
    try {
      return await apiCall(query, variables);
    } catch (err: any) {
      const added = extractErrorFields(err, skipFields);
      if (!added || attempt === maxRetries) {
        throw err;
      }
    }
  }
}

/** Parse error messages for field names to skip. Returns true if new fields were added. */
function extractErrorFields(err: any, skipFields: Set<string>): boolean {
  const msg = err?.message ?? String(err);
  let added = false;
  let match: RegExpExecArray | null;

  NULL_FIELD_RE.lastIndex = 0;
  while ((match = NULL_FIELD_RE.exec(msg)) !== null) {
    if (!skipFields.has(match[1])) {
      skipFields.add(match[1]);
      added = true;
    }
  }

  FIELD_CONFLICT_RE.lastIndex = 0;
  while ((match = FIELD_CONFLICT_RE.exec(msg)) !== null) {
    if (!skipFields.has(match[1])) {
      skipFields.add(match[1]);
      added = true;
    }
  }

  return added;
}
