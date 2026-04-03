/**
 * Shared types for crystallize-mcp.
 */

import type { z, ZodRawShape } from 'zod';

/** Access mode controls which tools are registered. */
export type AccessMode = 'read' | 'write' | 'admin';

/** MCP tool result content block. */
export interface TextContent {
  type: 'text';
  text: string;
}

/** MCP tool result — uses index signature to satisfy MCP SDK. */
export interface ToolResult {
  [key: string]: unknown;
  content: TextContent[];
  isError?: boolean;
}

/** A complete tool definition — schema, handler, and metadata. */
export interface ToolDefinition<T extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  schema: T;
  /** Minimum access mode required to use this tool. Defaults to 'read'. */
  mode?: AccessMode;
  handler: (params: z.objectOutputType<T, z.ZodTypeAny>) => Promise<ToolResult>;
}

/** PII masking mode for customer/order data. */
export type PiiMode = 'full' | 'masked' | 'none';

/** Crystallize environment configuration. */
export interface CrystallizeConfig {
  tenantIdentifier: string;
  tenantId?: string;
  accessTokenId?: string;
  accessTokenSecret?: string;
  staticAuthToken?: string;
  accessMode: AccessMode;
  defaultLanguage?: string;
  piiMode?: PiiMode;
  auditLog?: string;
}

/** Error categories for actionable error messages. */
export type ErrorCategory =
  | 'auth'
  | 'not_found'
  | 'rate_limit'
  | 'permission'
  | 'validation'
  | 'unknown';
