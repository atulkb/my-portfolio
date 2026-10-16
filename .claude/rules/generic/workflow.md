---
description: Stack-agnostic engineering workflow. Reusable across projects — do not put project details here.
---

# Engineering Workflow

## Design-first flow

- Work flows **HLD → LLD → code**. Doc locations are listed in the project's `CLAUDE.md` ("Docs" section).
- Do not implement features that are not covered by an approved LLD section. If the LLD is missing or contradicts the HLD, stop and ask.
- When requirements are ambiguous or two sources disagree (docs vs code vs `CLAUDE.md`), ask instead of guessing. State assumptions explicitly when you must proceed.
- Record significant decisions (with the rejected alternatives and why) in the HLD's decision log.

## Scope discipline

- Respect the release scope defined in the HLD (e.g. "v1" vs "later"). Don't build deferred features early; leave a clear seam instead.
- Prefer the simplest design that satisfies the stated NFRs.

## Code hygiene

- Keep pure domain logic free of framework/UI/network imports so it is unit-testable and reusable.
- Wrap every external system (APIs, databases, LLMs) behind an interface/service layer — no raw SDK calls from UI code.
- Any iterative or agentic LLM loop must have a hard `maxIterations` cap and a token/cost budget.
- Run the project's format, lint, type-check and test commands (from `CLAUDE.md`) before declaring work done, and report failures honestly.

## Git

- Small, focused commits using Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`).
- Never commit secrets, `.env` files, keystores, or generated build output.
