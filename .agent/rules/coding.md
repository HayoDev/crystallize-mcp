---
trigger: always_on
---

# Instructions

- Use only scripts from `package.json` to run commands.
- Use `npm run build` to run tsc and test build.
- Use `npm test` to build and run tests, run all tests to verify correctness.
- Use `npm run format` to fix formatting and get linting errors.
- Use `npm run check-format` to check formatting without fixing.
- Use `npm run typecheck` for type checking without emitting.

## Rules for TypeScript

- Do not use `any` type.
- Do not use `as` keyword for type casting.
- Do not use `!` operator for type assertion.
- Do not use `// @ts-ignore` comments.
- Do not use `// @ts-nocheck` comments.
- Do not use `// @ts-expect-error` comments.
- Prefer `for..of` instead of `forEach`.
- Use consistent type imports (`import type {Foo}`).
- No floating promises — always `await` or explicitly handle.
- Prefix unused variables/args with `_` (e.g. `_params`).
- Use `curly` braces for multi-line blocks (single-line `if` without braces is OK).

## Formatting (oxfmt)

- No bracket spacing: `{foo}` not `{ foo }`.
- Single quotes, not double quotes.
- Trailing commas everywhere (ES5+).
- Arrow parens: avoid when possible (`x => x`, not `(x) => x`).
- One attribute per line in JSX/HTML-like contexts.
- Print width: 80 characters.
- Line endings: LF only.

## Architecture

- Tool handlers go in `src/tools/` (one file per category).
- Each tool file exports a function that takes `CrystallizeClient` and returns `ToolDefinition[]`.
- New tool groups are registered in `src/index.ts` (one import + spread into `allTools`).
- Tools declare `mode: 'read' | 'write' | 'admin'` for permission scoping.
- `CrystallizeClient` handles API access and deep link generation — tools should not build URLs directly.
- Tests go in `tests/` mirroring the `src/` directory structure.

## Crystallize API Usage

- **Discovery API** (`client.api.discoveryApi`) — preferred for shape-specific queries via `browse { shapeName(...) { hits { ... } } }`. Introspect with `__type` to discover shapes and fields dynamically.
- **Search API** (direct fetch to `/search` endpoint) — for cross-shape keyword search. More resilient than Discovery search for tenants with orphaned shapes.
- **Catalogue API** (`client.api.catalogueApi`) — for path-based item fetching with `catalogue(path:, language:)`. Returns component data.
- **PIM API** (`client.api.pimApi`) — for shapes, tenant info, write operations. Requires auth tokens.
- Every tool response that references an item, shape, or order must include a deep link to the Crystallize UI using `client.itemLink()`, `client.shapeLink()`, or `client.orderLink()`.
- GraphQL queries are tenant-specific (shapes have custom names). Never hardcode shape names — always introspect or accept them as parameters.

## Security

- Never commit `.env` files, auth tokens, or tenant credentials.
- Write/admin tools must check `mode` before registering — read-only by default.
- Mutation tools should return what changed (audit trail).
