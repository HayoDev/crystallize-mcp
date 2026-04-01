#!/usr/bin/env node

/**
 * Interactive setup for crystallize-mcp.
 *
 * Usage:
 *   npx crystallize-mcp --setup
 *   npx crystallize-mcp --setup --global
 *
 * Generates the MCP config for Claude Desktop or Claude Code.
 */

import {createInterface} from 'node:readline';
import {writeFileSync, readFileSync, existsSync} from 'node:fs';
import {resolve as resolvePath} from 'node:path';
import {homedir} from 'node:os';

const rl = createInterface({input: process.stdin, output: process.stderr});

function ask(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  return new Promise((res) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      res(answer.trim() || defaultValue || '');
    });
  });
}

async function main() {
  const isGlobal = process.argv.includes('--global');

  console.error('\n🔧 Crystallize MCP Setup\n');
  console.error('This will generate the MCP configuration for your Crystallize tenant.\n');

  // Tenant identifier (required)
  const tenant = await ask(
    'Tenant identifier (from app.crystallize.com/{tenant})',
  );
  if (!tenant) {
    console.error('\n❌ Tenant identifier is required.');
    process.exit(1);
  }

  // Auth tokens (optional)
  console.error('\nAuth tokens are optional. Without them, you can still browse the public');
  console.error('catalogue and use the Discovery API. Add tokens for PIM access (shapes, tenant info).\n');

  const wantsAuth = await ask('Add auth tokens? (y/n)', 'n');
  let tokenId = '';
  let tokenSecret = '';
  let staticToken = '';

  if (wantsAuth.toLowerCase() === 'y') {
    console.error('\nCreate tokens at: https://app.crystallize.com/' + tenant + '/en/settings/access-tokens\n');

    const authType = await ask('Auth type: (1) Token ID + Secret  (2) Static token', '1');

    if (authType === '2') {
      staticToken = await ask('Static auth token');
    } else {
      tokenId = await ask('Access Token ID');
      tokenSecret = await ask('Access Token Secret');
    }
  }

  // Access mode
  const accessMode = await ask('Access mode: read / write / admin', 'read');

  // Build env config
  const env: Record<string, string> = {
    CRYSTALLIZE_TENANT_IDENTIFIER: tenant,
  };
  if (tokenId) {env.CRYSTALLIZE_ACCESS_TOKEN_ID = tokenId;}
  if (tokenSecret) {env.CRYSTALLIZE_ACCESS_TOKEN_SECRET = tokenSecret;}
  if (staticToken) {env.CRYSTALLIZE_STATIC_AUTH_TOKEN = staticToken;}
  if (accessMode !== 'read') {env.CRYSTALLIZE_ACCESS_MODE = accessMode;}

  // Build MCP config entry
  const mcpEntry = {
    command: 'npx',
    args: ['-y', 'crystallize-mcp@latest'],
    env,
  };

  if (isGlobal) {
    // Claude Desktop config
    const configPath =
      process.platform === 'darwin'
        ? resolvePath(homedir(), 'Library/Application Support/Claude/claude_desktop_config.json')
        : resolvePath(homedir(), 'AppData/Roaming/Claude/claude_desktop_config.json');

    let config: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      } catch {
        // start fresh
      }
    }

    const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
    servers.crystallize = mcpEntry;
    config.mcpServers = servers;

    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    console.error(`\n✅ Added to Claude Desktop config: ${configPath}`);
  } else {
    // Local .mcp.json for Claude Code
    const configPath = resolvePath(process.cwd(), '.mcp.json');
    let config: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      } catch {
        // start fresh
      }
    }

    config.crystallize = mcpEntry;

    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    console.error(`\n✅ Created ${configPath}`);
  }

  console.error('\nDone! The crystallize MCP server is now configured.');
  console.error(`Tenant: ${tenant}`);
  console.error(`Auth: ${tokenId ? 'token pair' : staticToken ? 'static token' : 'none (public access)'}`);
  console.error(`Mode: ${accessMode}\n`);

  rl.close();
}

main().catch((err: unknown) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
