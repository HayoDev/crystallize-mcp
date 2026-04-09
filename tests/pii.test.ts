import { describe, it } from 'node:test';
import assert from 'node:assert';
import { maskEmail, maskPhone, maskFields } from '../src/pii.js';
import { AuditLogger, summariseResult } from '../src/audit.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('maskEmail', () => {
  it('masks local part keeping first char', () => {
    assert.strictEqual(maskEmail('hani@example.com'), 'h***@example.com');
  });

  it('masks single-char local part', () => {
    assert.strictEqual(maskEmail('a@example.com'), 'a***@example.com');
  });

  it('returns *** for invalid email', () => {
    assert.strictEqual(maskEmail('notanemail'), '***');
  });

  it('preserves domain', () => {
    assert.strictEqual(maskEmail('user@sub.domain.com'), 'u***@sub.domain.com');
  });
});

describe('maskPhone', () => {
  it('keeps last 4 digits', () => {
    assert.strictEqual(maskPhone('+4747601264'), '***-1264');
  });

  it('handles short numbers', () => {
    assert.strictEqual(maskPhone('123'), '***');
  });

  it('strips non-digits before masking', () => {
    assert.strictEqual(maskPhone('+1 (555) 123-4567'), '***-4567');
  });
});

describe('maskFields', () => {
  const obj = {
    email: 'hani@example.com',
    phone: '+4747601264',
    firstName: 'Hani',
    lastName: 'AZ',
    city: 'Oslo',
  };

  it('full mode returns a new object with all fields intact', () => {
    const result = maskFields(obj, 'full');
    assert.notStrictEqual(result, obj);
    assert.strictEqual(result.email, 'hani@example.com');
    assert.strictEqual(result.phone, '+4747601264');
  });

  it('masked mode masks email and phone', () => {
    const result = maskFields(obj, 'masked');
    assert.strictEqual(result.email, 'h***@example.com');
    assert.strictEqual(result.phone, '***-1264');
    assert.strictEqual(result.firstName, 'Hani');
  });

  it('none mode strips contact fields', () => {
    const result = maskFields(obj, 'none');
    assert.strictEqual('email' in result, false);
    assert.strictEqual('phone' in result, false);
    assert.strictEqual('firstName' in result, false);
    assert.strictEqual('lastName' in result, false);
    assert.strictEqual(result.city, 'Oslo');
  });

  it('does not mutate the original', () => {
    maskFields(obj, 'none');
    assert.strictEqual(obj.email, 'hani@example.com');
  });
});

describe('AuditLogger', () => {
  it('writes ok/error entries without throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crystallize-audit-'));
    const path = join(dir, 'audit.log');

    const logger = new AuditLogger(path);
    logger.log({
      ts: '2026-01-01T00:00:00Z',
      tool: 'list_customers',
      params: { first: 10 },
      result: 'ok',
      tenant: 'test',
    });
    logger.log({
      ts: '2026-01-01T00:00:01Z',
      tool: 'get_order',
      params: { id: 'abc' },
      result: 'error',
      tenant: 'test',
    });

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    assert.strictEqual(lines.length, 2);

    const entry = JSON.parse(lines[0]);
    assert.strictEqual(entry.tool, 'list_customers');
    assert.strictEqual(entry.result, 'ok');
    assert.strictEqual('content' in entry, false);

    rmSync(dir, { recursive: true });
  });

  it('disables gracefully on bad path', () => {
    const logger = new AuditLogger('/no/such/path/that/exists/audit.log');
    assert.doesNotThrow(() => {
      logger.log({
        ts: '2026-01-01T00:00:00Z',
        tool: 'test',
        params: {},
        result: 'ok',
        tenant: 'test',
      });
    });
  });
});

describe('summariseResult', () => {
  it('returns ok for successful result', () => {
    assert.strictEqual(summariseResult({}), 'ok');
  });

  it('returns error for error result', () => {
    assert.strictEqual(summariseResult({ isError: true }), 'error');
  });

  it('returns only ok/error regardless of result payload', () => {
    const okResult = summariseResult({});
    const errorResult = summariseResult({ isError: true });
    assert.ok(['ok', 'error'].includes(okResult));
    assert.ok(['ok', 'error'].includes(errorResult));
    assert.strictEqual(okResult, 'ok');
    assert.strictEqual(errorResult, 'error');
  });
});
