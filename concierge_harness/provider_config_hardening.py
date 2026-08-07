"""Move ScrapingBee credentials out of legacy workflow exports into .env."""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = (
    ROOT / "conciergeflow-scraper-scheduled.workflow.json",
    ROOT / "conciergeflow_workflow worked 99999999.json",
    ROOT / "workflow-check.json",
)
ENV_EXPRESSION = "={{ $env.SCRAPINGBEE_API_KEY }}"
LOW_COST_PARAMETERS = {"render_js": "false", "premium_proxy": "false"}


def _write_json(path: Path, value: object) -> None:
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=path.parent) as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        temporary = handle.name
    os.replace(temporary, path)


def harden_workflow(path: Path) -> int:
    with path.open(encoding="utf-8-sig") as handle:
        document = json.load(handle)
    workflows = document if isinstance(document, list) else [document]
    replacements = 0
    for workflow in workflows:
        if not isinstance(workflow, dict):
            continue
        for node in workflow.get("nodes", []):
            params = node.get("parameters", {})
            query_parameters = params.get("queryParameters", {}).get("parameters", [])
            for parameter in query_parameters:
                parameter_name = str(parameter.get("name", "")).strip().lower()
                if parameter_name == "api_key" and parameter.get("value") != ENV_EXPRESSION:
                    parameter["value"] = ENV_EXPRESSION
                    replacements += 1
                if parameter_name in LOW_COST_PARAMETERS and parameter.get("value") != LOW_COST_PARAMETERS[parameter_name]:
                    parameter["value"] = LOW_COST_PARAMETERS[parameter_name]
                    replacements += 1

            # A legacy Code node duplicated the HTTP request configuration and
            # contained an old literal key.  Keep its behaviour aligned with
            # the actual HTTP node and resolve the key only at execution time.
            code = params.get("jsCode")
            if isinstance(code, str) and "ScrapingBee" in code:
                updated_code = re.sub(
                    r"(?m)^(\s*api_key:\s*)'[^']+'",
                    r"\1$env.SCRAPINGBEE_API_KEY",
                    code,
                )
                updated_code = updated_code.replace("render_js:         'true'", "render_js:         'false'")
                updated_code = updated_code.replace("premium_proxy:     'true'", "premium_proxy:     'false'")
                updated_code = updated_code.replace(
                    "We ask for `premium_proxy=true` + `render_js=true` so Google serves real results.",
                    "Use the low-cost mode first; an escalation path can be added only for blocked searches.",
                )
                if updated_code != code:
                    params["jsCode"] = updated_code
                    replacements += 1
    if replacements:
        _write_json(path, document)
    return replacements


def sanitize_legacy_env() -> int:
    """Remove malformed legacy ScrapingBee assignments while preserving comments and the valid slot."""
    path = ROOT / ".env"
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return 0
    cleaned = []
    removed = 0
    for line in lines:
        if "=" not in line or line.lstrip().startswith("#"):
            cleaned.append(line)
            continue
        raw_name = line.split("=", 1)[0].strip()
        normalized = re.sub(r"[^A-Za-z0-9_]", "", raw_name).upper()
        if "SCRAPINGBEE" in normalized and normalized != "SCRAPINGBEE_API_KEY":
            cleaned.append("# Removed malformed legacy ScrapingBee credential assignment.")
            removed += 1
        else:
            cleaned.append(line)
    if removed:
        path.write_text("\n".join(cleaned) + "\n", encoding="utf-8")
    return removed


def main() -> int:
    total = 0
    for path in WORKFLOWS:
        if not path.exists():
            continue
        count = harden_workflow(path)
        total += count
        print(f"{path.name}: {'updated' if count else 'already safe'}")
    malformed = sanitize_legacy_env()
    print(f"ScrapingBee credential references moved to environment: {total}")
    print(f"Malformed legacy .env assignments removed: {malformed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
