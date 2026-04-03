# Crystallize MCP

[![npm version](https://img.shields.io/npm/v/crystallize-mcp.svg)](https://npmjs.org/package/crystallize-mcp)
[![npm downloads](https://img.shields.io/npm/dm/crystallize-mcp.svg)](https://npmjs.org/package/crystallize-mcp)
[![license](https://img.shields.io/npm/l/crystallize-mcp.svg)](https://github.com/HayoDev/crystallize-mcp/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/crystallize-mcp.svg)](https://npmjs.org/package/crystallize-mcp)

MCP server for [Crystallize](https://crystallize.com) headless commerce. Gives AI agents read access to your catalogue, products, shapes, orders, customers, and tenant config — with deep links back to the Crystallize UI.

Works with Claude Code, Claude Desktop, Cursor, Windsurf, Copilot, and any MCP-compatible client.

## Getting started

Standard MCP config (works in any client):

```json
{
  "mcpServers": {
    "crystallize": {
      "command": "npx",
      "args": ["-y", "crystallize-mcp@latest"],
      "env": {
        "CRYSTALLIZE_TENANT_IDENTIFIER": "your-tenant"
      }
    }
  }
}
```

Add `CRYSTALLIZE_ACCESS_TOKEN_ID` and `CRYSTALLIZE_ACCESS_TOKEN_SECRET` to the `env` block for PIM tools (shapes, orders, customers). See [Authentication](#authentication).

<details>
<summary>Claude Code</summary>

```bash
claude mcp add crystallize \
  -e CRYSTALLIZE_TENANT_IDENTIFIER=your-tenant \
  -e CRYSTALLIZE_ACCESS_TOKEN_ID=your-token-id \
  -e CRYSTALLIZE_ACCESS_TOKEN_SECRET=your-token-secret \
  -- npx -y crystallize-mcp@latest
```

Use `--scope project` to write to `.mcp.json` (shared with your team) or `--scope user` for personal use across all projects.

Or run the guided setup wizard, which can optionally store tokens in the OS keychain instead of plain text:

```bash
npx crystallize-mcp --setup
```

</details>

<details>
<summary>Claude Desktop</summary>

Run the guided wizard — it writes directly to `claude_desktop_config.json` and can store tokens in the macOS Keychain so they never appear in the config file:

```bash
npx crystallize-mcp --setup --global
```

Or add the standard config manually to `~/Library/Application Support/Claude/claude_desktop_config.json`.

</details>

<details>
<summary>Cursor</summary>

Add the standard config to your Cursor MCP settings (`~/.cursor/mcp.json` or the project-level `.cursor/mcp.json`).

</details>

<details>
<summary>VS Code / GitHub Copilot</summary>

Add the standard config to `.vscode/mcp.json` in your project root.

```json
{
  "servers": {
    "crystallize": {
      "command": "npx",
      "args": ["-y", "crystallize-mcp@latest"],
      "env": {
        "CRYSTALLIZE_TENANT_IDENTIFIER": "your-tenant",
        "CRYSTALLIZE_ACCESS_TOKEN_ID": "your-token-id",
        "CRYSTALLIZE_ACCESS_TOKEN_SECRET": "your-token-secret"
      }
    }
  }
}
```

</details>

<details>
<summary>Windsurf</summary>

Add the standard config to `~/.codeium/windsurf/mcp_config.json`.

</details>

<details>
<summary>Gemini CLI</summary>

Add the standard config to `~/.gemini/settings.json`.

</details>

<details>
<summary>JetBrains AI Assistant</summary>

Add the standard config to `.junie/mcp.json` in your project root.

</details>

<details>
<summary>Warp</summary>

Add the standard config to `~/.warp/mcp.json`.

</details>

<details>
<summary>Raycast</summary>

Open "Install MCP Server" in Raycast and fill in:

- **Command**: `npx`
- **Arguments**: `-y crystallize-mcp@latest`
- **Environment**: add `CRYSTALLIZE_TENANT_IDENTIFIER` and your token vars

Or copy the standard config JSON above before opening the command — Raycast will auto-fill the form.

</details>

<details>
<summary>From source</summary>

```bash
git clone https://github.com/HayoDev/crystallize-mcp.git
cd crystallize-mcp
npm install && npm run build
npx . --setup --local   # writes .mcp.json pointing to local build
```

Or point your MCP client directly at the built entry point:

```json
{
  "mcpServers": {
    "crystallize": {
      "command": "node",
      "args": ["/path/to/crystallize-mcp/build/src/bin/crystallize-mcp.js"],
      "env": {
        "CRYSTALLIZE_TENANT_IDENTIFIER": "your-tenant"
      }
    }
  }
}
```

</details>

## Tools (12)

### Catalogue (4 tools)

| Tool                   | Description                                          |
| ---------------------- | ---------------------------------------------------- |
| `browse_catalogue`     | Traverse the item tree by path                       |
| `get_item`             | Fetch an item by path or ID with full component data |
| `search_catalogue`     | Keyword search across all items                      |
| `get_product_variants` | List variants with pricing and stock                 |

### Discovery (3 tools)

| Tool                    | Description                                                           |
| ----------------------- | --------------------------------------------------------------------- |
| `list_discovery_shapes` | List all shapes with their queryable fields                           |
| `browse_shape`          | Browse items of a shape with filters, pagination, and field selection |
| `get_shape_fields`      | Detailed field info for a specific shape                              |

### Shapes & Tenant (3 tools, requires auth)

| Tool              | Description                                  |
| ----------------- | -------------------------------------------- |
| `list_shapes`     | All shapes with component summaries          |
| `get_shape`       | Full component definition for a shape        |
| `get_tenant_info` | Tenant configuration and available languages |

### Orders (2 tools, requires auth)

| Tool          | Description                                           |
| ------------- | ----------------------------------------------------- |
| `list_orders` | List orders for a customer with pagination            |
| `get_order`   | Full order details — cart, payments, customer, totals |

### Customers (2 tools, requires auth)

| Tool             | Description                                                  |
| ---------------- | ------------------------------------------------------------ |
| `list_customers` | Search and list customers with pagination                    |
| `get_customer`   | Full customer profile — addresses, meta, external references |

## Authentication

Catalogue and Discovery tools work without auth — just set `CRYSTALLIZE_TENANT_IDENTIFIER`.

For PIM tools (shapes, tenant info, orders, customers), create an access token at:
`https://app.crystallize.com/{tenant}/en/settings/access-tokens`

> **Note:** Crystallize tokens inherit permissions from the user who created them. To restrict an agent to read-only access, generate the token under a user with a read-only role. See [Crystallize Roles](https://crystallize.com/docs/configuration/roles).

### Environment variables

| Variable                          | Required | Description                                                                        |
| --------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `CRYSTALLIZE_TENANT_IDENTIFIER`   | Yes      | Your tenant identifier from `app.crystallize.com/{tenant}`                         |
| `CRYSTALLIZE_ACCESS_TOKEN_ID`     | No       | Access token ID for PIM API                                                        |
| `CRYSTALLIZE_ACCESS_TOKEN_SECRET` | No       | Access token secret (paired with token ID)                                         |
| `CRYSTALLIZE_STATIC_AUTH_TOKEN`   | No       | Static auth token (alternative to ID/secret pair)                                  |
| `CRYSTALLIZE_ACCESS_MODE`         | No       | `read` (default), `write`, or `admin` — controls which tools are registered        |
| `CRYSTALLIZE_PII_MODE`            | No       | `full` (default), `masked`, or `none` — controls PII in customer/order responses   |
| `CRYSTALLIZE_AUDIT_LOG`           | No       | Path to write an audit log — `~` is expanded (e.g. `~/.crystallize-mcp/audit.log`) |

### PII mode (opt-in)

By default all customer and order data is returned as-is (`full`). Set `CRYSTALLIZE_PII_MODE` to opt in to data minimisation:

| Mode     | Behaviour                                                                         |
| -------- | --------------------------------------------------------------------------------- |
| `full`   | Default — all fields returned unchanged                                           |
| `masked` | Emails → `h***@example.com`, phones → `***-1234`, addresses → city + country only |
| `none`   | Contact data stripped entirely — identifiers, dates, and totals only              |

Applies to `list_customers`, `get_customer`, `list_orders`, and `get_order`. No effect on catalogue or shape tools.

Relevant for teams handling real customer data, GDPR Article 25 compliance (data minimisation by design), or environments where the AI doesn't need raw contact details to do its job. A common pattern is `masked` on production and `full` on dev.

### Audit log (opt-in)

Set `CRYSTALLIZE_AUDIT_LOG` to an absolute file path to enable structured logging of every tool call:

```json
{
  "ts": "2026-04-03T14:38:41Z",
  "tool": "list_customers",
  "params": { "first": 10 },
  "result": "Customers (10 of 18):",
  "tenant": "hageland-prod"
}
```

One JSON line per call — timestamp, tool name, sanitised params, result summary, and tenant. Response content is never logged. Easy to pipe into log aggregators (Datadog, CloudWatch, Splunk).

### Keychain storage (optional)

The setup wizard (`npx crystallize-mcp --setup`) can store tokens in the OS keychain (macOS Keychain, Windows Credential Manager, or libsecret on Linux) so they never appear as plain text in config files. This is particularly useful for:

- **Claude Desktop users** — config is written to a JSON file with no CLI equivalent for secret management
- **Shared `.mcp.json`** — when your project config is committed to git, keychain storage keeps tokens out of the repository

When tokens are in the keychain, the config only needs `CRYSTALLIZE_TENANT_IDENTIFIER` — credentials are resolved automatically at startup.

Note: CLI-based MCP clients (`claude mcp add`, Cursor, Copilot, etc.) store env vars as plain text in their config files and do not integrate with the OS keychain directly. If plain text env vars in a local config file are acceptable for your setup, the wizard's keychain option is not needed.

### Access mode

`CRYSTALLIZE_ACCESS_MODE` controls which tools the MCP server registers at startup:

- **`read`** (default) — read-only tools only
- **`write`** — includes tools that can create/update content (Phase 3)
- **`admin`** — full access including webhooks and tenant config (Phase 3)

## Deep links

Every response includes clickable links to the Crystallize UI:

- Items → `app.crystallize.com/@{tenant}/{language}/catalogue/{type}/{itemId}`
- Shapes → `app.crystallize.com/@{tenant}/{language}/settings/shapes/{identifier}`
- Orders → `app.crystallize.com/@{tenant}/{language}/orders/{orderId}`

The language segment is automatically set from the tenant's default language, bootstrapped at server startup — no configuration needed. Tools that accept a `language` parameter (catalogue, search) use the requested language in both the API call and the generated link.

## Development

```bash
npm install
npm run build
npm run dev          # build + start
npm run lint         # oxlint
npm run format       # oxlint --fix + oxfmt
npm run typecheck    # tsc --noEmit
npm run test         # build + node --test
```

## License

MIT
