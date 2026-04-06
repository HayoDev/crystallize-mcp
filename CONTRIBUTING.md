# Contributing to Crystallize MCP

Thank you for your interest in contributing! This project provides AI agents with access to the Crystallize headless commerce platform via the Model Context Protocol.

## Getting Started

1. Fork and clone the repository
2. Install dependencies: `npm install`
3. Build: `npm run build`
4. Run: `npm start`

## Prerequisites

- Node.js 18+ (see `.nvmrc`)
- A Crystallize tenant (free tier works for development)
- Access tokens for PIM tools (optional — catalogue and Discovery tools work without auth)

## Development Workflow

```bash
# Build the project
npm run build

# Run type checking
npm run typecheck

# Lint and format
npm run format

# Check formatting without fixing
npm run check-format

# Run tests
npm test

# Run tests without rebuild
npm run test:no-build
```

## Commit Messages

This project follows [Conventional Commits](https://www.conventionalcommits.org/). Release-please uses these to auto-generate changelogs and determine version bumps.

- `feat: add new tool` — A new feature (bumps minor)
- `fix: handle edge case` — A bug fix (bumps patch)
- `docs: update README` — Documentation only
- `refactor: simplify client` — Code restructuring
- `test: add order tests` — Adding tests
- `chore: update deps` — Maintenance (hidden from changelog)

## Adding a New Tool

1. Create or update the tool handler in `src/tools/`
2. Each tool file exports a function that takes `CrystallizeClient` and returns `ToolDefinition[]`
3. Register the tool group in `src/index.ts` (one import + spread into `allTools`)
4. Set the `mode` field: `'read'`, `'write'`, or `'admin'`
5. Include deep links in responses using `client.itemLink()`, `client.shapeLink()`, or `client.orderLink()`
6. Add tests in `tests/`
7. Update the README tool list

## Architecture

```
src/
  bin/                  CLI entry point and setup wizard
  tools/                Tool handlers (one file per category)
  client.ts             Crystallize API client and deep link generation
  credentials.ts        Keychain credential storage
  errors.ts             Categorized error handling
  pii.ts                PII masking for customer/order data
  audit.ts              Audit logging
  index.ts              MCP server factory and tool registration
  types.ts              Shared type definitions
```

## Code Style

- TypeScript strict mode — no `any`, no `as` casts, no `!` assertions
- Oxlint + Oxfmt enforced (run `npm run format`)
- Single quotes, trailing commas, 80-character print width
- Use consistent type imports (`import type {Foo}`)
- Prefix unused variables with `_`
- No floating promises — always `await` or explicitly handle

## Reporting Issues

- Check existing issues before opening a new one
- Include Node.js version and Crystallize tenant type (if relevant)
- For bugs, include steps to reproduce and error output
- Never include access tokens or customer data in issue reports

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
