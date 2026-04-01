/**
 * Crystallize MCP Server.
 *
 * Provides headless commerce tools for AI agents via the Model Context Protocol.
 */

import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {ZodRawShape} from 'zod';
import {CrystallizeClient} from './client.js';
import {formatError} from './errors.js';
import type {AccessMode, ToolDefinition} from './types.js';

// Tool groups
import {catalogueTools} from './tools/catalogue.js';
import {shapeTools} from './tools/shapes.js';
import {discoveryTools} from './tools/discovery.js';

/** Access mode hierarchy: read < write < admin. */
const ACCESS_LEVELS: Record<AccessMode, number> = {
  read: 0,
  write: 1,
  admin: 2,
};

function hasAccess(required: AccessMode, current: AccessMode): boolean {
  return ACCESS_LEVELS[current] >= ACCESS_LEVELS[required];
}

export function createCrystallizeMcpServer(client?: CrystallizeClient): {
  server: McpServer;
  client: CrystallizeClient;
} {
  const crystallize = client ?? CrystallizeClient.fromEnv();

  const server = new McpServer(
    {
      name: 'crystallize-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Collect all tool definitions
  const allTools: ToolDefinition[] = [
    ...catalogueTools(crystallize),
    ...shapeTools(crystallize),
    ...discoveryTools(crystallize),
  ];

  // Register tools that match the current access mode
  for (const tool of allTools) {
    const requiredMode = tool.mode ?? 'read';
    if (!hasAccess(requiredMode, crystallize.config.accessMode)) {
      continue;
    }

    server.tool(
      tool.name,
      tool.description,
      tool.schema as Record<string, ZodRawShape[string]>,
      async (params: Record<string, unknown>) => {
        try {
          return await tool.handler(params);
        } catch (error) {
          return {
            content: [{type: 'text' as const, text: formatError(error)}],
            isError: true,
          };
        }
      },
    );
  }

  return {server, client: crystallize};
}
