"""Consistent local SQLite backup and read-only comparison before/after upgrade."""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]


def describe(connection):
    connection.execute('BEGIN')
    tables = {}
    names = connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
    for (name,) in names:
        quoted = '"' + name.replace('"', '""') + '"'
        columns = [row[1] for row in connection.execute(f'PRAGMA table_info({quoted})')]
        rows = list(connection.execute(f'SELECT * FROM {quoted}'))
        encoded = [json.dumps(row, ensure_ascii=False, separators=(',', ':'), default=lambda value: {'bytes': value.hex()}) for row in rows]
        digest = hashlib.sha256('\n'.join(sorted(encoded)).encode('utf-8')).hexdigest()
        tables[name] = {'columns': columns, 'count': len(rows), 'sha256': digest}
    connection.rollback()
    return tables


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['backup', 'check'])
    parser.add_argument('--database', type=Path, default=ROOT / 'backend' / 'zhixu.db')
    parser.add_argument('--baseline', type=Path, help='The .verification.json file from a backup.')
    args = parser.parse_args()
    source = args.database.resolve()
    if not source.is_file(): raise FileNotFoundError('The database does not exist; no file was created.')
    if args.command == 'backup':
        directory = ROOT / 'backups'
        directory.mkdir(exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        destination = directory / f'zhixu-before-upgrade-{stamp}.db'
        destination.touch(exist_ok=False)
        with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as reader:
            with closing(sqlite3.connect(destination)) as writer:
                reader.backup(writer)
                if writer.execute('PRAGMA quick_check').fetchone()[0] != 'ok': raise RuntimeError('Backup consistency check failed.')
                tables = describe(writer)
        baseline = destination.with_suffix('.verification.json')
        data = {'created_at_utc': datetime.now(timezone.utc).isoformat(), 'source': str(source), 'backup': str(destination), 'quick_check': 'ok', 'tables': tables}
        with baseline.open('x', encoding='utf-8') as output: json.dump(data, output, ensure_ascii=False, indent=2)
        print(json.dumps({'backup': str(destination), 'baseline': str(baseline), 'sessions': tables.get('learning_sessions', {}).get('count'), 'quick_check': 'ok'}))
    else:
        if not args.baseline: parser.error('check requires --baseline')
        baseline = json.loads(args.baseline.read_text(encoding='utf-8'))
        if Path(baseline['source']).resolve() != source: raise ValueError('The baseline belongs to a different database.')
        with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as reader:
            integrity = reader.execute('PRAGMA quick_check').fetchone()[0]
            tables = describe(reader)
        changed = [name for name, value in baseline['tables'].items() if tables.get(name) != value]
        added = sorted(set(tables) - set(baseline['tables']))
        result = {'checked_at_utc': datetime.now(timezone.utc).isoformat(), 'quick_check': integrity, 'original_tables_unchanged': not changed, 'changed_tables': changed, 'added_tables': added, 'sessions': tables.get('learning_sessions', {}).get('count')}
        print(json.dumps(result))
        if integrity != 'ok' or changed: raise SystemExit(1)


if __name__ == '__main__': main()
