from pathlib import Path
import os

import pytest
from fastapi.testclient import TestClient

from backend.credential_store import CredentialStore, CredentialStorageError
from backend import main


def test_atomic_write_uses_resolved_directory_for_both_paths(tmp_path, monkeypatch):
    store = CredentialStore(tmp_path / 'credentials')
    original_replace = os.replace
    observed = []
    def same_physical_directory(source, target):
        observed.append((Path(source), Path(target)))
        assert Path(source).parent == store.directory.resolve(strict=True)
        assert Path(target).parent == store.directory.resolve(strict=True)
        original_replace(source, target)
    monkeypatch.setattr(os, 'replace', same_physical_directory)
    store.save({'accounts': [], 'selected': None, 'host_id': 'stable-host'})
    store.save({'accounts': [], 'selected': None, 'host_id': 'stable-host', 'test': True})
    assert len(observed) == 2
    assert store.load()['test'] is True


def test_failed_replace_preserves_original_encrypted_record(tmp_path, monkeypatch):
    store = CredentialStore(tmp_path / 'credentials')
    store.save({'accounts': [], 'selected': None, 'host_id': 'original'})
    before = store.path.read_bytes()
    def failing_replace(source, target):
        raise OSError('simulated protected-directory failure')
    monkeypatch.setattr(os, 'replace', failing_replace)
    with pytest.raises(CredentialStorageError):
        store.save({'accounts': [], 'selected': None, 'host_id': 'replacement'})
    assert store.path.read_bytes() == before
    assert store.load()['host_id'] == 'original'
    assert list(store.directory.glob('.credential-*')) == []


def test_storage_failure_is_safe_json_instead_of_plain_500(monkeypatch):
    def failing_load():
        raise CredentialStorageError('无法读取本机授权信息，请检查目录。')
    monkeypatch.setattr(main.auth.store, 'load', failing_load)
    with TestClient(main.app) as client:
        result = client.get('/api/settings')
        assert result.status_code == 500
        assert result.headers['content-type'].startswith('application/json')
        assert result.json()['detail'].startswith('无法读取')
