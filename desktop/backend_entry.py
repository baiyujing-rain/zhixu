"""Desktop backend entrypoint (Windows-first).

Unlike ``backend/main.py`` (which has no ``if __name__ == "__main__"`` block and
relies on an external uvicorn invocation), this script is the PyInstaller
entrypoint for the desktop shell. It must run before ``import backend.main``:

1. inject ``DATABASE_URL`` and ``ZHIXU_CONFIG_FILE`` so persistent data lands in
   the user data directory instead of the PyInstaller ``_MEIPASS`` temp dir;
2. downgrade local sample execution (``backend.judge.run_case``) because a
   frozen single-file exe has no standalone Python interpreter;
3. launch uvicorn bound to the loopback address expected by the Tauri shell.

The Tauri shell (``sidecar.rs``) pipes this process's stdout to
``%APPDATA%/zhixu/logs/backend.log`` and polls ``/api/health`` via the Next
frontend to decide when the app is ready.
"""

import os
import sys
from pathlib import Path


def app_data_dir() -> Path:
    """Return the cross-platform user data directory for Zhixu."""
    if os.name == 'nt':
        return Path(os.getenv('APPDATA', str(Path.home()))) / 'zhixu'
    if sys.platform == 'darwin':
        return Path.home() / 'Library' / 'Application Support' / 'zhixu'
    return Path(os.getenv('XDG_DATA_HOME', str(Path.home() / '.local' / 'share'))) / 'zhixu'


def main() -> None:
    data_dir = app_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    logs_dir = data_dir / 'logs'
    logs_dir.mkdir(parents=True, exist_ok=True)

    # PyInstaller windowed builds (console=False) set sys.stdout/sys.stderr to
    # None; uvicorn's default logging writes to stderr and would raise
    # AttributeError on a None stream. Rebind to a real, appending log stream so
    # startup errors remain diagnosable. In an interactive run these are already
    # valid streams and are left untouched.
    if sys.stdout is None:
        sys.stdout = open(logs_dir / 'backend.log', 'a', encoding='utf-8', buffering=1)
    if sys.stderr is None:
        sys.stderr = sys.stdout

    # Force (not setdefault) the data-dir paths: the desktop app must always
    # isolate its database and settings in the per-user data directory, never
    # inherit an ambient DATABASE_URL/ZHIXU_CONFIG_FILE from the host shell.
    os.environ['DATABASE_URL'] = f'sqlite:///{(data_dir / "zhixu.db").as_posix()}'
    os.environ['ZHIXU_CONFIG_FILE'] = str(data_dir / '.env')

    import uvicorn
    from backend.main import app

    # A frozen single-file exe runs with sys.executable pointing at the exe
    # itself, so ``python -I judge_harness.py`` cannot be spawned. Downgrade the
    # local sample runner to a friendly message; the Web edition is unaffected
    # because this monkeypatch only happens in the frozen build.
    if getattr(sys, 'frozen', False):
        from backend import judge

        def _frozen_run_case(*args, **kwargs):
            return {
                'verdict': 'error',
                'passed': 0,
                'total': 0,
                'cases': [],
                'error': '桌面版暂不支持本地运行样例（需要独立 Python 解释器）。请使用静态审阅或到力扣验证。',
            }

        judge.run_case = _frozen_run_case

    try:
        uvicorn.run(app, host='127.0.0.1', port=8000, log_level='warning', access_log=False)
    except BaseException:  # noqa: BLE001 - keep a crash log before the process dies
        import traceback

        traceback.print_exc()
        try:
            (logs_dir / 'backend-crash.log').write_text(traceback.format_exc(), encoding='utf-8')
        except OSError:
            pass
        raise


if __name__ == '__main__':
    main()
