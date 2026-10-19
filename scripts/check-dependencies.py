"""Check the tested backend dependency set without downloading anything."""
import importlib.metadata as metadata
from pathlib import Path
import sys

constraints = Path(__file__).resolve().parents[1] / 'backend' / 'constraints-tested.txt'
missing = []
for line in constraints.read_text(encoding='utf-8').splitlines():
    if not line.strip() or line.lstrip().startswith('#'): continue
    name, expected = line.strip().split('==', 1)
    try: installed = metadata.version(name)
    except metadata.PackageNotFoundError: installed = 'missing'
    if installed != expected: missing.append(f'{name}: {installed} (tested {expected})')
if missing:
    print('Backend dependencies need preparation: ' + ', '.join(missing))
    sys.exit(1)
sys.exit(0)
