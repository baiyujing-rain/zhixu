import sqlite3
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from backend import main


@pytest.fixture
def busy_client(client):
    def short_timeout(connection, _):
        connection.execute('PRAGMA busy_timeout=50')
    event.listen(main.engine, 'connect', short_timeout)
    main.engine.dispose()
    try:
        with TestClient(main.app, raise_server_exceptions=False) as http:
            yield http
    finally:
        event.remove(main.engine, 'connect', short_timeout)
        main.engine.dispose()


def test_exclusive_database_lock_reports_busy_and_reads_recover(busy_client):
    original = busy_client.post('/api/sessions', json={'example_id': 'two-sum'}).json()
    original = busy_client.get(f"/api/sessions/{original['id']}").json()
    connection = sqlite3.connect(main.engine.url.database, isolation_level=None)
    try:
        connection.execute('BEGIN EXCLUSIVE')
        response = busy_client.get('/api/sessions')
        assert response.status_code == 503
        assert '数据库正在被其他操作使用' in response.json()['detail']
        assert response.headers['retry-after'] == '1'
    finally:
        connection.rollback()
        connection.close()
    assert busy_client.get(f"/api/sessions/{original['id']}").json() == original


def test_commit_blocked_by_reader_rolls_back_all_edit_fields(busy_client):
    original = busy_client.post('/api/sessions', json={'example_id': 'valid-parentheses'}).json()
    original = busy_client.get(f"/api/sessions/{original['id']}").json()
    connection = sqlite3.connect(main.engine.url.database, isolation_level=None)
    try:
        connection.execute('BEGIN')
        connection.execute('SELECT * FROM learning_sessions').fetchall()
        response = busy_client.patch(f"/api/sessions/{original['id']}", json={
            'code': '// blocked write must not appear', 'notes': 'blocked notes',
            'expected_code': original['drafts']['cpp'], 'expected_notes': original['notes'],
        })
        assert response.status_code == 503
        assert '数据库正在被其他操作使用' in response.json()['detail']
    finally:
        connection.rollback()
        connection.close()
    # Inspect the file through an independent connection, not a pooled reader.
    with sqlite3.connect(main.engine.url.database) as verify:
        drafts, notes = verify.execute('SELECT drafts, notes FROM learning_sessions WHERE id=?', (original['id'],)).fetchone()
        assert json.loads(drafts) == original['drafts']
        assert notes == original['notes']
    assert busy_client.get(f"/api/sessions/{original['id']}").json() == original
    recovered = busy_client.patch(f"/api/sessions/{original['id']}", json={
        'code': '// saved after unlock', 'expected_code': original['drafts']['cpp'],
    })
    assert recovered.status_code == 200
    assert recovered.json()['drafts']['cpp'] == '// saved after unlock'
