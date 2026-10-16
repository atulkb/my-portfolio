# `.claude/` — reusable Claude Code setup

This folder is meant to be copied into new projects. Everything is **generic** except `rules/project/`.

```
.claude/
├── settings.json          # generic: hooks + deny-reading of secret files
├── scripts/               # generic: hook implementations (Python 3, stdlib only)
│   ├── check_dangerous_commands.py   # PreToolUse(Bash|PowerShell): blocks destructive commands
│   ├── scan_secrets.py               # PreToolUse(Edit|Write): blocks writes containing credentials
│   └── format_and_lint.py            # PostToolUse(Edit|Write): prettier/eslint/black/flake8 if installed
├── agents/                # generic: hld-architect → lld-designer → code-implementer
│                          #   (they read doc paths + commands from the project's CLAUDE.md)
└── rules/
    ├── generic/           # generic: always loaded (workflow, security baseline)
    ├── stacks/            # generic per stack: loaded only when matching files are touched (`paths:`)
    │   ├── typescript/
    │   └── python/
    └── project/           # PROJECT-SPECIFIC — delete/replace in a new project
```

## Reusing in a new project

1. Copy `.claude/` into the new repo.
2. Delete `rules/project/*` and write new project rules.
3. Delete any `rules/stacks/<stack>` you don't need (harmless to keep — they're path-scoped).
4. Write the new project's `CLAUDE.md` with these sections, which the agents rely on:
   **Project Context**, **Tech Stack**, **Docs** (HLD/LLD paths), **Project Structure**, **Essential Commands**.

## Requirements

- Python 3 on PATH (`python3` or `python`) for the hooks.
- Hooks use `$CLAUDE_PROJECT_DIR`, so they work from any working directory.
- Personal, non-shared overrides go in `.claude/settings.local.json` (git-ignored).
