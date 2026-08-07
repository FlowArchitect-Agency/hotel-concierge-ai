"""Safe end-to-end regressions for the ConciergeFlow n8n workflow.

The multilingual suite uses ``testMode=read_only``. A single marked write-audit
then verifies the Airtable lead schema and removes only its own synthetic rows.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import unicodedata
import uuid
from datetime import datetime, timezone

import requests

from .config import AIRTABLE_HEADERS, AIRTABLE_URL, PROJECT_ROOT, WEBHOOK_URL

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


MAX_LATENCY_MS = 12_000
# The free real-time model has a 6K TPM allowance.  Spacing tests prevents the
# harness itself from manufacturing 429 failures that guests would not cause.
INTER_CASE_DELAY_S = 22.0
ERROR_FALLBACK = re.compile(
    r"(?:brief technical issue|temporarily unavailable|please try again|could you rephrase)",
    re.IGNORECASE,
)
PRICE_PAT = re.compile(r"(?:€|euros?|eur)\b", re.IGNORECASE)

# id, label, expected language field, message
CASES = [
    ("spa-fr", "Spa price in French", "fr", "Quel est le prix d'un massage en couple demain matin ?"),
    ("spa-en", "Spa lead in English", "en", "Please arrange a spa session for two tomorrow at 9am."),
    ("din-ja", "Dinner in Japanese", "ja", "二人で明日の夜7時にディナーを予約したいです。"),
    ("transfer-es", "Airport transfer in Spanish", "es", "Necesito un transfer al aeropuerto CDG para pasado mañana."),
    ("greet-en", "Small talk in English", "en", "Hello!"),
    ("greet-de", "Small talk in German", "de", "Hallo, wie geht es Ihnen?"),
    ("mas-zh", "Massage in Chinese", "zh", "你好，我想预约一个按摩。"),
    ("resto-it", "Dinner in Italian", "it", "Avete disponibilità per cena stasera?"),
    ("ar", "Spa request in Arabic", "ar", "مرحباً، أريد حجز مساج غداً صباحاً."),
    (
        "live-irish",
        "Out-of-catalog local search",
        "en",
        "Are there any Irish pubs near the hotel with live music tonight?",
    ),
]

# This is the exact regression reported from the live widget.  Every turn is
# checked because a concierge must retain the latest stated requirement rather
# than falling back to a broad restaurant recommendation.
INDIAN_CUISINE_SEQUENCE = (
    "indian-cuisine",
    "Indian cuisine stays a hard constraint across follow-ups",
    "en",
    (
        "okay what about indian restaurant ?",
        "but is it indian ?",
        "no im looking for an indian restaurant",
    ),
)
NON_INDIAN_PARTNER_NAMES = ("Le Jardin", "Terrasse Lumiere")


def _strip_accents(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").lower()


def _reply_looks_like_language(reply: str, language: str) -> bool:
    """Cheap deterministic guard against an English provider-error response."""
    text = reply.lower()
    patterns = {
        "en": r"\b(the|and|for|you|your|we|can|please|allow)\b",
        "fr": r"\b(le|la|les|vous|pour|demain|je|nous|avec)\b|[àâçéèêëîïôûùüÿœ]",
        "es": r"\b(el|la|para|mañana|puedo|podemos|por supuesto|transfer)\b|[áéíóúñü]",
        "de": r"\b(ich|sie|und|wie|kann|guten|ihnen|heute)\b|[äöüß]",
        "it": r"\b(per|posso|abbiamo|sera|disponibilità|cena|le|la)\b|[àèéìòù]",
        "ja": r"[\u3040-\u30ff]",
        "zh": r"[\u4e00-\u9fff]",
        "ar": r"[\u0600-\u06ff]",
    }
    pattern = patterns.get(language)
    return bool(pattern and re.search(pattern, text, re.IGNORECASE))


def call_webhook(session_id: str, message: str, *, test_mode: str, run_id: str) -> dict:
    """Call the webhook and return a normalized response without raising."""
    started = time.monotonic()
    try:
        response = requests.post(
            WEBHOOK_URL,
            json={
                "message": message,
                "sessionId": session_id,
                "hotel": "Hotel Lumiere Paris",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "testMode": test_mode,
                "testRunId": run_id,
            },
            timeout=35,
        )
        elapsed_ms = round((time.monotonic() - started) * 1000)
        content_type = response.headers.get("content-type", "").lower()
        try:
            body = response.json() if "json" in content_type else {"reply": response.text}
        except ValueError:
            body = {"reply": response.text}
        return {
            "ok": response.ok,
            "status": response.status_code,
            "ms": elapsed_ms,
            "reply": str(body.get("reply", "") or ""),
            "language": str(body.get("language", "") or "").lower(),
            "intent": str(body.get("intent", "") or ""),
            "external_option_names": [str(name) for name in body.get("external_option_names", []) if str(name).strip()],
            "provider_failure": str(body.get("provider_failure", "") or ""),
            "error": "",
        }
    except requests.RequestException as exc:
        return {
            "ok": False,
            "status": 0,
            "ms": round((time.monotonic() - started) * 1000),
            "reply": "",
            "language": "",
            "intent": "",
            "external_option_names": [],
            "provider_failure": "",
            "error": str(exc),
        }


def _airtable_records(table: str, user_id: str) -> list[dict]:
    if not AIRTABLE_HEADERS.get("Authorization"):
        raise RuntimeError("AIRTABLE_API_KEY is not configured for the test harness")
    response = requests.get(
        f"{AIRTABLE_URL}/{table}",
        headers=AIRTABLE_HEADERS,
        params={"filterByFormula": "{UserID}='" + user_id + "'", "pageSize": 100},
        timeout=15,
    )
    response.raise_for_status()
    return response.json().get("records", [])


def _delete_records(table: str, records: list[dict]) -> list[str]:
    failures = []
    for record in records:
        record_id = record.get("id")
        if not record_id:
            continue
        try:
            response = requests.delete(
                f"{AIRTABLE_URL}/{table}/{record_id}", headers=AIRTABLE_HEADERS, timeout=15
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            failures.append(f"{table}/{record_id}: {exc}")
    return failures


def fetch_airtable_services() -> list[dict]:
    """Return catalog ground truth used to detect ungrounded spa answers."""
    try:
        response = requests.get(f"{AIRTABLE_URL}/Services", headers=AIRTABLE_HEADERS, timeout=15)
        response.raise_for_status()
    except requests.RequestException as exc:
        print(f"[WARN] Could not fetch Airtable services: {exc}")
        return []
    return [
        {
            "name": fields.get("Name", "") or "",
            "price": fields.get("PriceEUR", "") or "",
            "category": fields.get("Category", "") or "",
            "desc": fields.get("Description", "") or "",
        }
        for record in response.json().get("records", [])
        for fields in [record.get("fields", {})]
        if fields.get("Name")
    ]


def evaluate_case(case: tuple, result: dict, services: list[dict]) -> list[str]:
    case_id, _, expected_language, _ = case
    reply = result["reply"]
    problems = []
    if not result["ok"]:
        problems.append(result["error"] or f"webhook returned HTTP {result['status']}")
    if result.get("provider_failure"):
        problems.append(f"LLM provider failed: {result['provider_failure']}")
    if len(reply.strip()) < 10:
        problems.append("reply is missing or too short")
    if ERROR_FALLBACK.search(reply):
        problems.append("provider fallback reply returned")
    if result["language"] != expected_language:
        problems.append(f"language field is {result['language']!r}, expected {expected_language!r}")
    if reply and not _reply_looks_like_language(reply, expected_language):
        problems.append(f"reply does not appear to be {expected_language}")
    if result["ms"] >= MAX_LATENCY_MS:
        problems.append(f"latency {result['ms']}ms exceeds {MAX_LATENCY_MS}ms")
    if case_id.startswith("greet-") and re.search(r"external options|partner (?:option|service)|restaurant", reply, re.IGNORECASE):
        problems.append("simple greeting invented a service recommendation")
    if case_id in {"spa-fr", "spa-en"} and services:
        reply_normalized = _strip_accents(reply)
        named_partner = any(
            _strip_accents(service["name"]) in reply_normalized
            or any(
                len(piece) >= 6 and piece in reply_normalized
                for piece in _strip_accents(service["name"]).replace("-", " ").split()
            )
            for service in services
        )
        if not named_partner and not PRICE_PAT.search(reply):
            problems.append("spa reply is not grounded in a current catalog partner or price")
    if case_id == "live-irish":
        names = result.get("external_option_names", [])
        if not names:
            problems.append("external search returned no verifiable options")
        elif not any(_strip_accents(name) in _strip_accents(reply) for name in names):
            problems.append("out-of-catalog reply did not ground itself in an external search result")
    return problems


def _run_indian_cuisine_sequence(run_id: str, services: list[dict]) -> tuple[dict, str]:
    """Exercise the reported three-message restaurant failure in one session."""
    case_id, label, language, turns = INDIAN_CUISINE_SEQUENCE
    session_id = f"qa_{run_id}_{case_id}"
    details: list[str] = []
    problems: list[str] = []
    total_ms = 0
    intent = ""
    for index, message in enumerate(turns):
        if index:
            time.sleep(INTER_CASE_DELAY_S)
        result = call_webhook(session_id, message, test_mode="read_only", run_id=run_id)
        total_ms += result["ms"]
        intent = result["intent"] or intent
        turn_problems = evaluate_case((case_id, label, language, message), result, services)
        reply_normalized = _strip_accents(result["reply"])
        forbidden = [name for name in NON_INDIAN_PARTNER_NAMES if _strip_accents(name) in reply_normalized]
        if forbidden:
            turn_problems.append("non-Indian partner offered for Indian cuisine: " + ", ".join(forbidden))
        names = result.get("external_option_names", [])
        if not names:
            if not re.search(r"do not have|will research|couldn't find|cannot recommend|team will research", result["reply"], re.IGNORECASE):
                turn_problems.append("no vetted Indian restaurant was returned, but the reply did not safely defer research")
        elif not any(_strip_accents(name) in reply_normalized for name in names):
            turn_problems.append("Indian restaurant reply did not name a returned external option")
        if turn_problems:
            problems.extend(f"turn {index + 1}: {problem}" for problem in turn_problems)
        details.append(result["reply"][:180])
    return (
        {
            "id": case_id,
            "label": label,
            "ok": not problems,
            "ms": total_ms,
            "language": language,
            "intent": intent,
            "reply": " | ".join(details),
            "problems": problems,
        },
        session_id,
    )


def _verify_read_only(session_ids: list[str]) -> list[str]:
    """Verify that broad regression traffic did not create Airtable rows."""
    time.sleep(1.0)  # allow any async Airtable branches a chance to run
    problems = []
    for session_id in session_ids:
        user_id = f"web:{session_id}"
        for table in ("Conversations", "Requests"):
            try:
                records = _airtable_records(table, user_id)
            except (requests.RequestException, RuntimeError) as exc:
                problems.append(f"could not verify read-only isolation in {table}: {exc}")
                continue
            if records:
                problems.append(f"read-only test created {len(records)} {table} record(s) for {user_id}")
    return problems


def _write_audit(run_id: str) -> dict:
    """Write one synthetic spa lead, validate its schema, then remove it."""
    session_id = f"qa_{run_id}_write"
    user_id = f"web:{session_id}"
    result = call_webhook(
        session_id,
        "Please arrange the couples massage tomorrow at 9am for our guest. The morning team must confirm it.",
        test_mode="write_verified",
        run_id=run_id,
    )
    problems = evaluate_case(("spa-en", "Airtable write audit", "en", ""), result, fetch_airtable_services())
    conversations: list[dict] = []
    requests_rows: list[dict] = []
    try:
        for _ in range(6):
            conversations = _airtable_records("Conversations", user_id)
            requests_rows = _airtable_records("Requests", user_id)
            if len(conversations) >= 2 and requests_rows:
                break
            time.sleep(1.0)
        roles = {record.get("fields", {}).get("Role") for record in conversations}
        if not {"user", "assistant"}.issubset(roles):
            problems.append("Airtable Conversations is missing the user or assistant audit record")
        if not requests_rows:
            problems.append("Airtable Requests is missing the expected spa lead")
        else:
            fields = requests_rows[0].get("fields", {})
            expected = {"UserID": user_id, "Channel": "web", "ServiceType": "spa", "Status": "new"}
            for field, value in expected.items():
                if fields.get(field) != value:
                    problems.append(f"Airtable Requests.{field} is {fields.get(field)!r}, expected {value!r}")
            if not str(fields.get("RequestSummary", "")).strip():
                problems.append("Airtable Requests.RequestSummary is blank")
    except (requests.RequestException, RuntimeError) as exc:
        problems.append(f"Airtable write audit failed: {exc}")
    finally:
        cleanup_failures = _delete_records("Conversations", conversations) + _delete_records("Requests", requests_rows)
        problems.extend("could not remove audit data: " + failure for failure in cleanup_failures)
    return {
        "id": "airtable-write-audit",
        "label": "Airtable lead write and cleanup",
        "ok": not problems,
        "ms": result["ms"],
        "language": result["language"],
        "intent": result["intent"],
        "reply": result["reply"][:300],
        "problems": problems,
    }


def _write_report(details: list[dict], run_id: str) -> str:
    report_dir = os.path.join(PROJECT_ROOT, "concierge_harness", "reports")
    os.makedirs(report_dir, exist_ok=True)
    report_path = os.path.join(report_dir, f"report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
    with open(report_path, "w", encoding="utf-8") as handle:
        json.dump({"run_id": run_id, "results": details}, handle, indent=2, ensure_ascii=False)
    return report_path


def run_diagnostic(only_tags: list[str] | None = None, *, include_write_audit: bool = True) -> dict:
    """Run and return a structured result for the CLI and convergence daemon."""
    run_id = uuid.uuid4().hex[:16]
    services = fetch_airtable_services()
    selected = [case for case in CASES if not only_tags or case[0] in only_tags]
    details: list[dict] = []
    session_ids: list[str] = []
    print(f"Regression run {run_id}: {len(selected)} read-only cases; catalog services={len(services)}")

    for index, case in enumerate(selected):
        if index:
            time.sleep(INTER_CASE_DELAY_S)
        case_id, label, _, prompt = case
        session_id = f"qa_{run_id}_{case_id}"
        session_ids.append(session_id)
        result = call_webhook(session_id, prompt, test_mode="read_only", run_id=run_id)
        problems = evaluate_case(case, result, services)
        details.append(
            {
                "id": case_id,
                "label": label,
                "ok": not problems,
                "ms": result["ms"],
                "language": result["language"],
                "intent": result["intent"],
                "reply": result["reply"][:300],
                "problems": problems,
            }
        )
        print(f"  [{'PASS' if not problems else 'FAIL'}] {case_id}: {result['ms']}ms lang={result['language']}")
        for problem in problems:
            print(f"    - {problem}")

    if not only_tags or INDIAN_CUISINE_SEQUENCE[0] in only_tags:
        cuisine_result, cuisine_session = _run_indian_cuisine_sequence(run_id, services)
        session_ids.append(cuisine_session)
        details.append(cuisine_result)
        print(
            f"  [{'PASS' if cuisine_result['ok'] else 'FAIL'}] {cuisine_result['id']}: "
            f"{cuisine_result['ms']}ms lang={cuisine_result['language']}"
        )
        for problem in cuisine_result["problems"]:
            print(f"    - {problem}")

    isolation = _verify_read_only(session_ids)
    details.append(
        {
            "id": "read-only-isolation",
            "label": "Read-only Airtable isolation",
            "ok": not isolation,
            "ms": 0,
            "language": "",
            "intent": "",
            "reply": "",
            "problems": isolation,
        }
    )
    if include_write_audit:
        details.append(_write_audit(run_id))
    passed = sum(1 for item in details if item["ok"])
    report_path = _write_report(details, run_id)
    return {
        "status": "pass" if passed == len(details) else "fail",
        "pass_count": passed,
        "total_count": len(details),
        "failures": [item for item in details if not item["ok"]],
        "details": details,
        "latency_avg_ms": round(sum(item["ms"] for item in details if item["ms"]) / max(1, sum(1 for item in details if item["ms"]))),
        "report_path": report_path,
    }


def run(only_tags: list[str] | None = None) -> bool:
    result = run_diagnostic(only_tags)
    print(f"PASSED: {result['pass_count']}/{result['total_count']}")
    print(f"Report: {result['report_path']}")
    return result["status"] == "pass"


if __name__ == "__main__":
    tags = [argument for argument in sys.argv[1:] if not argument.startswith("-")] or None
    raise SystemExit(0 if run(tags) else 1)
