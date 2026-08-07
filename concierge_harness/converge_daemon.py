"""Deploy-test-rollback convergence loop for the canonical ConciergeFlow workflow."""

from __future__ import annotations

import hashlib
import json
import os
import time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(HERE)
CANONICAL = os.path.join(PROJECT_DIR, "lllll.json")
STATE_DIR = os.path.join(HERE, "state")
POLL_INTERVAL_S = 2.0
DEBOUNCE_S = 3.0
HEALTH_CHECK_INTERVAL_S = 15 * 60

os.makedirs(STATE_DIR, exist_ok=True)


def sha_of_canonical() -> str | None:
    if not os.path.exists(CANONICAL):
        return None
    with open(CANONICAL, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def deploy_and_test() -> dict:
    """Deploy a candidate, run safe end-to-end tests, and rollback on regression."""
    from .deploy import deploy, rollback_latest
    from .tests import run_diagnostic

    print(f"[{_now()}] === DEPLOY + REGRESSION ===")
    if not deploy(json_path=CANONICAL, force=True):
        return {
            "status": "deploy_failed",
            "pass_count": 0,
            "total_count": 0,
            "failures": ["Candidate deployment failed or was restored after smoke test."],
            "latency_avg_ms": 0,
        }

    result = run_diagnostic()
    if result["status"] != "pass":
        rolled_back = rollback_latest()
        result["rollback_performed"] = rolled_back
        if not rolled_back:
            result.setdefault("failures", []).append({"id": "rollback", "problems": ["Automatic rollback failed"]})
    return result


def health_test() -> dict:
    """Cheap no-write health check for the already-live workflow."""
    from .tests import run_diagnostic

    print(f"[{_now()}] === PERIODIC READ-ONLY HEALTH CHECK ===")
    return run_diagnostic(only_tags=["spa-en"], include_write_audit=False)


def write_state(result: dict, sha: str | None) -> None:
    result = dict(result)
    result["timestamp"] = datetime.now(timezone.utc).isoformat()
    result["sha"] = sha
    state_path = os.path.join(STATE_DIR, "converge_state.json")
    temporary = state_path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2, ensure_ascii=False)
    os.replace(temporary, state_path)
    with open(os.path.join(STATE_DIR, "converge_history.jsonl"), "a", encoding="utf-8") as handle:
        handle.write(json.dumps(result, ensure_ascii=False) + "\n")
    if result.get("status") != "pass":
        with open(os.path.join(STATE_DIR, "last_failure.json"), "w", encoding="utf-8") as handle:
            json.dump(result, handle, indent=2, ensure_ascii=False)


def _run_and_record(operation) -> dict:
    try:
        result = operation()
    except Exception as exc:  # The daemon must survive a bad test run.
        result = {
            "status": "test_crash",
            "pass_count": 0,
            "total_count": 0,
            "failures": [f"Harness crashed: {exc}"],
            "latency_avg_ms": 0,
        }
    write_state(result, sha_of_canonical())
    print(f"[{_now()}] Result: {result['status']} ({result['pass_count']}/{result['total_count']})")
    return result


def run_once() -> dict:
    return _run_and_record(deploy_and_test)


def daemon(minutes: float | None = None, *, skip_initial: bool = False) -> None:
    """Watch candidate changes and run periodic read-only health checks forever."""
    last_sha = sha_of_canonical()
    if last_sha is None:
        print(f"[{_now()}] ERROR: canonical workflow is missing: {CANONICAL}")
        return
    print(f"[{_now()}] Convergence daemon started for {CANONICAL}")
    if not skip_initial:
        _run_and_record(deploy_and_test)
        last_sha = sha_of_canonical()
    next_health_check = time.monotonic() + HEALTH_CHECK_INTERVAL_S
    deadline = time.monotonic() + minutes * 60 if minutes else float("inf")
    pending_change_at: float | None = None

    while time.monotonic() < deadline:
        current_sha = sha_of_canonical()
        if current_sha and current_sha != last_sha and pending_change_at is None:
            pending_change_at = time.monotonic()
        elif current_sha == last_sha:
            pending_change_at = None
        if pending_change_at and time.monotonic() - pending_change_at >= DEBOUNCE_S:
            _run_and_record(deploy_and_test)
            last_sha = sha_of_canonical()
            pending_change_at = None
            next_health_check = time.monotonic() + HEALTH_CHECK_INTERVAL_S
        elif time.monotonic() >= next_health_check:
            _run_and_record(health_test)
            next_health_check = time.monotonic() + HEALTH_CHECK_INTERVAL_S
        time.sleep(POLL_INTERVAL_S)

    print(f"[{_now()}] Convergence daemon stopped after {minutes:g} minute(s).")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--minutes", type=float)
    parser.add_argument("--skip-initial", action="store_true")
    args = parser.parse_args()
    if args.once:
        result = run_once()
        raise SystemExit(0 if result["status"] == "pass" else 1)
    daemon(args.minutes, skip_initial=args.skip_initial)
