"""ConciergeFlow harness configuration loaded from the local, ignored .env file."""

from __future__ import annotations

import os

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_project_env() -> None:
    """Load simple KEY=value entries without printing or overwriting caller-provided values."""
    path = os.path.join(PROJECT_ROOT, ".env")
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
    except OSError:
        pass


_load_project_env()

# ---- n8n ----
N8N_BASE_URL = os.getenv("N8N_BASE_URL", "http://localhost:5678")
N8N_API_KEY = os.getenv("N8N_API_KEY", "")
N8N_ACTIVE_WF_ID = os.getenv("N8N_WORKFLOW_ID", "DHxKjYJGVlsBsNCP")
# A deployed Cloudflare Worker can replace n8n without changing the regression
# suite. Keep the n8n webhook as the backwards-compatible local default.
CONCIERGE_API_URL = os.getenv("CONCIERGE_API_URL", "").strip()
WEBHOOK_URL = CONCIERGE_API_URL or f"{N8N_BASE_URL.rstrip('/')}/webhook/concierge/inbound"
N8N_HEADERS = {"X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json"}
N8N_WORKFLOWS_URL = f"{N8N_BASE_URL}/api/v1/workflows"
N8N_EXECUTIONS_URL = f"{N8N_BASE_URL}/api/v1/executions"

# ---- canonical workflow JSON ----
CANONICAL_JSON = os.path.join(PROJECT_ROOT, "lllll.json")

# ---- Airtable ----
AIRTABLE_API_KEY = os.getenv("AIRTABLE_API_KEY", "")
AIRTABLE_BASE_ID = os.getenv("AIRTABLE_BASE_ID", "appWUORad3wvaHttY")
AIRTABLE_URL = f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}"
AIRTABLE_HEADERS = {"Authorization": f"Bearer {AIRTABLE_API_KEY}"}
