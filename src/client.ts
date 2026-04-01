/**
 * Crystallize API client wrapper.
 *
 * Thin layer over @crystallize/js-api-client that adds:
 * - Deep link generation to the Crystallize UI
 * - Consistent config from env vars
 */

import {createClient} from '@crystallize/js-api-client';
import type {ClientInterface} from '@crystallize/js-api-client';
import type {CrystallizeConfig} from './types.js';

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
  itemLink(itemId: string, language = 'en'): string {
    return `https://app.crystallize.com/${this.config.tenantIdentifier}/${language}/catalogue/${itemId}`;
  }

  /** Generate a deep link to a shape in the Crystallize UI. */
  shapeLink(shapeIdentifier: string): string {
    return `https://app.crystallize.com/${this.config.tenantIdentifier}/en/shapes/${shapeIdentifier}`;
  }

  /** Generate a deep link to an order in the Crystallize UI. */
  orderLink(orderId: string): string {
    return `https://app.crystallize.com/${this.config.tenantIdentifier}/en/orders/${orderId}`;
  }

  /** Build config from environment variables. */
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
    });
  }
}
