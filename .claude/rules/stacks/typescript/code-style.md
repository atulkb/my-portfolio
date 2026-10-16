---
description: TypeScript code style. Reusable stack rule for any TS/JS project.
paths: ['**/*.ts', '**/*.tsx']
---

# TypeScript Code Style

- `strict: true` (plus `noUncheckedIndexedAccess`) — no `any`; use `unknown` and narrow. No non-null `!` assertions without a comment explaining why it is safe.
- Explicit return types on exported functions. Prefer `type` aliases and discriminated unions over class hierarchies; use `readonly` for data that must not mutate.
- Validate external data (API responses, files, storage, LLM output) with `zod` schemas and derive the TS type with `z.infer` — one source of truth per shape.
- Model failures explicitly: return `Result`-style unions or throw typed errors; never swallow errors silently.
- Naming: `camelCase` variables/functions, `PascalCase` types/components, `UPPER_SNAKE_CASE` constants, `kebab-case` or `camelCase` file names consistently within a package.
- Named exports only (no default exports), except where a framework requires defaults (e.g. Expo Router route files).
- Async: always `await` or explicitly return promises; no floating promises. Use `AbortController` timeouts on network calls.
- TSDoc (`/** ... */`) on every exported function, type and component, describing params, return value and thrown errors.
- Formatting by Prettier, linting by ESLint — don't hand-format against them.
