"""Transactional deploy/rollback helpers for the one live ConciergeFlow workflow."""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone

import requests

from .config import CANONICAL_JSON, N8N_ACTIVE_WF_ID, N8N_HEADERS, N8N_WORKFLOWS_URL, PROJECT_ROOT, WEBHOOK_URL

DEPLOY_STATE = os.path.join(PROJECT_ROOT, "concierge_harness", "last_deploy.json")
BACKUP_DIR = os.path.join(PROJECT_ROOT, "concierge_harness", "backups")
WORKFLOW_FIELDS = ("name", "nodes", "connections", "settings", "pinData", "staticData")


def _api(method: str, path_suffix: str = "", **kwargs):
    url = f"{N8N_WORKFLOWS_URL}/{N8N_ACTIVE_WF_ID}{path_suffix}"
    return requests.request(method, url, headers=N8N_HEADERS, timeout=20, **kwargs)


def _workflow_body(workflow: dict) -> dict:
    return {key: workflow[key] for key in WORKFLOW_FIELDS if key in workflow}


def _wf_hash(workflow: dict) -> str:
    relevant = {key: workflow.get(key, {}) for key in ("nodes", "connections", "settings")}
    return hashlib.sha256(json.dumps(relevant, sort_keys=True).encode()).hexdigest()


def _load_state() -> dict:
    try:
        with open(DEPLOY_STATE, encoding="utf-8") as handle:
            return json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_state(state: dict) -> None:
    temporary = DEPLOY_STATE + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(state, handle, indent=2, ensure_ascii=False)
    os.replace(temporary, DEPLOY_STATE)


def _backup(workflow: dict) -> str:
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = os.path.join(BACKUP_DIR, f"live_{stamp}.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(workflow, handle, indent=2, ensure_ascii=False)
    return path


def _has_groq_env() -> bool:
    """Confirm the n8n startup .env has a non-placeholder provider key, without reading it into output."""
    env_path = os.path.join(PROJECT_ROOT, ".env")
    try:
        with open(env_path, encoding="utf-8") as handle:
            for line in handle:
                if not line.startswith("GROQ_API_KEY="):
                    continue
                value = line.split("=", 1)[1].strip().strip('"').strip("'")
                return bool(value) and "your_" not in value.lower() and "redacted" not in value.lower()
    except OSError:
        return False
    return False


def _smoke() -> tuple[bool, float, str]:
    """A no-write post-deploy probe; detailed tests are run by the convergence daemon."""
    started = time.monotonic()
    try:
        response = requests.post(
            WEBHOOK_URL,
            json={
                "message": "Hello",
                "sessionId": f"qa_smoke_{int(started)}",
                "hotel": "Hotel Lumiere Paris",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "testMode": "read_only",
                "testRunId": f"smoke_{int(started)}",
            },
            timeout=25,
        )
        elapsed_ms = (time.monotonic() - started) * 1000
        payload = response.json() if "json" in response.headers.get("content-type", "").lower() else {}
        reply = str(payload.get("reply", ""))
        return response.status_code == 200 and bool(reply), elapsed_ms, reply[:120]
    except requests.RequestException as exc:
        return False, (time.monotonic() - started) * 1000, str(exc)[:120]


def restore_backup(backup_path: str) -> bool:
    """Restore and activate an exact workflow backup. Never creates a workflow."""
    try:
        with open(backup_path, encoding="utf-8") as handle:
            workflow = json.load(handle)
        print(f"[DEPLOY] Restoring backup: {backup_path}")
        _api("POST", "/deactivate")
        response = _api("PUT", data=json.dumps(_workflow_body(workflow)))
        if response.status_code not in (200, 201, 204):
            print(f"[DEPLOY] Restore PUT failed ({response.status_code}): {response.text[:300]}")
            return False
        activation = _api("POST", "/activate")
        if activation.status_code not in (200, 201, 204):
            print(f"[DEPLOY] Restore activation failed ({activation.status_code}): {activation.text[:300]}")
            return False
        return True
    except (OSError, ValueError, requests.RequestException) as exc:
        print(f"[DEPLOY] Restore failed: {exc}")
        return False


def rollback_latest() -> bool:
    """Rollback the most recent successful deploy and reinstate its prior state."""
    state = _load_state()
    backup_path = state.get("backup_path")
    if not backup_path:
        print("[DEPLOY] No rollback backup is recorded.")
        return False
    if not restore_backup(backup_path):
        return False
    prior = state.get("previous")
    if isinstance(prior, dict) and prior:
        _save_state(prior)
    else:
        with open(backup_path, encoding="utf-8") as handle:
            restored = json.load(handle)
        _save_state({"hash": _wf_hash(restored), "ts": time.time(), "restored_from": backup_path})
    print("[DEPLOY] Rollback successful; previous live workflow is active.")
    return True


def deploy(json_path: str | None = None, force: bool = False) -> bool:
    """Deploy one canonical export, smoke it safely, and self-restore on failure."""
    json_path = json_path or CANONICAL_JSON
    if not os.path.exists(json_path):
        print(f"[DEPLOY] Canonical file not found: {json_path}")
        return False
    try:
        with open(json_path, encoding="utf-8-sig") as handle:
            canonical = json.load(handle)
        from .workflow_hardening import validate
        validate(canonical)
        if not _has_groq_env():
            print("[DEPLOY] GROQ_API_KEY is missing from .env; refusing to deploy an unavailable concierge.")
            return False
        new_hash = _wf_hash(canonical)
        old_state = _load_state()
        if not force and old_state.get("hash") == new_hash:
            print("[DEPLOY] No canonical change since last deployment.")
            return True

        print("[DEPLOY] Fetching and backing up the live workflow...")
        live = _api("GET")
        live.raise_for_status()
        backup_path = _backup(live.json())
        print(f"  backup -> {backup_path}")

        _api("POST", "/deactivate")
        response = _api("PUT", data=json.dumps(_workflow_body(canonical)))
        if response.status_code not in (200, 201, 204):
            print(f"[DEPLOY] PUT failed ({response.status_code}): {response.text[:300]}")
            restore_backup(backup_path)
            return False
        activation = _api("POST", "/activate")
        if activation.status_code not in (200, 201, 204):
            print(f"[DEPLOY] Activation failed ({activation.status_code}): {activation.text[:300]}")
            restore_backup(backup_path)
            return False

        time.sleep(0.75)
        ok, elapsed_ms, reply = _smoke()
        if not ok:
            print(f"[DEPLOY] Smoke test failed ({elapsed_ms:.0f}ms): {reply}")
            restore_backup(backup_path)
            return False

        _save_state(
            {
                "hash": new_hash,
                "ts": time.time(),
                "backup_path": backup_path,
                "previous": old_state,
            }
        )
        print(f"[DEPLOY] Live and smoke-tested ({elapsed_ms:.0f}ms).")
        return True
    except (OSError, ValueError, requests.RequestException) as exc:
        print(f"[DEPLOY] Failed safely: {exc}")
        return False


if __name__ == "__main__":
    force = "--force" in sys.argv
    path = next((arg for arg in sys.argv[1:] if arg.endswith(".json")), None)
    raise SystemExit(0 if deploy(json_path=path, force=force) else 1)
