import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createCrystallizeMcpServer } from '../src/index.js';
import { CrystallizeClient } from '../src/client.js';

describe('createCrystallizeMcpServer', () => {
  it('should create a server and client', () => {
    const client = new CrystallizeClient({
      tenantIdentifier: 'test-tenant',
      accessMode: 'read',
    });

    const result = createCrystallizeMcpServer(client);

    assert.ok(result.server);
    assert.ok(result.client);
    assert.strictEqual(result.client.config.tenantIdentifier, 'test-tenant');
    assert.strictEqual(result.client.config.accessMode, 'read');
  });
});

describe('CrystallizeClient', () => {
  it('should generate correct deep links', () => {
    const client = new CrystallizeClient({
      tenantIdentifier: 'hageland',
      accessMode: 'read',
    });

    assert.strictEqual(
      client.itemLink('abc123'),
      'https://app.crystallize.com/@hageland/en/catalogue/document/abc123',
    );
    assert.strictEqual(
      client.itemLink('abc123', 'product'),
      'https://app.crystallize.com/@hageland/en/catalogue/product/abc123',
    );
    assert.strictEqual(
      client.shapeLink('my-shape'),
      'https://app.crystallize.com/@hageland/en/settings/shapes/my-shape',
    );
    assert.strictEqual(
      client.orderLink('order-456'),
      'https://app.crystallize.com/@hageland/en/orders/order-456',
    );
  });

  it('should respect language parameter in links', () => {
    const client = new CrystallizeClient({
      tenantIdentifier: 'hageland',
      accessMode: 'read',
    });

    assert.strictEqual(
      client.itemLink('abc123', 'document', 'no'),
      'https://app.crystallize.com/@hageland/no/catalogue/document/abc123',
    );
    assert.strictEqual(
      client.shapeLink('my-shape', 'no'),
      'https://app.crystallize.com/@hageland/no/settings/shapes/my-shape',
    );
    assert.strictEqual(
      client.orderLink('order-456', 'no'),
      'https://app.crystallize.com/@hageland/no/orders/order-456',
    );
  });
});

describe('error formatting', () => {
  it('should format categorized errors', async () => {
    const { formatError } = await import('../src/errors.js');
    const { CrystallizeToolError } = await import('../src/errors.js');

    const error = new CrystallizeToolError(
      'Item not found',
      'not_found',
      'Try browse_catalogue',
    );
    const formatted = formatError(error);

    assert.ok(formatted.includes('Item not found'));
    assert.ok(formatted.includes('Try browse_catalogue'));
  });

  it('should detect auth errors from raw messages', async () => {
    const { formatError } = await import('../src/errors.js');

    const formatted = formatError(new Error('401 Unauthorized'));
    assert.ok(formatted.includes('CRYSTALLIZE_ACCESS_TOKEN'));
  });
});
