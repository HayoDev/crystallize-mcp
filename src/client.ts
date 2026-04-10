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
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CrystallizeConfig, PiiMode } from './types.js';

function expandPath(p: string): string {
  return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p;
}

function parseDryRun(): boolean {
  const raw = process.env.CRYSTALLIZE_DRY_RUN ?? '';
  return raw === 'true' || raw === '1';
}

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
    this.config = { piiMode: 'full', ...config };
    this.api = createClient({
      tenantIdentifier: config.tenantIdentifier,
      tenantId: config.tenantId,
      accessTokenId: config.accessTokenId,
      accessTokenSecret: config.accessTokenSecret,
      staticAuthToken: config.staticAuthToken,
    });
  }

  /** Generate a deep link to an item in the Crystallize UI. */
  itemLink(itemId: string, type = 'document', language?: string): string {
    const lang = language ?? this.config.defaultLanguage ?? 'en';
    return `https://app.crystallize.com/@${this.config.tenantIdentifier}/${lang}/catalogue/${type}/${itemId}`;
  }

  /** Generate a deep link to a shape in the Crystallize UI. */
  shapeLink(shapeIdentifier: string, language?: string): string {
    const lang = language ?? this.config.defaultLanguage ?? 'en';
    return `https://app.crystallize.com/@${this.config.tenantIdentifier}/${lang}/settings/shapes/${shapeIdentifier}`;
  }

  /** Generate a full frontend URL for a catalogue path.
   *  When draft is false, strip preview query params. */
  catalogueLink(path: string, draft = false): string | null {
    if (!this.config.frontendUrl) {
      return null;
    }
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    let url: string;
    // Handle Crystallize {{itemPath}} template variable
    if (this.config.frontendUrl.includes('{{itemPath}}')) {
      url = this.config.frontendUrl.replace('{{itemPath}}', cleanPath);
    } else {
      const base = this.config.frontendUrl.replace(/\/+$/, '');
      url = `${base}/${cleanPath}`;
    }
    if (!draft) {
      // Strip ?preview=true or &preview=true from the URL
      try {
        const parsed = new URL(url);
        parsed.searchParams.delete('preview');
        url = parsed.toString();
      } catch {
        // If URL parsing fails, return as-is
      }
    }
    return url;
  }

  /** Construct a Crystallize media CDN URL from an image/video key. */
  mediaUrl(key: string): string {
    return `https://media.crystallize.com/${this.config.tenantIdentifier}/${key}`;
  }

  /** Generate a deep link to an order in the Crystallize UI. */
  orderLink(orderId: string, language?: string): string {
    const lang = language ?? this.config.defaultLanguage ?? 'en';
    return `https://app.crystallize.com/@${this.config.tenantIdentifier}/${lang}/orders/${orderId}`;
  }

  /** Generate a deep link to a customer in the Crystallize UI. */
  customerLink(identifier: string, language?: string): string {
    const lang = language ?? this.config.defaultLanguage ?? 'en';
    return `https://app.crystallize.com/@${this.config.tenantIdentifier}/${lang}/customers/${encodeURIComponent(identifier)}`;
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
      dryRun: parseDryRun(),
      auditLog: process.env.CRYSTALLIZE_AUDIT_LOG
        ? expandPath(process.env.CRYSTALLIZE_AUDIT_LOG)
        : undefined,
    });

    // Bootstrap tenant ID and default language from PIM API
    if (!client.config.tenantId || !client.config.defaultLanguage) {
      const data = (await client.api.pimApi(
        `query GetTenantMeta($identifier: String!) {
          tenant { get(identifier: $identifier) { id defaults { language } } }
        }`,
        { identifier: tenantIdentifier },
      )) as {
        tenant: { get: { id: string; defaults?: { language?: string } } };
      };
      client.config.tenantId ??= data.tenant.get.id;
      client.config.defaultLanguage ??=
        data.tenant.get.defaults?.language ?? 'en';
    }

    // Fetch frontend URL from Core API tenant preferences
    if (!client.config.frontendUrl) {
      try {
        const feData = (await client.api.nextPimApi(
          `query GetFrontends($identifier: String!) {
            tenant(identifier: $identifier) {
              ... on Tenant {
                preferences { frontends { name url } }
              }
            }
          }`,
          { identifier: tenantIdentifier },
        )) as {
          tenant?: {
            preferences?: {
              frontends?: { name: string; url: string }[];
            };
          };
        };
        const frontends = feData.tenant?.preferences?.frontends;
        if (frontends?.length) {
          client.config.frontendUrl = frontends[0].url;
        }
      } catch {
        // Non-critical — frontend links will just be omitted
      }
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
      dryRun: parseDryRun(),
      auditLog: process.env.CRYSTALLIZE_AUDIT_LOG
        ? expandPath(process.env.CRYSTALLIZE_AUDIT_LOG)
        : undefined,
    });
  }
}
