"""Compatibility entry point for the retired Groq-node patch script.

Use the canonical hardening command instead; it never stores a provider key in
workflow JSON and also installs the read-only regression safeguards.
"""

from .workflow_hardening import main


if __name__ == "__main__":
    raise SystemExit(main())
