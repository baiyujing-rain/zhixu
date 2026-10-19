import asyncio
import json
import time
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend import main, chatgpt_auth
from backend.chatgpt_auth import ChatGPTAuth, ISSUER, PLAN_SCOPE, RESOURCE, SCOPES
from backend.credential_store import CredentialStore


def run(awaitable):
    return asyncio.run(awaitable)


@pytest.fixture
def setup(monkeypatch, tmp_path):
    auth = ChatGPTAuth(CredentialStore(tmp_path / 'auth'))
    monkeypatch.setattr(chatgpt_auth, 'auth', auth)
    monkeypatch.setattr(main, 'auth', auth)
    monkeypatch.setenv('AI_PROVIDER', 'chatgpt')
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private_key.public_key()))
    public_jwk.update({'kid': 'test-signing-key', 'alg': 'RS256', 'use': 'sig'})
    state = {'subject': 'account-1', 'scope': SCOPES, 'token_error': None, 'refresh_count': 0, 'stream_mode': 'success', 'requests': [], 'nonce_override': None, 'token_audience': None}

    def transport(request):
        state['requests'].append(request)
        path = request.url.path
        if path.endswith('openid-configuration'):
            return httpx.Response(200, json={'issuer': ISSUER, 'authorization_endpoint': ISSUER + '/api/accounts/authorize', 'token_endpoint': ISSUER + '/api/accounts/oauth/token', 'jwks_uri': ISSUER + '/.well-known/jwks.json', 'revocation_endpoint': ISSUER + '/oauth/revoke'})
        if path.endswith('jwks.json'):
            return httpx.Response(200, json={'keys': [public_jwk]})
        if path.endswith('/oauth/token'):
            fields = parse_qs(request.content.decode())
            if state['token_error']:
                return httpx.Response(400, json={'error': state['token_error']})
            refresh = fields['grant_type'][0] == 'refresh_token'
            if refresh:
                state['refresh_count'] += 1
            claims = {'iss': ISSUER, 'aud': state['token_audience'] or fields['client_id'][0], 'sub': state['subject'], 'iat': int(time.time()), 'exp': int(time.time()) + 3600, 'nonce': state['nonce_override'] or (auth.pending or {}).get('nonce', state.get('nonce')), 'email': 'student@example.com'}
            encoded = jwt.encode(claims, private_key, algorithm='RS256', headers={'kid': 'test-signing-key'})
            return httpx.Response(200, json={'access_token': 'access-new' if refresh else 'access-test', 'refresh_token': 'refresh-new' if refresh else 'refresh-test', 'id_token': encoded, 'token_type': 'Bearer', 'expires_in': 3600, 'scope': state['scope']})
        if path.endswith('/oauth/revoke'):
            return httpx.Response(200)
        if path == '/v1/models':
            return httpx.Response(200, json={'models': [{'slug': 'available-model', 'display_name': 'Available Model', 'visibility': 'list'}, {'slug': 'hidden-model', 'visibility': 'hidden'}]})
        if path == '/v1/responses':
            body = json.loads(request.content)
            assert body['store'] is False and body['stream'] is True
            assert body['model'] == 'available-model'
            assert 'temperature' not in body and 'previous_response_id' not in body
            assert all(message['role'] != 'system' for message in body['input'])
            events = [{'type': 'response.output_text.delta', 'delta': '先从一个例子开始。'}]
            if state['stream_mode'] == 'success':
                events.append({'type': 'response.completed', 'response': {'status': 'completed'}})
            elif state['stream_mode'] == 'limit':
                events.append({'type': 'response.failed', 'response': {'error': {'code': 'subscription_sharing_usage_limit_exceeded'}}})
            elif state['stream_mode'] == 'incomplete':
                events.append({'type': 'response.incomplete'})
            return httpx.Response(200, content=''.join('data: ' + json.dumps(event, ensure_ascii=False) + '\n\n' for event in events).encode(), headers={'content-type': 'text/event-stream'})
        raise AssertionError(f'Unexpected endpoint: {path}')

    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: original(**kwargs, transport=httpx.MockTransport(transport)))
    return auth, state, private_key


def start(auth, state, **options):
    url = run(auth.start('browser-cookie', 'http://127.0.0.1:8000/auth/callback', **options))
    params = parse_qs(urlparse(url).query)
    state['nonce'] = params['nonce'][0]
    return params


def complete(auth, params, client_id='oaiapp_test'):
    run(auth.complete({'state': params['state'][0], 'code': 'test-code', 'client_id': client_id}, 'browser-cookie'))


def test_official_registration_pkce_identity_encrypted_storage_and_resume(setup):
    auth, state, _ = setup
    params = start(auth, state)
    assert params['client_id'] == ['dynamic_agent_client']
    assert params['resource'] == [RESOURCE]
    assert PLAN_SCOPE in params['scope'][0]
    assert params['code_challenge_method'] == ['S256']
    complete(auth, params)
    assert auth.status()['plan_enabled']
    assert 'access-test' not in json.dumps(auth.status())
    resumed = ChatGPTAuth(auth.store)
    assert resumed.status()['account']['email'] == 'student@example.com'
    again = start(resumed, state)
    assert again['client_id'] == ['oaiapp_test']
    assert again['ext_agent_host_id'] == params['ext_agent_host_id']
    assert 'agent_name_hint' not in again
    if __import__('os').name == 'nt':
        assert b'access-test' not in auth.store.path.read_bytes()


@pytest.mark.parametrize('case', ['wrong-state', 'wrong-cookie', 'expired', 'missing-client', 'denied'])
def test_invalid_callback_does_not_exchange_code(setup, case):
    auth, state, _ = setup
    params = start(auth, state)
    query = {'state': params['state'][0], 'code': 'test-code', 'client_id': 'oaiapp_test'}
    cookie = 'browser-cookie'
    if case == 'wrong-state': query['state'] = 'invalid'
    if case == 'wrong-cookie': cookie = 'invalid'
    if case == 'expired': auth.pending['expires_at'] = time.time() - 1
    if case == 'missing-client': query.pop('client_id')
    if case == 'denied': query['error'] = 'access_denied'
    with pytest.raises(HTTPException): run(auth.complete(query, cookie))
    assert not any(request.url.path.endswith('/oauth/token') for request in state['requests'])
    assert not auth.status()['connected']


@pytest.mark.parametrize('case', ['nonce', 'audience', 'issuer', 'signature', 'expiry'])
def test_id_token_security_validation(setup, case):
    auth, state, private_key = setup
    params = start(auth, state)
    run(auth.endpoints())
    claims = {'iss': ISSUER, 'aud': 'oaiapp_test', 'sub': 'account-1', 'iat': int(time.time()), 'exp': int(time.time()) + 3600, 'nonce': params['nonce'][0]}
    if case == 'nonce': claims['nonce'] = 'invalid'
    if case == 'audience': claims['aud'] = 'wrong-client'
    if case == 'issuer': claims['iss'] = 'https://example.com'
    if case == 'expiry': claims['exp'] = int(time.time()) - 60
    if case == 'signature': private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = jwt.encode(claims, private_key, algorithm='RS256', headers={'kid': 'test-signing-key'})
    with pytest.raises(HTTPException): run(auth.verify_identity(token, 'oaiapp_test', params['nonce'][0]))


def test_denied_plan_scope_retains_identity_but_blocks_inference(setup):
    auth, state, _ = setup
    params = start(auth, state)
    state['scope'] = 'openid profile email'
    complete(auth, params)
    assert auth.status()['connected'] and not auth.status()['plan_enabled']
    with pytest.raises(HTTPException) as error: run(auth.infer('guide', [{'role': 'user', 'content': 'question'}]))
    assert error.value.status_code == 403
    assert not any(request.url.path == '/v1/responses' for request in state['requests'])


def test_reauthorization_cannot_replace_selected_identity(setup):
    auth, state, _ = setup
    complete(auth, start(auth, state))
    original = auth.store.load()
    params = start(auth, state)
    state['subject'] = 'another-account'
    with pytest.raises(HTTPException): complete(auth, params)
    assert auth.store.load() == original


def test_refresh_rotates_credentials_atomically_and_preserves_registration(setup):
    auth, state, _ = setup
    complete(auth, start(auth, state))
    data = auth.store.load()
    data['accounts'][0]['expires_at'] = time.time() - 1
    auth.store.save(data)
    result = run(auth.access())
    assert result['access_token'] == 'access-new' and result['refresh_token'] == 'refresh-new'
    assert result['client_id'] == 'oaiapp_test'
    assert state['refresh_count'] == 1
    fields = parse_qs(state['requests'][-1].content.decode())
    assert fields['client_id'] == ['oaiapp_test'] and 'scope' not in fields


def test_invalid_refresh_clears_tokens_but_keeps_account_mapping(setup):
    auth, state, _ = setup
    complete(auth, start(auth, state))
    data = auth.store.load()
    data['accounts'][0]['expires_at'] = time.time() - 1
    auth.store.save(data)
    state['token_error'] = 'invalid_grant'
    with pytest.raises(HTTPException) as error: run(auth.access())
    assert error.value.status_code == 401
    assert not auth.status()['connected']
    assert auth.status()['account']['id'] == 'oaiapp_test'


@pytest.mark.parametrize('mode, expected', [('success', None), ('limit', 429), ('incomplete', 502), ('interrupted', 502)])
def test_responses_stream_requires_completion_and_uses_account_models(setup, mode, expected):
    auth, state, _ = setup
    complete(auth, start(auth, state))
    catalog = run(auth.models())
    assert len(catalog['models']) == 1
    state['stream_mode'] = mode
    if expected:
        with pytest.raises(HTTPException) as error: run(auth.infer('算法导师', [{'role': 'user', 'content': '问题'}]))
        assert error.value.status_code == expected
    else:
        assert run(auth.infer('算法导师', [{'role': 'user', 'content': '问题'}])) == '先从一个例子开始。'


def test_routes_bind_browser_cookie_and_do_not_expose_tokens(setup):
    auth, state, _ = setup
    with TestClient(main.app) as client:
        response = client.post('/api/auth/start', json={})
        assert response.status_code == 200
        assert 'HttpOnly' in response.headers['set-cookie']
        path = response.json()['authorization_url']
        assert path.startswith('/api/auth/authorize?') and 'id_token_hint' not in path
        redirect = client.get(path, follow_redirects=False)
        assert redirect.status_code == 303
        assert redirect.headers['location'].startswith(ISSUER + '/')
        assert client.get(path, follow_redirects=False).status_code == 400
        state['nonce'] = auth.pending['nonce']
        callback = client.get('/auth/callback', params={'state': auth.pending['state'], 'client_id': 'oaiapp_test', 'code': 'secret-code'})
        assert callback.status_code == 200
        assert 'secret-code' not in callback.text and 'access-test' not in callback.text
        assert 'access-test' not in client.get('/api/settings').text
        assert client.post('/api/auth/start', json={}, headers={'origin': 'https://evil.example'}).status_code == 403
        logout = client.post('/api/auth/logout', json={}).json()
        assert logout['revoked'] is True
        assert not auth.status()['connected']
        again = start(auth, state)
        assert again['client_id'] == ['oaiapp_test'] and 'id_token_hint' not in again


def test_spent_code_retries_with_the_issued_client_not_a_duplicate_registration(setup):
    auth, state, _ = setup
    params = start(auth, state)
    state['token_error'] = 'invalid_grant'
    with pytest.raises(HTTPException): complete(auth, params)
    assert not auth.status()['connected']
    restarted = ChatGPTAuth(auth.store)
    params = start(restarted, state)
    assert params['client_id'] == ['oaiapp_test']
    assert 'agent_name_hint' not in params


def test_plan_limit_does_not_advance_learning_or_fall_back_to_api_key(setup, monkeypatch):
    auth, state, _ = setup
    complete(auth, start(auth, state))
    run(auth.models())
    state['stream_mode'] = 'limit'
    monkeypatch.setenv('AI_API_KEY', 'must-not-be-used')
    with TestClient(main.app) as client:
        item = client.post('/api/sessions', json={'content': '合并两个有序链表，并返回一个新的有序链表，输入允许空链表。'}).json()
        response = client.post(f'/api/sessions/{item["id"]}/coach', json={'action': 'hint'})
        assert response.status_code == 429
        retained = client.get(f'/api/sessions/{item["id"]}').json()
        assert retained['stage'] == 0 and len(retained['messages']) == 1
        assert not any(request.url.path.endswith('/chat/completions') for request in state['requests'])
