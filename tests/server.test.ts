import {describe, it} from 'node:test';
import assert from 'node:assert';
import {createCrystallizeMcpServer} from '../src/index.js';
import {CrystallizeClient} from '../src/client.js';

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
      'https://app.crystallize.com/hageland/en/catalogue/abc123',
    );
    assert.strictEqual(
      client.shapeLink('product'),
      'https://app.crystallize.com/hageland/en/shapes/product',
    );
    assert.strictEqual(
      client.orderLink('order-456'),
      'https://app.crystallize.com/hageland/en/orders/order-456',
    );
  });

  it('should respect language parameter in item links', () => {
    const client = new CrystallizeClient({
      tenantIdentifier: 'hageland',
      accessMode: 'read',
    });

    assert.strictEqual(
      client.itemLink('abc123', 'no'),
      'https://app.crystallize.com/hageland/no/catalogue/abc123',
    );
  });
});

describe('error formatting', () => {
  it('should format categorized errors', async () => {
    const {formatError} = await import('../src/errors.js');
    const {CrystallizeToolError} = await import('../src/errors.js');

    const error = new CrystallizeToolError('Item not found', 'not_found', 'Try browse_catalogue');
    const formatted = formatError(error);

    assert.ok(formatted.includes('Item not found'));
    assert.ok(formatted.includes('Try browse_catalogue'));
  });

  it('should detect auth errors from raw messages', async () => {
    const {formatError} = await import('../src/errors.js');

    const formatted = formatError(new Error('401 Unauthorized'));
    assert.ok(formatted.includes('CRYSTALLIZE_ACCESS_TOKEN'));
  });
});
