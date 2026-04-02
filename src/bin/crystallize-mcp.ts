#!/usr/bin/env node

/**
 * Crystallize MCP Server — CLI entry point.
 *
 * Usage:
 *   crystallize-mcp              Start the MCP server (stdio transport)
 *   crystallize-mcp --setup           Interactive setup for Claude Code (.mcp.json)
 *   crystallize-mcp --setup --global  Setup for Claude Desktop
 *   crystallize-mcp --setup --local   Setup pointing at local build (for development)
 */

// Handle --setup before importing heavy deps
if (process.argv.includes('--setup')) {
  import('./setup.js').catch((err: unknown) => {
    console.error('Setup failed:', err);
    process.exit(1);
  });
} else {
  startServer().catch((error: unknown) => {
    console.error('Failed to start Crystallize MCP server:', error);
    process.exit(1);
  });
}

async function startServer() {
  const { StdioServerTransport } =
    await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { createCrystallizeMcpServer } = await import('../index.js');
  const { CrystallizeClient } = await import('../client.js');

  const crystallize = await CrystallizeClient.fromEnvOrKeychain();
  const { server, client } = createCrystallizeMcpServer(crystallize);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`Crystallize MCP server running`);
  console.error(`  Tenant: ${client.config.tenantIdentifier}`);
  console.error(`  Access mode: ${client.config.accessMode}`);
  console.error(
    `  Auth: ${client.config.accessTokenId ? 'token' : client.config.staticAuthToken ? 'static' : 'none (public catalogue only)'}`,
  );
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
