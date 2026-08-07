"""ConciergeFlow harness — automate n8n update -> test -> cleanup.

Usage:
    python -m concierge_harness deploy [--force] [--json path]
    python -m concierge_harness test [tag tag ...]
    python -m concierge_harness cleanup [--apply]
    python -m concierge_harness harden   # add safe test gates and remove literal provider key
    python -m concierge_harness redact-provider-keys --apply # remove exposed Groq keys from exports
    python -m concierge_harness all      # deploy + test + automatic rollback on regression
    python -m concierge_harness converge [--minutes N] # continuous watch and health checks
"""
import sys


def _help():
    print(__doc__)


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    if not argv or argv[0] in ('-h', '--help', 'help'):
        _help()
        return 0

    cmd = argv[0]
    rest = argv[1:]

    if cmd == 'deploy':
        from . import deploy as _deploy
        force = '--force' in rest
        json_path = next((a for a in rest if a.endswith('.json')), None)
        return 0 if _deploy.deploy(json_path=json_path, force=force) else 1

    if cmd == 'test':
        from . import tests as _tests
        tags = [a for a in rest if not a.startswith('-')] or None
        return 0 if _tests.run(only_tags=tags) else 1

    if cmd == 'cleanup':
        from . import cleanup as _cleanup
        return 0 if _cleanup.cleanup(apply='--apply' in rest) else 1

    if cmd == 'harden':
        from . import workflow_hardening as _hardening
        return _hardening.main(['--check'] if '--check' in rest else [])

    if cmd == 'redact-provider-keys':
        from . import redact_provider_keys as _redactor
        return _redactor.main(['--apply'] if '--apply' in rest else [])

    if cmd == 'all':
        from .converge_daemon import run_once
        result = run_once()
        return 0 if result['status'] == 'pass' else 1

    if cmd == 'converge':
        from .converge_daemon import daemon
        minutes = None
        if '--minutes' in rest:
            try:
                minutes = float(rest[rest.index('--minutes') + 1])
            except (IndexError, ValueError):
                print('converge --minutes requires a positive number')
                return 1
        daemon(minutes, skip_initial='--skip-initial' in rest)
        return 0

    print(f'Unknown command: {cmd}')
    _help()
    return 1


if __name__ == '__main__':
    sys.exit(main())
