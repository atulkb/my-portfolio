#!/usr/bin/env python3
"""PreToolUse hook: blocks obviously destructive shell commands before execution.

Reads the Claude Code hook JSON payload from stdin, inspects tool_input.command
(for the Bash tool), and exits 2 (blocking) with a reason on stderr if the
command matches a known-catastrophic pattern. Exits 0 (allow) otherwise,
including on any parsing error, so this hook fails open rather than jamming
the session.
"""
import json
import re
import sys

DANGEROUS_PATTERNS = [
    (r"rm\s+-[a-z]*r[a-z]*f[a-z]*\s+(/|~|\$HOME)(\s|$)", "recursive force-delete of a root/home path"),
    (r"rm\s+-[a-z]*f[a-z]*r[a-z]*\s+(/|~|\$HOME)(\s|$)", "recursive force-delete of a root/home path"),
    (r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;", "fork bomb"),
    (r"\bmkfs(\.\w+)?\s+", "filesystem format command"),
    (r"\bdd\s+.*of=/dev/(sd|nvme|hd|disk)", "raw disk write via dd"),
    (r">\s*/dev/(sd|nvme|hd|disk)\w*", "raw disk overwrite"),
    (r"\bgit\s+push\s+.*--force(?!-with-lease)", "force push (can overwrite remote history)"),
    (r"\bgit\s+push\s+.*\s-f(\s|$)", "force push (can overwrite remote history)"),
    (r"\bgit\s+reset\s+--hard\b", "hard reset (discards uncommitted work)"),
    (r"\bgit\s+clean\s+.*-[a-z]*d[a-z]*f[a-z]*", "recursive clean (deletes untracked files)"),
    (r"\bchmod\s+-R\s+777\s+/", "world-writable recursive chmod on root"),
    (r"\bDROP\s+(DATABASE|TABLE)\b", "destructive SQL DDL"),
    (r"curl[^|]*\|\s*(sudo\s+)?(bash|sh)\b", "piping a remote script directly into a shell"),
    (r"wget[^|]*\|\s*(sudo\s+)?(bash|sh)\b", "piping a remote script directly into a shell"),
    # Windows / PowerShell equivalents (tool_input.command is the same field for the PowerShell tool).
    (
        r"\bRemove-Item\b(?=.*-Recurse)(?=.*-Force).*\s['\"]?([A-Za-z]:\\?['\"]?(\s|$)|~|\$HOME|\$env:USERPROFILE)",
        "recursive force-delete of a drive root/home path",
    ),
    (r"\b(rd|rmdir)\s+/s\s+/q\s+[A-Za-z]:\\?(\s|$)", "recursive delete of a drive root"),
    (r"\b(Format-Volume|Clear-Disk|Initialize-Disk)\b", "disk format/wipe cmdlet"),
    (r"\bformat\s+[A-Za-z]:", "drive format command"),
    (r"(iwr|irm|Invoke-WebRequest|Invoke-RestMethod)[^|]*\|\s*(iex|Invoke-Expression)\b", "piping a remote script into Invoke-Expression"),
    (r"\bfirebase\s+(firestore:delete\s+.*--all-collections|projects:delete)\b", "destructive Firebase project operation"),
]


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0

    tool_input = payload.get("tool_input") or {}
    command = tool_input.get("command") or ""
    if not command:
        return 0

    for pattern, reason in DANGEROUS_PATTERNS:
        if re.search(pattern, command, re.IGNORECASE):
            sys.stderr.write(
                f"Blocked potentially destructive command ({reason}): {command}\n"
                "If this is intentional, ask the user to run it manually or confirm explicitly.\n"
            )
            return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())