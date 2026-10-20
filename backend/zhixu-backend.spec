# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the Zhixu desktop backend (single-file, windowed).

Run from the repository root (see desktop/scripts/build-backend.ps1):

    .venv\\Scripts\\python.exe -m PyInstaller --noconfirm --clean \
      --distpath desktop\\dist\\backend --workpath desktop\\build\\backend \
      backend\\zhixu-backend.spec

SPECPATH is injected by PyInstaller and points at the directory containing this
spec file (``backend/``); the repository root is its parent. The root must be on
the analysis search path so the ``backend`` package and the entry script resolve
regardless of the cwd used to invoke PyInstaller.
"""

import os

from PyInstaller.utils.hooks import collect_all, collect_submodules

ROOT = os.path.abspath(os.path.join(SPECPATH, os.pardir))  # noqa: F821 - PyInstaller global

datas, binaries, hiddenimports = [], [], []
for pkg in (
    'uvicorn',
    'httptools',
    'fastapi',
    'starlette',
    'pydantic',
    'pydantic_core',
    'sqlalchemy',
    'anyio',
    'httpx',
    'httpcore',
    'dotenv',
    'jwt',
    'certifi',
    'cryptography',
    'cffi',
):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

hiddenimports += [m for m in collect_submodules('backend') if not m.startswith('backend.tests')]
hiddenimports += [
    'uvicorn.loops.auto',
    'uvicorn.loops.asyncio',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.http.h11_impl',
    'uvicorn.protocols.http.httptools_impl',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan.on',
    'uvicorn.lifespan.off',
    'sqlalchemy.dialects.sqlite',
]

a = Analysis(
    [os.path.join(ROOT, 'desktop', 'backend_entry.py')],
    pathex=[ROOT],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=['pytest', 'tkinter', 'watchfiles', 'uvloop', 'websockets', 'h2', 'socksio'],
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='zhixu-backend',
    debug=False,
    strip=False,
    upx=False,
    console=False,  # Windows: no console window
)
