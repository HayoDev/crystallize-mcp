import { describe, it } from 'node:test';
import assert from 'node:assert';
import { contentTools } from '../src/tools/content.js';
import { CrystallizeClient } from '../src/client.js';
import { AuditLogger } from '../src/audit.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// --- Tool metadata ---

describe('contentTools metadata', () => {
  const client = new CrystallizeClient({
    tenantIdentifier: 'test-tenant',
    accessMode: 'write',
    dryRun: true,
  });
  const tools = contentTools(client);

  it('exports create_item and update_component', () => {
    const names = tools.map(t => t.name);
    assert.ok(names.includes('create_item'));
    assert.ok(names.includes('update_component'));
    assert.strictEqual(tools.length, 2);
  });

  it('all tools require write mode', () => {
    for (const tool of tools) {
      assert.strictEqual(tool.mode, 'write');
    }
  });

  it('descriptions mention DRY_RUN', () => {
    for (const tool of tools) {
      assert.ok(
        tool.description.includes('DRY_RUN'),
        `${tool.name} description should mention DRY_RUN`,
      );
    }
  });
});

// --- create_item dry-run ---

describe('create_item dry-run', () => {
  it('returns preview when shape exists', async () => {
    const client = new CrystallizeClient({
      tenantIdentifier: 'test-tenant',
      tenantId: 'tenant-123',
      accessMode: 'write',
      dryRun: true,
    });

    Object.defineProperty(client.api, 'pimApi', {
      value: async () => ({
        shape: {
          get: {
            identifier: 'blog-post',
            name: 'Blog Post',
            type: 'document',
            components: [
              { id: 'title', name: 'Title', type: 'singleLine' },
              { id: 'body', name: 'Body', type: 'richText' },
            ],
          },
        },
      }),
      writable: true,
      configurable: true,
    });

    const tools = contentTools(client);
    const createItem = tools.find(t => t.name === 'create_item');
    if (!createItem) {
      throw new Error('create_item not found');
    }

    const result = await createItem.handler({
      name: 'My Blog Post',
      shapeIdentifier: 'blog-post',
      parentPath: '/blog',
      components: { title: 'Hello World' },
      language: 'en',
    });

    assert.strictEqual(result.isError, undefined);
    const text = result.content[0].text;
    assert.ok(text.includes('[DRY RUN]'));
    assert.ok(text.includes('blog-post'));
    assert.ok(text.includes('My Blog Post'));
    assert.ok(text.includes('document'));
  });

  it('returns error when shape not found', async () => {
    const client = new CrystallizeClient({
      tenantIdentifier: 'test-tenant',
      accessMode: 'write',
      dryRun: true,
    });

    Object.defineProperty(client.api, 'pimApi', {
      value: async () => ({ shape: { get: null } }),
      writable: true,
      configurable: true,
    });

    const tools = contentTools(client);
    const createItem = tools.find(t => t.name === 'create_item');
    if (!createItem) {
      throw new Error('create_item not found');
    }

    const result = await createItem.handler({
      name: 'Test',
      shapeIdentifier: 'nonexistent',
      parentPath: '/',
      language: 'en',
    });

    assert.strictEqual(result.isError, true);
    assert.ok(result.content[0].text.includes('not found'));
  });

  it('returns error for invalid component ID', async () => {
    const client = new CrystallizeClient({
      tenantIdentifier: 'test-tenant',
      accessMode: 'write',
      dryRun: true,
    });

    Object.defineProperty(client.api, 'pimApi', {
      value: async () => ({
        shape: {
          get: {
            identifier: 'blog-post',
            name: 'Blog Post',
            type: 'document',
            components: [{ id: 'title', name: 'Title', type: 'singleLine' }],
          },
        },
      }),
      writable: true,
      configurable: true,
    });

    const tools = contentTools(client);
    const createItem = tools.find(t => t.name === 'create_item');
    if (!createItem) {
      throw new Error('create_item not found');
    }

    const result = await createItem.handler({
      name: 'Test',
      shapeIdentifier: 'blog-post',
      parentPath: '/',
      components: { nonexistent: 'value' },
      language: 'en',
    });

    assert.strictEqual(result.isError, true);
    assert.ok(result.content[0].text.includes('nonexistent'));
    assert.ok(result.content[0].text.includes('title'));
  });
});

// --- update_component dry-run ---

describe('update_component dry-run', () => {
  it('returns before/after preview', async () => {
    const client = new CrystallizeClient({
      tenantIdentifier: 'test-tenant',
      accessMode: 'write',
      dryRun: true,
    });

    // PIM API returns item shape info + path
    Object.defineProperty(client.api, 'pimApi', {
      value: async () => ({
        item: {
          get: {
            id: 'item-123',
            name: 'My Product',
            type: 'product',
            tree: { path: '/products/my-product' },
            shape: {
              identifier: 'product-shape',
              name: 'Product',
              components: [
                { id: 'description', name: 'Description', type: 'singleLine' },
              ],
            },
          },
        },
      }),
      writable: true,
      configurable: true,
    });

    // Catalogue API returns current component value
    Object.defineProperty(client.api, 'catalogueApi', {
      value: async () => ({
        catalogue: {
          component: {
            content: { text: 'Old description' },
          },
        },
      }),
      writable: true,
      configurable: true,
    });

    const tools = contentTools(client);
    const updateComp = tools.find(t => t.name === 'update_component');
    if (!updateComp) {
      throw new Error('update_component not found');
    }

    const result = await updateComp.handler({
      itemId: 'item-123',
      componentId: 'description',
      value: 'New description',
      language: 'en',
    });

    assert.strictEqual(result.isError, undefined);
    const text = result.content[0].text;
    assert.ok(text.includes('[DRY RUN]'));
    assert.ok(text.includes('Old description'));
    assert.ok(text.includes('New description'));
    assert.ok(text.includes('My Product'));
  });

  it('returns error when item not found', async () => {
    const client = new CrystallizeClient({
      tenantIdentifier: 'test-tenant',
      accessMode: 'write',
      dryRun: true,
    });

    Object.defineProperty(client.api, 'pimApi', {
      value: async () => ({ item: { get: null } }),
      writable: true,
      configurable: true,
    });

    const tools = contentTools(client);
    const updateComp = tools.find(t => t.name === 'update_component');
    if (!updateComp) {
      throw new Error('update_component not found');
    }

    const result = await updateComp.handler({
      itemId: 'nonexistent',
      componentId: 'title',
      value: 'test',
      language: 'en',
    });

    assert.strictEqual(result.isError, true);
    assert.ok(result.content[0].text.includes('not found'));
  });

  it('returns error for invalid component ID', async () => {
    const client = new CrystallizeClient({
      tenantIdentifier: 'test-tenant',
      accessMode: 'write',
      dryRun: true,
    });

    Object.defineProperty(client.api, 'pimApi', {
      value: async () => ({
        item: {
          get: {
            id: 'item-123',
            name: 'Test Item',
            type: 'document',
            tree: { path: '/test' },
            shape: {
              identifier: 'doc-shape',
              name: 'Doc',
              components: [{ id: 'title', name: 'Title', type: 'singleLine' }],
            },
          },
        },
      }),
      writable: true,
      configurable: true,
    });

    const tools = contentTools(client);
    const updateComp = tools.find(t => t.name === 'update_component');
    if (!updateComp) {
      throw new Error('update_component not found');
    }

    const result = await updateComp.handler({
      itemId: 'item-123',
      componentId: 'nonexistent',
      value: 'test',
      language: 'en',
    });

    assert.strictEqual(result.isError, true);
    assert.ok(result.content[0].text.includes('nonexistent'));
    assert.ok(result.content[0].text.includes('title'));
  });

  it('supports dot notation for contentChunk children', async () => {
    const client = new CrystallizeClient({
      tenantIdentifier: 'test-tenant',
      accessMode: 'write',
      dryRun: true,
    });

    Object.defineProperty(client.api, 'pimApi', {
      value: async () => ({
        item: {
          get: {
            id: 'item-456',
            name: 'Article',
            type: 'document',
            tree: { path: '/articles/test' },
            shape: {
              identifier: 'article',
              name: 'Article',
              components: [
                {
                  id: 'hero',
                  name: 'Hero',
                  type: 'contentChunk',
                  config: {
                    components: [
                      { id: 'title', name: 'Title', type: 'singleLine' },
                      { id: 'image', name: 'Image', type: 'images' },
                    ],
                  },
                },
              ],
            },
          },
        },
      }),
      writable: true,
      configurable: true,
    });

    Object.defineProperty(client.api, 'catalogueApi', {
      value: async () => ({
        catalogue: { component: { content: null } },
      }),
      writable: true,
      configurable: true,
    });

    const tools = contentTools(client);
    const updateComp = tools.find(t => t.name === 'update_component');
    if (!updateComp) {
      throw new Error('update_component not found');
    }

    const result = await updateComp.handler({
      itemId: 'item-456',
      componentId: 'hero.title',
      value: 'New Hero Title',
      language: 'en',
    });

    assert.strictEqual(result.isError, undefined);
    const text = result.content[0].text;
    assert.ok(text.includes('[DRY RUN]'));
    assert.ok(text.includes('Hero'));
    assert.ok(text.includes('New Hero Title'));
    assert.ok(text.includes('contentChunk'));
  });

  it('returns error for invalid chunk child', async () => {
    const client = new CrystallizeClient({
      tenantIdentifier: 'test-tenant',
      accessMode: 'write',
      dryRun: true,
    });

    Object.defineProperty(client.api, 'pimApi', {
      value: async () => ({
        item: {
          get: {
            id: 'item-456',
            name: 'Article',
            type: 'document',
            tree: { path: '/articles/test' },
            shape: {
              identifier: 'article',
              name: 'Article',
              components: [
                {
                  id: 'hero',
                  name: 'Hero',
                  type: 'contentChunk',
                  config: {
                    components: [
                      { id: 'title', name: 'Title', type: 'singleLine' },
                    ],
                  },
                },
              ],
            },
          },
        },
      }),
      writable: true,
      configurable: true,
    });

    const tools = contentTools(client);
    const updateComp = tools.find(t => t.name === 'update_component');
    if (!updateComp) {
      throw new Error('update_component not found');
    }

    const result = await updateComp.handler({
      itemId: 'item-456',
      componentId: 'hero.nonexistent',
      value: 'test',
      language: 'en',
    });

    assert.strictEqual(result.isError, true);
    assert.ok(result.content[0].text.includes('nonexistent'));
    assert.ok(result.content[0].text.includes('title'));
  });
});

// --- Audit mutation metadata ---

describe('audit mutation metadata', () => {
  it('accepts entries with mutation field', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crystallize-audit-'));
    const path = join(dir, 'audit.log');

    const logger = new AuditLogger(path);
    logger.log({
      ts: '2026-01-01T00:00:00Z',
      tool: 'create_item',
      params: { name: 'Test' },
      result: 'ok',
      tenant: 'test',
      mutation: {
        type: 'create',
        after: { name: 'Test', shape: 'blog-post' },
      },
    });
    logger.log({
      ts: '2026-01-01T00:00:01Z',
      tool: 'update_component',
      params: { itemId: 'abc', componentId: 'title' },
      result: 'ok',
      tenant: 'test',
      mutation: {
        type: 'update',
        before: { text: 'Old' },
        after: { text: 'New' },
      },
    });

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    assert.strictEqual(lines.length, 2);

    const entry1 = JSON.parse(lines[0]);
    assert.strictEqual(entry1.mutation.type, 'create');
    assert.deepStrictEqual(entry1.mutation.after, {
      name: 'Test',
      shape: 'blog-post',
    });
    assert.strictEqual(entry1.mutation.before, undefined);

    const entry2 = JSON.parse(lines[1]);
    assert.strictEqual(entry2.mutation.type, 'update');
    assert.deepStrictEqual(entry2.mutation.before, { text: 'Old' });
    assert.deepStrictEqual(entry2.mutation.after, { text: 'New' });

    rmSync(dir, { recursive: true });
  });

  it('entries without mutation field still work', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crystallize-audit-'));
    const path = join(dir, 'audit.log');

    const logger = new AuditLogger(path);
    logger.log({
      ts: '2026-01-01T00:00:00Z',
      tool: 'list_shapes',
      params: {},
      result: 'ok',
      tenant: 'test',
    });

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    assert.strictEqual(lines.length, 1);

    const entry = JSON.parse(lines[0]);
    assert.strictEqual(entry.tool, 'list_shapes');
    assert.strictEqual(entry.mutation, undefined);

    rmSync(dir, { recursive: true });
  });
});
