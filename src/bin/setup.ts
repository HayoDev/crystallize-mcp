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

import { createInterface } from 'node:readline';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { isKeychainAvailable, writeCredentials } from '../credentials.js';

const rl = createInterface({ input: process.stdin, output: process.stderr });

function ask(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  return new Promise(res => {
    rl.question(`${question}${suffix}: `, answer => {
      res(answer.trim() || defaultValue || '');
    });
  });
}

async function main() {
  const isGlobal = process.argv.includes('--global');
  const isLocal = process.argv.includes('--local');

  console.error('\n🔧 Crystallize MCP Setup\n');
  console.error(
    'This will generate the MCP configuration for your Crystallize tenant.\n',
  );

  // Tenant identifier (required)
  const tenant = await ask(
    'Tenant identifier (from app.crystallize.com/{tenant})',
  );
  if (!tenant) {
    console.error('\n❌ Tenant identifier is required.');
    process.exit(1);
  }

  // Tenant ID (MongoDB UUID — find it at app.crystallize.com/{tenant}/en/settings/tenant)
  const tenantId = await ask(
    'Tenant ID (UUID from Settings → Tenant info, optional)',
  );

  // Auth tokens (optional)
  console.error(
    '\nAuth tokens are optional. Without them, you can still browse the public',
  );
  console.error(
    'catalogue and use the Discovery API. Add tokens for PIM access (shapes, tenant info).\n',
  );

  const wantsAuth = await ask('Add auth tokens? (y/n)', 'n');
  let tokenId = '';
  let tokenSecret = '';
  let staticToken = '';

  if (wantsAuth.toLowerCase() === 'y') {
    console.error(
      '\nCreate tokens at: https://app.crystallize.com/' +
        tenant +
        '/en/settings/access-tokens\n',
    );

    const authType = await ask(
      'Auth type: (1) Token ID + Secret  (2) Static token',
      '1',
    );

    if (authType === '2') {
      staticToken = await ask('Static auth token');
    } else {
      tokenId = await ask('Access Token ID');
      tokenSecret = await ask('Access Token Signature Secret');
    }
  }

  // Access mode
  const accessMode = await ask('Access mode: read / write / admin', 'read');

  // PII mode — relevant when accessing customer/order data
  console.error(
    '\nPII mode controls how customer data (emails, phones, addresses) is returned:',
  );
  console.error('  full   — all data returned as-is (default)');
  console.error('  masked — emails and phones partially masked');
  console.error('  none   — contact/PII fields stripped entirely\n');
  const piiMode = await ask('PII mode: full / masked / none', 'full');

  // Dry-run — only relevant for write/admin modes
  let dryRun = false;
  if (accessMode === 'write' || accessMode === 'admin') {
    console.error(
      '\nDry-run mode previews mutations without executing them — useful for testing.',
    );
    const dryRunAnswer = await ask('Enable dry-run mode? y/n', 'n');
    dryRun = dryRunAnswer.toLowerCase() === 'y';
  }

  // Audit log
  console.error(
    '\nAudit log records every tool call (timestamp, tool, params, result).',
  );
  console.error(
    'Leave blank to disable, or enter a file path (~ is expanded).',
  );
  const auditLog = await ask('Audit log path', '~/.crystallize-mcp/audit.log');

  // Keychain offer — only if tokens were entered and keychain is reachable
  const hasSecrets = tokenId || tokenSecret || staticToken;
  let useKeychain = false;

  if (hasSecrets) {
    const keychainAvailable = await isKeychainAvailable();
    if (keychainAvailable) {
      console.error(
        '\n🔑 OS keychain detected (Keychain / Credential Manager / libsecret).',
      );
      const answer = await ask(
        'Store tokens in OS keychain instead of config file? (recommended) y/n',
        'y',
      );
      useKeychain = answer.toLowerCase() !== 'n';
    } else {
      console.error(
        '\n⚠️  OS keychain not available — tokens will be written to the config file.',
      );
    }
  }

  // Store to keychain if chosen
  if (useKeychain && hasSecrets) {
    await writeCredentials({
      accessTokenId: tokenId || undefined,
      accessTokenSecret: tokenSecret || undefined,
      staticAuthToken: staticToken || undefined,
    });
    console.error('✅ Tokens saved to OS keychain.');
  }

  // Build env config — always write all vars so the config is self-documenting.
  // Omit secrets if stored in keychain.
  const env: Record<string, string> = {
    CRYSTALLIZE_TENANT_IDENTIFIER: tenant,
  };
  if (tenantId) {
    env.CRYSTALLIZE_TENANT_ID = tenantId;
  }
  if (!useKeychain) {
    if (tokenId) {
      env.CRYSTALLIZE_ACCESS_TOKEN_ID = tokenId;
    }
    if (tokenSecret) {
      env.CRYSTALLIZE_ACCESS_TOKEN_SECRET = tokenSecret;
    }
    if (staticToken) {
      env.CRYSTALLIZE_STATIC_AUTH_TOKEN = staticToken;
    }
  }
  env.CRYSTALLIZE_ACCESS_MODE = accessMode;
  env.CRYSTALLIZE_PII_MODE = piiMode;
  env.CRYSTALLIZE_DRY_RUN = dryRun ? 'true' : 'false';
  if (auditLog) {
    env.CRYSTALLIZE_AUDIT_LOG = auditLog;
  }

  // Build MCP config entry
  const mcpEntry = isLocal
    ? {
        command: 'node',
        args: [resolvePath(process.cwd(), 'build/src/bin/crystallize-mcp.js')],
        env,
      }
    : {
        command: 'npx',
        args: ['-y', '@hayodev/crystallize-mcp@latest'],
        env,
      };

  if (isGlobal) {
    // Try Claude Code CLI first, then fall back to Claude Desktop config file
    const hasClaudeCli = (() => {
      try {
        execFileSync('claude', ['--version'], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    })();

    if (hasClaudeCli) {
      // Use `claude mcp add` for Claude Code
      const args = ['mcp', 'add', '--transport', 'stdio'];
      for (const [key, val] of Object.entries(env)) {
        args.push('--env', `${key}=${val}`);
      }
      args.push('crystallize', '--');
      if (isLocal) {
        args.push(
          'node',
          resolvePath(process.cwd(), 'build/src/bin/crystallize-mcp.js'),
        );
      } else {
        args.push('npx', '-y', '@hayodev/crystallize-mcp@latest');
      }

      try {
        execFileSync('claude', args, { stdio: 'inherit' });
        console.error('\n✅ Added via Claude Code CLI: claude mcp add');
      } catch {
        console.error(
          '\n⚠️  `claude mcp add` failed. You can add it manually:',
        );
        console.error(
          `   claude mcp add crystallize -- npx -y @hayodev/crystallize-mcp@latest`,
        );
      }
    } else {
      // Fall back to Claude Desktop config file
      const configPath =
        process.platform === 'darwin'
          ? resolvePath(
              homedir(),
              'Library/Application Support/Claude/claude_desktop_config.json',
            )
          : resolvePath(
              homedir(),
              'AppData/Roaming/Claude/claude_desktop_config.json',
            );

      let config: Record<string, unknown> = {};
      if (existsSync(configPath)) {
        try {
          config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<
            string,
            unknown
          >;
        } catch {
          // start fresh
        }
      }

      const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
      servers.crystallize = mcpEntry;
      config.mcpServers = servers;

      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      console.error(`\n✅ Added to Claude Desktop config: ${configPath}`);
    }
  } else {
    // Local .mcp.json for Claude Code
    const configPath = resolvePath(process.cwd(), '.mcp.json');
    let config: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<
          string,
          unknown
        >;
      } catch {
        // start fresh
      }
    }

    const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
    servers.crystallize = mcpEntry;
    config.mcpServers = servers;

    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    console.error(`\n✅ Created ${configPath}`);
  }

  console.error('\nDone! The crystallize MCP server is now configured.');
  console.error(`Tenant: ${tenant}`);
  if (hasSecrets) {
    const authType = tokenId ? 'token pair' : 'static token';
    const storage = useKeychain ? 'OS keychain' : 'config file';
    console.error(`Auth: ${authType} (stored in ${storage})`);
  } else {
    console.error('Auth: none (public catalogue only)');
  }
  console.error(`Mode: ${accessMode}`);
  if (piiMode !== 'full') {
    console.error(`PII: ${piiMode}`);
  }
  if (dryRun) {
    console.error(
      'Dry-run: enabled (mutations will be previewed, not executed)',
    );
  }
  if (auditLog) {
    console.error(`Audit log: ${auditLog}`);
  }
  console.error('');

  rl.close();
}

main().catch((err: unknown) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
