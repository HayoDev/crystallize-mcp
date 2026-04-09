import { describe, it } from 'node:test';
import assert from 'node:assert';
import { schemaTools } from '../src/tools/schema.js';
import { CrystallizeClient } from '../src/client.js';

// --- Tool metadata ---

describe('schemaTools metadata', () => {
  const client = new CrystallizeClient({
    tenantIdentifier: 'test-tenant',
    accessMode: 'read',
  });
  const tools = schemaTools(client);

  it('exports 4 schema introspection tools', () => {
    assert.strictEqual(tools.length, 4);
    const names = tools.map(t => t.name);
    assert.ok(names.includes('fetch_catalogue_schema'));
    assert.ok(names.includes('fetch_discovery_schema'));
    assert.ok(names.includes('fetch_core_schema'));
    assert.ok(names.includes('fetch_shop_cart_schema'));
  });

  it('all tools default to read mode', () => {
    for (const tool of tools) {
      assert.strictEqual(tool.mode ?? 'read', 'read');
    }
  });

  it('fetch_core_schema has optional domain param', () => {
    const coreTool = tools.find(t => t.name === 'fetch_core_schema');
    if (!coreTool) {
      throw new Error('fetch_core_schema not found');
    }
    assert.ok('domain' in coreTool.schema);
  });
});

// --- Schema compaction ---

describe('schema introspection with mock API', () => {
  const mockIntrospection = {
    __schema: {
      queryType: { name: 'Query' },
      mutationType: null,
      types: [
        {
          kind: 'OBJECT',
          name: 'Query',
          description: 'Root query',
          fields: [
            {
              name: 'catalogue',
              description: 'Get catalogue item',
              type: {
                kind: 'OBJECT',
                name: 'Item',
                ofType: null,
              },
              args: [
                {
                  name: 'path',
                  type: {
                    kind: 'NON_NULL',
                    name: null,
                    ofType: {
                      kind: 'SCALAR',
                      name: 'String',
                      ofType: null,
                    },
                  },
                  defaultValue: null,
                },
                {
                  name: 'language',
                  type: {
                    kind: 'SCALAR',
                    name: 'String',
                    ofType: null,
                  },
                  defaultValue: null,
                },
              ],
            },
          ],
          inputFields: null,
          enumValues: null,
          possibleTypes: null,
        },
        {
          kind: 'OBJECT',
          name: 'Item',
          description: 'A catalogue item',
          fields: [
            {
              name: 'id',
              description: null,
              type: {
                kind: 'NON_NULL',
                name: null,
                ofType: {
                  kind: 'SCALAR',
                  name: 'ID',
                  ofType: null,
                },
              },
              args: [],
            },
            {
              name: 'name',
              description: null,
              type: {
                kind: 'SCALAR',
                name: 'String',
                ofType: null,
              },
              args: [],
            },
          ],
          inputFields: null,
          enumValues: null,
          possibleTypes: null,
        },
        {
          kind: 'ENUM',
          name: 'ItemType',
          description: null,
          fields: null,
          inputFields: null,
          enumValues: [
            { name: 'PRODUCT' },
            { name: 'DOCUMENT' },
            { name: 'FOLDER' },
          ],
          possibleTypes: null,
        },
        {
          kind: 'SCALAR',
          name: 'String',
          description: 'Built-in',
          fields: null,
          inputFields: null,
          enumValues: null,
          possibleTypes: null,
        },
        {
          kind: 'SCALAR',
          name: 'ID',
          description: 'Built-in',
          fields: null,
          inputFields: null,
          enumValues: null,
          possibleTypes: null,
        },
      ],
    },
  };

  it('returns compacted schema from catalogue API', async () => {
    const client = new CrystallizeClient({
      tenantIdentifier: 'test-tenant',
      accessMode: 'read',
    });

    Object.defineProperty(client.api, 'catalogueApi', {
      value: async () => mockIntrospection,
      writable: true,
      configurable: true,
    });

    const tools = schemaTools(client);
    const fetchCatalogue = tools.find(t => t.name === 'fetch_catalogue_schema');
    if (!fetchCatalogue) {
      throw new Error('fetch_catalogue_schema not found');
    }

    const result = await fetchCatalogue.handler({});
    assert.strictEqual(result.isError, undefined);

    const text = result.content[0].text;
    assert.ok(text.includes('GraphQL Schema'));
    assert.ok(text.includes('type Query'));
    assert.ok(text.includes('catalogue'));
    assert.ok(text.includes('type Item'));
    assert.ok(text.includes('id: ID!'));
    assert.ok(text.includes('name: String'));
    assert.ok(text.includes('enum ItemType'));
    assert.ok(text.includes('PRODUCT'));
    // Built-in types should be excluded
    assert.ok(!text.includes('scalar String'));
    assert.ok(!text.includes('scalar ID'));
  });

  it('handles API errors gracefully', async () => {
    const client = new CrystallizeClient({
      tenantIdentifier: 'test-tenant',
      accessMode: 'read',
    });

    Object.defineProperty(client.api, 'catalogueApi', {
      value: async () => {
        throw new Error('401 Unauthorized');
      },
      writable: true,
      configurable: true,
    });

    const tools = schemaTools(client);
    const fetchCatalogue = tools.find(t => t.name === 'fetch_catalogue_schema');
    if (!fetchCatalogue) {
      throw new Error('fetch_catalogue_schema not found');
    }

    const result = await fetchCatalogue.handler({});
    assert.strictEqual(result.isError, true);
    assert.ok(result.content[0].text.includes('Failed to fetch'));
  });

  it('fetch_core_schema passes domain filter', async () => {
    const client = new CrystallizeClient({
      tenantIdentifier: 'test-tenant',
      accessMode: 'read',
    });

    const mockCoreSchema = {
      __schema: {
        queryType: { name: 'Query' },
        mutationType: null,
        types: [
          {
            kind: 'OBJECT',
            name: 'Query',
            fields: [
              {
                name: 'order',
                type: {
                  kind: 'OBJECT',
                  name: 'OrderQueries',
                  ofType: null,
                },
                args: [],
              },
            ],
            inputFields: null,
            enumValues: null,
            possibleTypes: null,
          },
          {
            kind: 'OBJECT',
            name: 'OrderQueries',
            fields: [
              {
                name: 'get',
                type: {
                  kind: 'OBJECT',
                  name: 'Order',
                  ofType: null,
                },
                args: [
                  {
                    name: 'id',
                    type: {
                      kind: 'NON_NULL',
                      name: null,
                      ofType: {
                        kind: 'SCALAR',
                        name: 'ID',
                        ofType: null,
                      },
                    },
                    defaultValue: null,
                  },
                ],
              },
            ],
            inputFields: null,
            enumValues: null,
            possibleTypes: null,
          },
          {
            kind: 'OBJECT',
            name: 'CustomerQueries',
            fields: [
              {
                name: 'get',
                type: {
                  kind: 'OBJECT',
                  name: 'Customer',
                  ofType: null,
                },
                args: [],
              },
            ],
            inputFields: null,
            enumValues: null,
            possibleTypes: null,
          },
        ],
      },
    };

    Object.defineProperty(client.api, 'nextPimApi', {
      value: async () => mockCoreSchema,
      writable: true,
      configurable: true,
    });

    const tools = schemaTools(client);
    const fetchCore = tools.find(t => t.name === 'fetch_core_schema');
    if (!fetchCore) {
      throw new Error('fetch_core_schema not found');
    }

    const result = await fetchCore.handler({ domain: 'order' });
    assert.strictEqual(result.isError, undefined);

    const text = result.content[0].text;
    assert.ok(text.includes('OrderQueries'));
    assert.ok(text.includes('Query'));
    // CustomerQueries should be filtered out
    assert.ok(!text.includes('CustomerQueries'));
  });
});
