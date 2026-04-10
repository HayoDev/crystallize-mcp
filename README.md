# Crystallize MCP

[![npm version](https://img.shields.io/npm/v/@hayodev/crystallize-mcp.svg)](https://npmjs.org/package/@hayodev/crystallize-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@hayodev/crystallize-mcp.svg)](https://npmjs.org/package/@hayodev/crystallize-mcp)
[![license](https://img.shields.io/npm/l/@hayodev/crystallize-mcp.svg)](https://github.com/HayoDev/crystallize-mcp/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@hayodev/crystallize-mcp.svg)](https://npmjs.org/package/@hayodev/crystallize-mcp)

MCP server for [Crystallize](https://crystallize.com) headless commerce. Gives AI agents read and write access to your catalogue, products, shapes, orders, customers, and tenant config — with deep links back to the Crystallize UI, dry-run safety for mutations, and PII masking for customer data.

Works with Claude Code, Claude Desktop, Cursor, Windsurf, Copilot, and any MCP-compatible client.

## Getting started

### Setup wizard

The interactive wizard handles config, auth tokens, keychain storage, and PII mode in one step:

```bash
# Project-level — writes .mcp.json in the current directory (shared with your team)
npx @hayodev/crystallize-mcp --setup

# Global — registers via `claude mcp add` (Claude Code) or writes Claude Desktop config
npx @hayodev/crystallize-mcp --setup --global
```

### Manual config

Standard MCP config (works in any client):

```json
{
  "mcpServers": {
    "crystallize": {
      "command": "npx",
      "args": ["-y", "@hayodev/crystallize-mcp@latest"],
      "env": {
        "CRYSTALLIZE_TENANT_IDENTIFIER": "your-tenant"
      }
    }
  }
}
```

Add `CRYSTALLIZE_ACCESS_TOKEN_ID` and `CRYSTALLIZE_ACCESS_TOKEN_SECRET` to the `env` block for PIM tools (shapes, orders, customers). See [Authentication](#authentication).

<details>
<summary>Claude Code (CLI)</summary>

```bash
claude mcp add crystallize \
  -e CRYSTALLIZE_TENANT_IDENTIFIER=your-tenant \
  -e CRYSTALLIZE_ACCESS_TOKEN_ID=your-token-id \
  -e CRYSTALLIZE_ACCESS_TOKEN_SECRET=your-token-secret \
  -- npx -y @hayodev/crystallize-mcp@latest
```

Use `--scope project` to write to `.mcp.json` (shared with your team) or `--scope user` for personal use across all projects.

</details>

<details>
<summary>Claude Desktop</summary>

Add the standard config to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows).

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
      "args": ["-y", "@hayodev/crystallize-mcp@latest"],
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
- **Arguments**: `-y @hayodev/crystallize-mcp@latest`
- **Environment**: add `CRYSTALLIZE_TENANT_IDENTIFIER` and your token vars

Or copy the standard config JSON above before opening the command — Raycast will auto-fill the form.

</details>

<details>
<summary>From source (maintainers)</summary>

The `--local` flag is for developing crystallize-mcp itself. It writes `.mcp.json` pointing to the local build output — **run this from the repo root only**:

```bash
git clone https://github.com/HayoDev/crystallize-mcp.git
cd crystallize-mcp
npm install && npm run build
npx . --setup --local   # writes .mcp.json pointing to ./build/
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

## Tools (16)

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

### Content (2 tools, requires auth + write mode)

| Tool               | Description                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| `create_item`      | Create a new item (product, document, or folder) with components                                      |
| `update_component` | Update a single component value — supports nested content chunks via dot notation (e.g. `hero.title`) |

## Write tools

Write tools require `CRYSTALLIZE_ACCESS_MODE=write` (or `admin`) and a token with write permissions.

### Dry-run mode

Set `CRYSTALLIZE_DRY_RUN=true` to preview mutations without executing them. The response shows exactly what would change — the mutation payload, before/after values, and a deep link to the item:

```json
"env": {
  "CRYSTALLIZE_ACCESS_MODE": "write",
  "CRYSTALLIZE_DRY_RUN": "true"
}
```

### Example prompts

**Create an item:**

> "Create a new blog post under /blog using the article shape with title 'Getting Started'"

**Update a top-level component:**

> "Find the item at /products/summer-collection and update its description to 'New summer arrivals'"

**Update a component inside a content chunk:**

> "Get the item at /articles/my-post, then update hero.title to 'Updated Headline' and give me the deep link to review the draft"

**Update with change summary:**

> "Get the item at /articles/guides/my-guide, update its title component to 'New Guide Title', give me the deep link, and show a table of which fields in the chunk changed vs remained unchanged with before/after values"

The agent will update the target component in **draft only**, preserve all sibling components in the chunk, and return a summary like:

| Component   | Status     | Before             | After              |
| ----------- | ---------- | ------------------ | ------------------ |
| title       | ✏️ Updated | Old Guide Title    | New Guide Title    |
| image       | Unchanged  | _(existing image)_ | _(existing image)_ |
| description | Unchanged  | _(existing text)_  | _(existing text)_  |

No publishing happens — you review the change in the Crystallize UI via the deep link and publish when ready.

## Authentication

Catalogue and Discovery tools work without auth — just set `CRYSTALLIZE_TENANT_IDENTIFIER`.

For PIM tools (shapes, tenant info, orders, customers), create an access token at:
`https://app.crystallize.com/{tenant}/en/settings/access-tokens`

> **Note:** Crystallize tokens inherit permissions from the user who created them. To restrict an agent to read-only access, generate the token under a user with a read-only role. See [Crystallize Roles](https://crystallize.com/docs/configuration/roles).

### Environment variables

| Variable                          | Required | Description                                                                            |
| --------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| `CRYSTALLIZE_TENANT_IDENTIFIER`   | Yes      | Your tenant identifier from `app.crystallize.com/{tenant}`                             |
| `CRYSTALLIZE_ACCESS_TOKEN_ID`     | No       | Access token ID for PIM API                                                            |
| `CRYSTALLIZE_ACCESS_TOKEN_SECRET` | No       | Access token secret (paired with token ID)                                             |
| `CRYSTALLIZE_STATIC_AUTH_TOKEN`   | No       | Static auth token (alternative to ID/secret pair)                                      |
| `CRYSTALLIZE_ACCESS_MODE`         | No       | `read` (default), `write`, or `admin` — controls which tools are registered            |
| `CRYSTALLIZE_DRY_RUN`             | No       | `true` to preview write operations without executing — see [Write tools](#write-tools) |
| `CRYSTALLIZE_PII_MODE`            | No       | `full` (default), `masked`, or `none` — controls PII in customer/order responses       |
| `CRYSTALLIZE_AUDIT_LOG`           | No       | Path to write an audit log — `~` is expanded (e.g. `~/.crystallize-mcp/audit.log`)     |

### PII mode (opt-in)

By default all customer and order data is returned as-is (`full`). Set `CRYSTALLIZE_PII_MODE` to opt in to data minimisation:

| Mode     | Behaviour                                                                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `full`   | Default — all fields returned unchanged                                                                                                                                            |
| `masked` | Emails → `h***@example.com`, phones → `***-1234`, addresses → city + country only                                                                                                  |
| `none`   | Contact/PII fields stripped — names, emails, phones, addresses, meta, and external references removed. Non-contact data (order lines, payment types, totals) may still be present. |

Applies to `list_customers`, `get_customer`, `list_orders`, and `get_order`. No effect on catalogue or shape tools.

Relevant for teams handling real customer data, GDPR Article 25 compliance (data minimisation by design), or environments where the AI doesn't need raw contact details to do its job. A common pattern is `masked` on production and `full` on dev.

### Audit log (opt-in)

Set `CRYSTALLIZE_AUDIT_LOG` to an absolute file path to enable structured logging of every tool call:

```json
{
  "ts": "2026-04-03T14:38:41Z",
  "tool": "list_customers",
  "params": { "first": 10 },
  "result": "ok",
  "tenant": "my-store"
}
```

One JSON line per call — timestamp, tool name, params, result (`ok`/`error`), and tenant. Write tools also log mutation metadata (before/after state) for audit trails.

> **Note:** Params are logged as-is and may contain PII — for example, a `searchTerm` of `hani@example.com` or a `customerIdentifier`. Treat the audit log file as sensitive data and restrict access accordingly. Param scrubbing is on the roadmap but not yet implemented.

Easy to pipe into log aggregators (Datadog, CloudWatch, Splunk) — but ensure your pipeline handles the file with appropriate access controls.

### Keychain storage (optional)

The setup wizard (`npx @hayodev/crystallize-mcp --setup`) can store tokens in the OS keychain (macOS Keychain, Windows Credential Manager, or libsecret on Linux) so they never appear as plain text in config files. The MCP server resolves credentials from the keychain automatically at startup — no extra configuration needed.

This is useful when:

- **Your `.mcp.json` is committed to git** — keychain keeps tokens out of the repository
- **You prefer not to have secrets in plain text config files** — the config only needs `CRYSTALLIZE_TENANT_IDENTIFIER`

When using `--setup --global` with Claude Code, the wizard runs `claude mcp add` with only the non-secret env vars. Tokens are read from the keychain at runtime, so they never appear in the Claude Code config either.

### Access mode

`CRYSTALLIZE_ACCESS_MODE` controls which tools the MCP server registers at startup:

- **`read`** (default) — read-only tools only
- **`write`** — includes content creation and component updates (with dry-run support)
- **`admin`** — full access including shape modifications and tenant config

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
