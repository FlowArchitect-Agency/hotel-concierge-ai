"""Remove literal provider API keys from local workflow exports and diagnostic text.

It intentionally does not touch .env, Airtable credentials, or the running n8n
database. Rotate the provider key before deploying the hardened workflow.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KEY_RE = re.compile(r"gsk_[A-Za-z0-9_-]{20,}")
# Covers JSON parameters, Code-node snippets, and query strings while leaving
# n8n's $env expressions untouched.  Historic exports must never retain a
# usable provider credential after the workflow has been hardened.
LITERAL_PROVIDER_VALUE_RE = re.compile(
    r"(?i)(?P<prefix>(?:scrapingbee_)?api[_-]?key\s*(?:[\"']?\s*:\s*[\"']?|=))[A-Za-z0-9_-]{20,}"
)
SUFFIXES = {".json", ".txt", ".py", ".js"}
SKIP_PARTS = {"node_modules", "__pycache__"}


def candidate_files() -> list[Path]:
    return [
        path
        for path in ROOT.rglob("*")
        if path.is_file() and path.suffix.lower() in SUFFIXES and not (set(path.parts) & SKIP_PARTS)
    ]


def redact(apply: bool) -> list[Path]:
    changed = []
    for path in candidate_files():
        try:
            text = path.read_text(encoding="utf-8-sig")
        except UnicodeDecodeError:
            continue
        cleaned = KEY_RE.sub("<redacted-groq-key>", text)
        cleaned = LITERAL_PROVIDER_VALUE_RE.sub(r"\g<prefix><redacted-provider-key>", cleaned)
        if cleaned == text:
            continue
        changed.append(path)
        if apply:
            path.write_text(cleaned, encoding="utf-8", newline="")
    return changed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the redactions")
    args = parser.parse_args(argv)
    changed = redact(args.apply)
    action = "Redacted" if args.apply else "Would redact"
    print(f"{action} {len(changed)} file(s):")
    for path in changed:
        print(path.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
