#!/usr/bin/env python3
"""PostToolUse hook: best-effort format + lint pass on a file just written/edited.

Reads the Claude Code hook JSON payload from stdin, picks a formatter/linter
pair by the file's extension, and runs them. Generic across projects/stacks:
add an entry to TOOLS_BY_EXTENSION for any language you want covered. Never
blocks: always exits 0, and quietly no-ops for unknown extensions or when a
tool isn't installed yet (e.g. before a project's venv/deps are set up).

Executables are resolved from the nearest ``node_modules/.bin`` (walking up
from the edited file to the project root), then the active venv, then PATH,
so project-local devDependencies are preferred over global installs. Resolution
goes through ``shutil.which`` so Windows ``.cmd``/``.exe`` shims work.
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

PRETTIER = (["prettier", "--write", "{file}"], "prettier")
ESLINT = (["eslint", "--no-warn-ignored", "{file}"], "eslint")

TOOLS_BY_EXTENSION = {
    ".py": [(["black", "--quiet", "{file}"], "black"), (["flake8", "{file}"], "flake8")],
    ".js": [PRETTIER, ESLINT],
    ".jsx": [PRETTIER, ESLINT],
    ".ts": [PRETTIER, ESLINT],
    ".tsx": [PRETTIER, ESLINT],
    ".go": [(["gofmt", "-w", "{file}"], "gofmt"), (["go", "vet", "{file}"], "go vet")],
    ".rs": [(["rustfmt", "{file}"], "rustfmt")],
    ".rb": [(["rubocop", "-a", "{file}"], "rubocop")],
    ".json": [PRETTIER],
    ".md": [PRETTIER],
    ".yml": [PRETTIER],
    ".yaml": [PRETTIER],
}


def candidate_bin_dirs(file_path: Path, project_dir: Path) -> list[str]:
    """Return tool directories ordered nearest-first: node_modules/.bin up to the root, then venv."""
    dirs: list[str] = []
    current = file_path.parent
    while True:
        bin_dir = current / "node_modules" / ".bin"
        if bin_dir.is_dir():
            dirs.append(str(bin_dir))
        if current == project_dir or current.parent == current:
            break
        current = current.parent
    for venv_name in ("venv", ".venv"):
        for sub in ("Scripts", "bin"):
            venv_bin = project_dir / venv_name / sub
            if venv_bin.is_dir():
                dirs.append(str(venv_bin))
    return dirs


def resolve(executable: str, search_dirs: list[str]) -> str | None:
    """Find an executable in project-local dirs first, then PATH."""
    for directory in search_dirs:
        found = shutil.which(executable, path=directory)
        if found:
            return found
    return shutil.which(executable)


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0

    tool_input = payload.get("tool_input") or {}
    raw_path = tool_input.get("file_path") or ""
    if not raw_path:
        return 0
    file_path = Path(raw_path)
    tools = TOOLS_BY_EXTENSION.get(file_path.suffix.lower())
    if not tools or not file_path.is_file():
        return 0

    project_dir = Path(os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or os.getcwd())
    search_dirs = candidate_bin_dirs(file_path.resolve(), project_dir.resolve())

    for tool_args_template, label in tools:
        executable = resolve(tool_args_template[0], search_dirs)
        if not executable:
            continue
        tool_args = [executable] + [arg.format(file=str(file_path)) for arg in tool_args_template[1:]]
        try:
            result = subprocess.run(
                tool_args, capture_output=True, text=True, timeout=45, cwd=str(project_dir)
            )
            output = (result.stdout or result.stderr).strip()
            if result.returncode != 0 and output:
                print(f"[{label}] {output}")
        except Exception:
            pass

    return 0


if __name__ == "__main__":
    sys.exit(main())
