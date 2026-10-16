---
description: Stack-agnostic security baseline. Reusable across projects.
---

# Security Baseline

## Secrets

- Never hardcode API keys, tokens, passwords or private keys. Load them from environment/config files that are git-ignored; commit only a `.env.example` with placeholder values.
- Never print secrets in logs, error messages, test snapshots or analytics events.
- Treat anything bundled into a client app (mobile/web) as public. Real secrets belong on a server or behind a managed proxy (e.g. Firebase AI Logic + App Check), never in the client bundle.

## Untrusted input

- Treat all user input, file uploads (CSV, JSON), third-party API responses and **LLM output** as untrusted. Validate with a schema at every boundary before use.
- Never execute LLM output as code (`eval`, `new Function`, `exec`, shell). LLMs may only produce declarative data that is validated against a schema/whitelist.
- Guard against prompt injection: keep user text in clearly delimited data fields of a prompt, never concatenate it into instructions.

## Data access

- Enforce authorization server-side (database security rules / backend checks), not only in the UI.
- Apply least privilege to service accounts, API keys and database rules.

## Dependencies

- Pin dependency versions via the lockfile and commit it. Audit regularly with the stack's tool (e.g. `npm audit`, `pip-audit`).
