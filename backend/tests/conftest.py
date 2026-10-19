"""Every API test uses its own database, config, and credential directories."""
import os
import tempfile

import pytest
from fastapi.testclient import TestClient

os.environ['DATABASE_URL'] = 'sqlite:///' + tempfile.mkdtemp(prefix='zhixu-test-db-').replace('\\', '/') + '/test.db'
os.environ['ZHIXU_AUTH_DIR'] = tempfile.mkdtemp(prefix='zhixu-test-startup-auth-')
os.environ['ZHIXU_LEETCODE_AUTH_DIR'] = tempfile.mkdtemp(prefix='zhixu-test-startup-leetcode-')
os.environ['ZHIXU_CONFIG_FILE'] = os.path.join(tempfile.mkdtemp(prefix='zhixu-test-startup-config-'), 'test.env')
from backend import main

@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.delenv('AI_API_KEY', raising=False)
    monkeypatch.delenv('DEEPSEEK_API_KEY', raising=False)
    monkeypatch.setenv('AI_PROVIDER', 'api_key')
    monkeypatch.setenv('AI_BASE_URL', 'https://example.invalid/v1')
    monkeypatch.setenv('AI_MODEL', 'isolated-test-model')
    monkeypatch.setenv('DEEPSEEK_MODEL', 'deepseek-flash')
    monkeypatch.setenv('ZHIXU_CONFIG_FILE', str(tmp_path / 'test.env'))
    from backend.chatgpt_auth import ChatGPTAuth
    from backend.credential_store import CredentialStore
    monkeypatch.setattr(main, 'auth', ChatGPTAuth(CredentialStore(tmp_path / 'auth')))
    from backend import leetcode
    monkeypatch.setattr(leetcode, 'leetcode', leetcode.LeetCodeService(CredentialStore(tmp_path / 'leetcode-auth')))
    main.Base.metadata.drop_all(main.engine)
    main.Base.metadata.create_all(main.engine)
    with TestClient(main.app) as client:
        yield client
