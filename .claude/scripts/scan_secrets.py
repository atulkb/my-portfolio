#!/usr/bin/env python3
"""PreToolUse hook: blocks writes/edits that appear to introduce secrets or credentials.

Reads the Claude Code hook JSON payload from stdin, inspects the text being
written by the Edit or Write tool, and exits 2 (blocking) with a reason on
stderr if a known credential pattern is found. Exits 0 (allow) otherwise,
including on any parsing error or when the file lives under .claude/scripts
(so this hook does not try to scan its own pattern definitions).
"""
import json
import re
import sys

SECRET_PATTERNS = [
    (r"AKIA[0-9A-Z]{16}", "AWS access key ID"),
    (r"-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----", "private key block"),
    (r"\bsk-[A-Za-z0-9]{20,}", "OpenAI-style secret key"),
    (r"\bgh[pousr]_[A-Za-z0-9]{20,}", "GitHub token"),
    (r"\bxox[baprs]-[A-Za-z0-9-]{10,}", "Slack token"),
    (r"AIza[0-9A-Za-z\-_]{35}", "Google API key"),
    (r"(?i)\b(api[_-]?key|secret|password|passwd|token)\b\s*[:=]\s*['\"][^'\"\s]{8,}['\"]", "hardcoded credential assignment"),
    (r"(?i)mongodb(\+srv)?://[^:\s]+:[^@\s]+@", "credential embedded in a database connection string"),
    (r"(?i)postgres(ql)?://[^:\s]+:[^@\s]+@", "credential embedded in a database connection string"),
]

PLACEHOLDER_MARKERS = ("REDACTED", "EXAMPLE", "YOUR_", "<", "xxxxxxxx", "CHANGEME", "PLACEHOLDER")


def is_placeholder(snippet: str) -> bool:
    upper = snippet.upper()
    return any(marker.upper() in upper for marker in PLACEHOLDER_MARKERS)


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0

    tool_input = payload.get("tool_input") or {}
    file_path = (tool_input.get("file_path") or "").replace("\\", "/")
    if ".claude/scripts/" in file_path:
        return 0

    text = "\n".join(
        str(tool_input.get(key) or "") for key in ("content", "new_string", "old_string")
    )
    if not text.strip():
        return 0

    for pattern, reason in SECRET_PATTERNS:
        for match in re.finditer(pattern, text):
            snippet = match.group(0)
            if is_placeholder(snippet):
                continue
            sys.stderr.write(
                f"Blocked write containing a likely secret ({reason}) in {file_path or 'target file'}.\n"
                "Move it to an environment variable / .env file instead of committing it.\n"
            )
            return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())