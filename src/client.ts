/**
 * Crystallize API client wrapper.
 *
 * Thin layer over @crystallize/js-api-client that adds:
 * - Deep link generation to the Crystallize UI
 * - Consistent config from env vars
 */

import { createClient } from '@crystallize/js-api-client';
import type { ClientInterface } from '@crystallize/js-api-client';
import { readCredentials } from './credentials.js';
import type { CrystallizeConfig, PiiMode } from './types.js';

function parsePiiMode(): PiiMode {
  const raw = process.env.CRYSTALLIZE_PII_MODE ?? 'full';
  if (!['full', 'masked', 'none'].includes(raw)) {
    throw new Error(
      `Invalid CRYSTALLIZE_PII_MODE: "${raw}". Must be "full", "masked", or "none".`,
    );
  }
  return raw as PiiMode;
}

export class CrystallizeClient {
  public readonly api: ClientInterface;
  public readonly config: CrystallizeConfig;

  constructor(config: CrystallizeConfig) {
    this.config = config;
    this.api = createClient({
      tenantIdentifier: config.tenantIdentifier,
      tenantId: config.tenantId,
      accessTokenId: config.accessTokenId,
      accessTokenSecret: config.accessTokenSecret,
      staticAuthToken: config.staticAuthToken,
    });
  }

  /** Generate a deep link to an item in the Crystallize UI. */
  itemLink(itemId: string, type = 'document', language = 'no'): string {
    return `https://app.crystallize.com/@${this.config.tenantIdentifier}/${language}/catalogue/${type}/${itemId}`;
  }

  /** Generate a deep link to a shape in the Crystallize UI. */
  shapeLink(shapeIdentifier: string): string {
    return `https://app.crystallize.com/@${this.config.tenantIdentifier}/no/settings/shapes/${shapeIdentifier}`;
  }

  /** Generate a deep link to an order in the Crystallize UI. */
  orderLink(orderId: string): string {
    return `https://app.crystallize.com/@${this.config.tenantIdentifier}/no/orders/${orderId}`;
  }

  /**
   * Build config from env vars, falling back to OS keychain for credentials.
   * Use this in the server binary. Use fromEnv() in tests.
   */
  static async fromEnvOrKeychain(): Promise<CrystallizeClient> {
    const tenantIdentifier = process.env.CRYSTALLIZE_TENANT_IDENTIFIER;
    if (!tenantIdentifier) {
      throw new Error(
        'CRYSTALLIZE_TENANT_IDENTIFIER is required.\n' +
          'Set it in your environment or MCP client config.',
      );
    }

    const accessMode = (process.env.CRYSTALLIZE_ACCESS_MODE ??
      'read') as CrystallizeConfig['accessMode'];
    if (!['read', 'write', 'admin'].includes(accessMode)) {
      throw new Error(
        `Invalid CRYSTALLIZE_ACCESS_MODE: "${accessMode}". Must be "read", "write", or "admin".`,
      );
    }

    // Env vars take priority; fall back to keychain for secrets only
    let accessTokenId = process.env.CRYSTALLIZE_ACCESS_TOKEN_ID;
    let accessTokenSecret = process.env.CRYSTALLIZE_ACCESS_TOKEN_SECRET;
    let staticAuthToken = process.env.CRYSTALLIZE_STATIC_AUTH_TOKEN;

    if (!accessTokenId && !staticAuthToken) {
      const stored = await readCredentials();
      accessTokenId = stored.accessTokenId;
      accessTokenSecret = stored.accessTokenSecret;
      staticAuthToken = stored.staticAuthToken;
    }

    const client = new CrystallizeClient({
      tenantIdentifier,
      tenantId: process.env.CRYSTALLIZE_TENANT_ID,
      accessTokenId,
      accessTokenSecret,
      staticAuthToken,
      accessMode,
      piiMode: parsePiiMode(),
      auditLog: process.env.CRYSTALLIZE_AUDIT_LOG,
    });

    // Bootstrap tenant ID if not provided — fetch from PIM API using the identifier
    if (!client.config.tenantId) {
      const data = (await client.api.pimApi(
        `query GetTenantId($identifier: String!) {
          tenant { get(identifier: $identifier) { id } }
        }`,
        { identifier: tenantIdentifier },
      )) as { tenant: { get: { id: string } } };
      client.config.tenantId = data.tenant.get.id;
    }

    return client;
  }

  /** Build config from environment variables only. */
  static fromEnv(): CrystallizeClient {
    const tenantIdentifier = process.env.CRYSTALLIZE_TENANT_IDENTIFIER;
    if (!tenantIdentifier) {
      throw new Error(
        'CRYSTALLIZE_TENANT_IDENTIFIER is required.\n' +
          'Set it in your environment or MCP client config.',
      );
    }

    const accessMode = (process.env.CRYSTALLIZE_ACCESS_MODE ??
      'read') as CrystallizeConfig['accessMode'];
    if (!['read', 'write', 'admin'].includes(accessMode)) {
      throw new Error(
        `Invalid CRYSTALLIZE_ACCESS_MODE: "${accessMode}". Must be "read", "write", or "admin".`,
      );
    }

    return new CrystallizeClient({
      tenantIdentifier,
      tenantId: process.env.CRYSTALLIZE_TENANT_ID,
      accessTokenId: process.env.CRYSTALLIZE_ACCESS_TOKEN_ID,
      accessTokenSecret: process.env.CRYSTALLIZE_ACCESS_TOKEN_SECRET,
      staticAuthToken: process.env.CRYSTALLIZE_STATIC_AUTH_TOKEN,
      accessMode,
      piiMode: parsePiiMode(),
      auditLog: process.env.CRYSTALLIZE_AUDIT_LOG,
    });
  }
}
