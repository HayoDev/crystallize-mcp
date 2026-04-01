# Crystallize MCP

MCP server for [Crystallize](https://crystallize.com) headless commerce. Gives AI agents read access to your catalogue, products, shapes, and tenant config — with deep links back to the Crystallize UI.

Works with Claude Code, Claude Desktop, Cursor, Windsurf, and any MCP-compatible client.

## Quick Start

### Claude Code

```bash
npx crystallize-mcp --setup
```

### Claude Desktop

```bash
npx crystallize-mcp --setup --global
```

### Manual Configuration

Add to your `.mcp.json` (Claude Code) or `claude_desktop_config.json` (Claude Desktop):

```json
{
  "crystallize": {
    "command": "npx",
    "args": ["-y", "crystallize-mcp@latest"],
    "env": {
      "CRYSTALLIZE_TENANT_IDENTIFIER": "your-tenant"
    }
  }
}
```

## Tools (10)

### Catalogue (4 tools)

| Tool | Description |
|---|---|
| `browse_catalogue` | Traverse the item tree by path |
| `get_item` | Fetch an item by path or ID with full component data |
| `search_catalogue` | Keyword search across all items |
| `get_product_variants` | List variants with pricing and stock |

### Discovery (3 tools)

| Tool | Description |
|---|---|
| `list_discovery_shapes` | List all shapes with their queryable fields |
| `browse_shape` | Browse items of a shape with filters, pagination, and field selection |
| `get_shape_fields` | Detailed field info for a specific shape |

### Shapes & Tenant (3 tools, requires auth)

| Tool | Description |
|---|---|
| `list_shapes` | All shapes with component summaries |
| `get_shape` | Full component definition for a shape |
| `get_tenant_info` | Tenant configuration and available languages |

## Authentication

Public tools (Catalogue + Discovery) work without auth — just set your tenant ID.

For PIM tools (shapes, tenant info), create an access token at:
`https://app.crystallize.com/{tenant}/en/settings/access-tokens`

> **Note:** Crystallize tokens inherit permissions from the user who created them. To create a restricted token, generate it under a user with a read-only role. See [Crystallize Roles](https://crystallize.com/docs/configuration/roles).

```json
{
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
```

### Access Mode

`CRYSTALLIZE_ACCESS_MODE` controls which tools the MCP server registers at startup:

- **`read`** (default) — only read tools are available
- **`write`** — includes tools that can create/update content
- **`admin`** — full access including webhooks and tenant config

This is the MCP-side guardrail. Since Crystallize tokens don't have their own permission scopes, this setting is what prevents AI agents from seeing write tools they shouldn't use.

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `CRYSTALLIZE_TENANT_IDENTIFIER` | Yes | Your tenant identifier from `app.crystallize.com/{tenant}` |
| `CRYSTALLIZE_ACCESS_TOKEN_ID` | No | Access token ID for PIM API |
| `CRYSTALLIZE_ACCESS_TOKEN_SECRET` | No | Access token secret (paired with token ID) |
| `CRYSTALLIZE_STATIC_AUTH_TOKEN` | No | Static auth token (alternative to ID/secret pair) |
| `CRYSTALLIZE_ACCESS_MODE` | No | `read` (default), `write`, or `admin` — controls which tools are registered |

## Deep Links

Every response includes clickable links to the Crystallize UI:

- Items → `app.crystallize.com/{tenant}/en/catalogue/{itemId}`
- Shapes → `app.crystallize.com/{tenant}/en/shapes/{identifier}`

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
