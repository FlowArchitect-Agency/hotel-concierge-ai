"""Delete the stale duplicate n8n workflows.

Targets only inactive copies named exactly 'ConciergeFlow AI - Inbound + Morning Handoff'.
Dry-run by default; backs up each workflow to disk before deleting when --apply is set.
NEVER touches the active workflow or any differently-named experiment.
"""
import json
import os
import sys
import time

import requests

from .config import N8N_WORKFLOWS_URL, N8N_HEADERS, N8N_ACTIVE_WF_ID, PROJECT_ROOT

# The exact name of the duplicates created by the import-spawn bug.
DUP_NAME = 'ConciergeFlow AI — Inbound + Morning Handoff'

BACKUP_DIR = os.path.join(PROJECT_ROOT, 'concierge_harness', 'deleted-backups')


def list_all_workflows():
    """Cursor-paginate the full workflow list."""
    workflows = []
    cursor = None
    while True:
        url = f'{N8N_WORKFLOWS_URL}?limit=250'
        if cursor:
            url += f'&cursor={cursor}'
        resp = requests.get(url, headers=N8N_HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        workflows.extend(data.get('data', []))
        cursor = data.get('nextCursor')
        if not cursor:
            break
    return workflows


def backup_workflow(workflow_id):
    """Save the full workflow JSON to disk so deletion is always recoverable."""
    resp = requests.get(f'{N8N_WORKFLOWS_URL}/{workflow_id}', headers=N8N_HEADERS, timeout=15)
    resp.raise_for_status()
    os.makedirs(BACKUP_DIR, exist_ok=True)
    path = os.path.join(BACKUP_DIR, f'{workflow_id}.json')
    with open(path, 'w', encoding='utf-8') as fp:
        json.dump(resp.json(), fp, indent=2, ensure_ascii=False)
    return path


def cleanup(apply=False, only_name=DUP_NAME):
    print('Fetching all workflows...')
    all_workflows = list_all_workflows()
    print(f'Total workflows on instance: {len(all_workflows)}')

    # Safety filter: inactive + exact name + not the active one.
    targets = [
        w for w in all_workflows
        if w.get('name') == only_name
        and not w.get('active')
        and w.get('id') != N8N_ACTIVE_WF_ID
    ]

    # belt-and-suspenders: protect the live workflow regardless of name
    live = [w for w in all_workflows if w.get('active')]
    live_ids = {w['id'] for w in live}
    targets = [w for w in targets if w['id'] not in live_ids]

    print(f'Active workflows protected: {len(live)} -> {", ".join(w["id"] for w in live)}')
    print(f'Duplicate targets ({len(targets)}) named "{only_name}":')

    if not targets:
        print('  (none) - nothing to clean up.')
        return True

    for w in targets:
        print(f'  {w["id"]}  active={w.get("active")}')

    if not apply:
        print('\nDRY RUN: no workflows deleted.')
        print('To actually delete these, re-run with:  --apply')
        return True

    print('\nApplying deletion (with disk backup for each)...')
    deleted = 0
    for w in targets:
        try:
            path = backup_workflow(w['id'])
            resp = requests.delete(f'{N8N_WORKFLOWS_URL}/{w["id"]}', headers=N8N_HEADERS, timeout=15)
            if resp.status_code in (200, 204):
                print(f'  deleted {w["id"]}  (backup: {path})')
                deleted += 1
            else:
                print(f'  FAILED {w["id"]}: HTTP {resp.status_code} {resp.text[:120]}')
        except Exception as exc:
            print(f'  ERROR {w["id"]}: {exc}')

    print(f'\nDeleted {deleted}/{len(targets)} duplicate workflows.')

    remaining = len(list_all_workflows())
    print(f'Remaining workflows on instance: {remaining}')
    return True


if __name__ == '__main__':
    apply = '--apply' in sys.argv
    ok = cleanup(apply=apply)
    sys.exit(0 if ok else 1)