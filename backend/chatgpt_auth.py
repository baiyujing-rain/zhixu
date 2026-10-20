"""Official public-client OAuth flow for a single-user loopback application.

No Codex credentials, ChatGPT cookies, or private backend endpoints are used.
"""
import asyncio
import base64
import hashlib
import html
import json
import os
import secrets
import time
import uuid
from urllib.parse import urlencode, urlparse

import httpx
import jwt
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field

from backend.credential_store import CredentialStore

ISSUER = 'https://auth.openai.com'
RESOURCE = 'https://api.openai.com/v1'
SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
PLAN_SCOPE = 'chatgpt.tokens.use.direct'
COOKIE = 'zhixu_oauth_attempt'
TERMINAL_REFRESH_ERRORS = {'invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'}


def safe_error(status, payload, request_id=None):
    """Return actionable diagnostics without reflecting provider text or tokens."""
    error = payload.get('error', {}) if isinstance(payload, dict) else {}
    code = error.get('code') if isinstance(error, dict) else error if isinstance(error, str) else None
    messages = {
        'subscription_sharing_user_not_eligible': '此账号、工作区或所在地区暂不支持 ChatGPT 订阅授权。',
        'subscription_sharing_usage_limit_exceeded': '本应用的 ChatGPT 使用额度已达到限制，请到 ChatGPT 的用量设置查看。',
        'subscription_sharing_usage_unavailable': '暂时无法检查 ChatGPT 用量，请稍后重试。',
        'subscription_sharing_unsupported_capability': '当前模型不支持这项请求，请刷新模型列表或换一个模型。',
        'subscription_sharing_route_not_supported': '当前账号的官方推理接口暂不可用。',
        'subscription_sharing_invalid_user': 'ChatGPT 授权身份未通过验证，请重新登录。',
        'subscription_sharing_user_unavailable': 'ChatGPT 账号信息暂时不可用，请稍后重试。',
        'invalid_client': 'OpenAI 未接受此应用注册，请重新发起授权。',
    }
    message = messages.get(code) or {401: 'ChatGPT 授权未被接受，请重新登录。', 403: 'OpenAI 拒绝了此次请求，请检查账号权限、地区或工作区限制。', 429: 'ChatGPT 使用额度或请求频率达到限制，请稍后重试。', 503: 'ChatGPT 授权服务暂不可用，请稍后重试。'}.get(status, 'ChatGPT 服务未能完成请求，请稍后重试。')
    # Keep a bounded machine-readable code and request ID, never arbitrary provider diagnostics.
    suffix = ''
    if isinstance(code, str) and code.replace('_', '').isalnum() and len(code) < 100:
        suffix += f'（{code}）'
    if isinstance(request_id, str) and len(request_id) < 150 and all(c.isalnum() or c in '_-' for c in request_id):
        suffix += f' 请求编号：{request_id}'
    return HTTPException(status if 400 <= status <= 599 else 502, message + suffix)


class ChatGPTAuth:
    def __init__(self, store=None):
        self.store = store or CredentialStore()
        self.pending = None
        self.last_error = None
        self.lock = asyncio.Lock()
        self.discovery = None
        self.jwks = None
        self.jwks_at = 0

    def selected(self, data=None):
        data = data if data is not None else self.store.load()
        return next((account for account in data['accounts'] if account['client_id'] == data.get('selected')), None)

    def status(self):
        data = self.store.load()
        selected = self.selected(data)
        connected = bool(selected and selected.get('access_token'))
        if self.pending and self.pending['expires_at'] <= time.time():
            self.pending = None
            self.last_error = '登录已超时，请重新点击授权按钮。'
        return {
            'connected': connected,
            'plan_enabled': bool(connected and PLAN_SCOPE in selected.get('scopes', [])),
            'account': {'id': selected['client_id'], 'email': selected.get('email') or 'ChatGPT 账号', 'model': selected.get('model')} if selected else None,
            'accounts': [{'id': a['client_id'], 'email': a.get('email') or 'ChatGPT 账号', 'connected': bool(a.get('access_token'))} for a in data['accounts']],
            'pending': self.pending is not None,
            'error': self.last_error,
        }

    async def endpoints(self):
        if self.discovery:
            return self.discovery
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.get(f'{ISSUER}/.well-known/openid-configuration')
                response.raise_for_status()
                data = response.json()
            if data.get('issuer') != ISSUER:
                raise ValueError('issuer')
            for field in ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'revocation_endpoint']:
                url = urlparse(data.get(field, ''))
                if url.scheme != 'https' or url.hostname != 'auth.openai.com':
                    raise ValueError('endpoint')
            self.discovery = data
            return data
        except (httpx.HTTPError, ValueError, TypeError):
            raise HTTPException(502, '无法连接 OpenAI 官方授权服务，请检查网络后重试。')

    async def start(self, browser_id, redirect_uri, account_id=None, add_account=False, reconsent=False):
        endpoints = await self.endpoints()
        async with self.lock:
            data = self.store.load()
            if not data.get('host_id'):
                data['host_id'] = 'urn:uuid:' + str(uuid.uuid4())
                self.store.save(data)
            account = None if add_account else next((a for a in data['accounts'] if a['client_id'] == (account_id or data.get('selected'))), None)
            if account_id and not account:
                raise HTTPException(404, '保存的账号注册不存在，请添加一个新账号。')
            retry = data.get('pending_registration')
            if account is None and retry and not account_id:
                account = {'client_id': retry['client_id']}
            state, nonce, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(32), secrets.token_urlsafe(64)
            self.pending = {'state': state, 'nonce': nonce, 'verifier': verifier, 'browser_id': browser_id, 'redirect_uri': redirect_uri, 'client_id': account['client_id'] if account else None, 'subject': account.get('subject') if account else None, 'expires_at': time.time() + 600}
            self.last_error = None
            params = {'client_id': account['client_id'] if account else 'dynamic_agent_client', 'ext_agent_host_id': data['host_id'], 'response_type': 'code', 'redirect_uri': redirect_uri, 'scope': SCOPES, 'resource': RESOURCE, 'state': state, 'nonce': nonce, 'code_challenge_method': 'S256', 'code_challenge': base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')}
            if account:
                if account.get('id_token'):
                    params['id_token_hint'] = account['id_token']
                if account.get('email'):
                    params['login_hint'] = account['email']
            else:
                params['agent_name_hint'] = '知序 Zhixu'
            if reconsent:
                params['prompt'] = 'consent'
            return endpoints['authorization_endpoint'] + '?' + urlencode(params)

    async def verify_identity(self, token, client_id, nonce):
        endpoints = await self.endpoints()
        try:
            header = jwt.get_unverified_header(token)
            if header.get('alg') != 'RS256' or not header.get('kid'):
                raise ValueError('algorithm')
            key_data = next((key for key in (self.jwks or {}).get('keys', []) if key.get('kid') == header['kid']), None)
            if not key_data or time.time() - self.jwks_at > 3600:
                async with httpx.AsyncClient(timeout=20) as client:
                    response = await client.get(endpoints['jwks_uri'])
                    response.raise_for_status()
                    self.jwks = response.json()
                    self.jwks_at = time.time()
                key_data = next((key for key in self.jwks.get('keys', []) if key.get('kid') == header['kid']), None)
            if not key_data:
                raise ValueError('key')
            claims = jwt.decode(token, jwt.PyJWK.from_dict(key_data).key, algorithms=['RS256'], audience=client_id, issuer=ISSUER, leeway=5, options={'require': ['iss', 'aud', 'sub', 'exp', 'iat', 'nonce']})
            if not isinstance(claims['sub'], str) or not claims['sub'] or not secrets.compare_digest(str(claims['nonce']), nonce):
                raise ValueError('identity')
            return claims
        except (jwt.PyJWTError, httpx.HTTPError, ValueError, TypeError, KeyError):
            raise HTTPException(400, 'ChatGPT 登录身份未通过安全验证，请重新授权。')

    def token_fields(self, tokens, previous=None):
        if not isinstance(tokens.get('access_token'), str) or not tokens['access_token'] or tokens.get('token_type', '').lower() != 'bearer':
            raise HTTPException(502, 'OpenAI 未返回有效的授权凭据，请重新登录。')
        expires_in = tokens.get('expires_in')
        if not isinstance(expires_in, (int, float)) or expires_in <= 0:
            raise HTTPException(502, 'OpenAI 未返回有效的授权期限。')
        scope = tokens.get('scope')
        if not isinstance(scope, str):
            raise HTTPException(502, 'OpenAI 未返回授权范围，请重新登录。')
        if previous is not None and not isinstance(tokens.get('refresh_token'), str):
            raise HTTPException(502, 'OpenAI 未返回更新后的续期凭据，请重新登录。')
        return {**(previous or {}), 'access_token': tokens['access_token'], 'refresh_token': tokens.get('refresh_token'), 'id_token': tokens.get('id_token') or (previous or {}).get('id_token'), 'scopes': scope.split(), 'expires_at': time.time() + expires_in, 'earliest_refresh_at': tokens.get('earliest_refresh_at', 0)}

    async def token_request(self, fields):
        endpoints = await self.endpoints()
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(endpoints['token_endpoint'], data=fields)
            try:
                payload = response.json()
            except ValueError:
                payload = {}
            if response.status_code != 200:
                error = payload.get('error') if isinstance(payload, dict) else None
                error_code = error.get('code') if isinstance(error, dict) else error
                if fields['grant_type'] == 'refresh_token' and isinstance(error_code, str) and error_code in TERMINAL_REFRESH_ERRORS:
                    data = self.store.load()
                    account = next((a for a in data['accounts'] if a['client_id'] == fields['client_id']), None)
                    if account:
                        self.clear_tokens(account)
                        self.store.save(data)
                    raise HTTPException(401, 'ChatGPT 授权已失效，请重新登录；做题记录仍然保留。')
                raise safe_error(response.status_code, payload, response.headers.get('x-request-id'))
            if not isinstance(payload, dict):
                raise HTTPException(502, 'OpenAI 返回了无效的授权结果。')
            return payload
        except httpx.HTTPError:
            raise HTTPException(502, 'ChatGPT 授权服务连接中断，请重试。')

    async def complete(self, query, browser_id):
        async with self.lock:
            pending = self.pending
            if not pending or pending['expires_at'] <= time.time() or not secrets.compare_digest(query.get('state', ''), pending['state']) or not browser_id or not secrets.compare_digest(browser_id, pending['browser_id']):
                raise HTTPException(400, '登录请求已过期或不属于当前浏览器，请从知序重新发起授权。')
            self.pending = None  # one-time consumption, including denial or token-exchange failure
            try:
                if query.get('error'):
                    raise HTTPException(400, '你取消了授权，或 OpenAI 未允许这次授权。可以重新尝试；原账号保持不变。')
                client_id = query.get('client_id') or pending['client_id']
                if not client_id or client_id == 'dynamic_agent_client' or len(client_id) > 256:
                    raise HTTPException(400, 'OpenAI 未完成应用注册，请重新授权。')
                if pending['client_id'] and client_id != pending['client_id']:
                    raise HTTPException(400, '返回的账号注册与本次请求不一致，请重新授权。')
                if not query.get('code'):
                    raise HTTPException(400, '授权结果缺少登录代码，请重新授权。')
                # A issued registration survives a spent code, but never becomes an
                # account or replaces credentials before signed identity validation.
                if not pending['subject']:
                    registration = self.store.load()
                    registration['pending_registration'] = {'client_id': client_id}
                    self.store.save(registration)
                tokens = await self.token_request({'grant_type': 'authorization_code', 'client_id': client_id, 'code': query['code'], 'code_verifier': pending['verifier'], 'redirect_uri': pending['redirect_uri'], 'resource': RESOURCE})
                identity = await self.verify_identity(tokens.get('id_token', ''), client_id, pending['nonce'])
                if pending['subject'] and identity['sub'] != pending['subject']:
                    raise HTTPException(400, '这次登录的账号与所选账号不一致，请使用「添加账号」。')
                record = self.token_fields(tokens)
                data = self.store.load()
                previous = next((a for a in data['accounts'] if a['client_id'] == client_id), None)
                if previous and previous['subject'] != identity['sub']:
                    raise HTTPException(400, '账号注册身份发生变化，已拒绝替换现有登录。')
                record.update({'client_id': client_id, 'subject': identity['sub'], 'email': identity.get('email'), 'model': (previous or {}).get('model')})
                data['accounts'] = [a for a in data['accounts'] if a['client_id'] != client_id] + [record]
                data['selected'] = client_id
                if data.get('pending_registration', {}).get('client_id') == client_id:
                    data.pop('pending_registration', None)
                self.store.save(data)
                self.last_error = None if PLAN_SCOPE in record['scopes'] else '账号登录成功，但未授予 ChatGPT 订阅调用权限。请点击「开启订阅授权」。'
            except HTTPException as error:
                self.last_error = str(error.detail)
                raise

    @staticmethod
    def clear_tokens(account):
        for field in ['access_token', 'refresh_token', 'id_token', 'expires_at', 'earliest_refresh_at', 'scopes']:
            account.pop(field, None)

    async def access(self):
        async with self.lock:
            data = self.store.load()
            account = self.selected(data)
            if not account or not account.get('access_token'):
                raise HTTPException(409, '先到学习设置，使用 ChatGPT 账号登录并授权。')
            if PLAN_SCOPE not in account.get('scopes', []):
                raise HTTPException(403, '此账号尚未授权使用 ChatGPT 订阅，请在学习设置中开启订阅授权。')
            now = time.time()
            if account.get('expires_at', 0) - now <= 90:
                if not account.get('refresh_token'):
                    raise HTTPException(401, 'ChatGPT 登录已过期，请重新授权。')
                earliest = account.get('earliest_refresh_at', 0)
                if isinstance(earliest, (int, float)) and earliest > now:
                    if account.get('expires_at', 0) > now + 10:
                        return dict(account)
                    raise HTTPException(503, '当前凭据暂不能续期，请稍后重试。')
                tokens = await self.token_request({'grant_type': 'refresh_token', 'client_id': account['client_id'], 'refresh_token': account['refresh_token'], 'resource': RESOURCE})
                updated = self.token_fields(tokens, account)
                account.update(updated)
                self.store.save(data)
                if PLAN_SCOPE not in account['scopes']:
                    raise HTTPException(403, '续期后未获得 ChatGPT 订阅权限，请重新授权。')
            return dict(account)

    async def models(self):
        account = await self.access()
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.get(f'{RESOURCE}/models', headers={'Authorization': f'Bearer {account["access_token"]}'})
            payload = response.json()
            if response.status_code >= 400:
                raise safe_error(response.status_code, payload, response.headers.get('x-request-id'))
            catalog = [{'slug': model['slug'], 'display_name': model.get('display_name') or model['slug']} for model in payload.get('models', []) if model.get('visibility') == 'list' and isinstance(model.get('slug'), str)]
            if not catalog:
                raise HTTPException(403, '这个账号暂时没有可用的授权模型，请检查 ChatGPT 套餐或工作区权限。')
            async with self.lock:
                data = self.store.load()
                selected = self.selected(data)
                if not selected or selected['client_id'] != account['client_id']:
                    raise HTTPException(409, '账号已切换，请重新加载模型列表。')
                if selected.get('model') not in {model['slug'] for model in catalog}:
                    selected['model'] = catalog[0]['slug']
                    self.store.save(data)
            return {'models': catalog, 'selected': selected['model']}
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            raise HTTPException(502, '无法加载 ChatGPT 模型列表，请稍后重试。')

    async def choose_model(self, model):
        catalog = await self.models()
        if model not in {entry['slug'] for entry in catalog['models']}:
            raise HTTPException(422, '请选择当前账号模型列表中的模型。')
        async with self.lock:
            data = self.store.load()
            self.selected(data)['model'] = model
            self.store.save(data)
        return self.status()

    async def select_account(self, client_id):
        async with self.lock:
            data = self.store.load()
            if not any(a['client_id'] == client_id for a in data['accounts']):
                raise HTTPException(404, '保存的账号不存在。')
            self.pending = None
            self.last_error = None
            data['selected'] = client_id
            self.store.save(data)
        return self.status()

    async def logout(self):
        confirmed = False
        async with self.lock:
            data = self.store.load()
            account = self.selected(data)
            self.pending = None
            if account:
                try:
                    endpoints = await self.endpoints()
                    if account.get('refresh_token'):
                        async with httpx.AsyncClient(timeout=15) as client:
                            response = await client.post(endpoints['revocation_endpoint'], data={'token': account['refresh_token'], 'token_type_hint': 'refresh_token', 'client_id': account['client_id']})
                        confirmed = response.status_code == 200
                    else:
                        confirmed = True
                except (HTTPException, httpx.HTTPError):
                    pass
                self.clear_tokens(account)
                self.store.save(data)
            else:
                confirmed = True
            self.last_error = None
        return {'revoked': confirmed, 'message': '已退出 ChatGPT 登录，做题记录仍然保留。' if confirmed else '已退出本机登录，但未确认远程撤销。可以到 ChatGPT 设置中断开知序的授权。'}

    async def infer(self, instructions, messages):
        account = await self.access()
        if not account.get('model'):
            await self.models()
            account = await self.access()
        model = account['model']
        text = []
        completed = False
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(150, connect=20)) as client:
                async with client.stream('POST', f'{RESOURCE}/responses', headers={'Authorization': f'Bearer {account["access_token"]}'}, json={'model': model, 'instructions': instructions, 'input': messages, 'store': False, 'stream': True}) as response:
                    if response.status_code >= 400:
                        await response.aread()
                        try:
                            payload = response.json()
                        except ValueError:
                            payload = {}
                        raise safe_error(response.status_code, payload, response.headers.get('x-request-id'))
                    # SSE can contain multiple data lines and arbitrary transport chunking.
                    event_data = []
                    async for line in response.aiter_lines():
                        if line.startswith('data:'):
                            event_data.append(line[5:].lstrip())
                        elif line == '' and event_data:
                            raw = '\n'.join(event_data)
                            event_data = []
                            if raw == '[DONE]':
                                continue
                            event = json.loads(raw)
                            kind = event.get('type')
                            if kind == 'response.output_text.delta':
                                delta = event.get('delta')
                                if isinstance(delta, str):
                                    text.append(delta)
                            elif kind in ['response.failed', 'error']:
                                event_response = event.get('response') or {}
                                error = event_response.get('error') or event.get('error') or {'code': event.get('code')}
                                code = error.get('code') if isinstance(error, dict) else None
                                status = 429 if code == 'subscription_sharing_usage_limit_exceeded' else 503 if code == 'subscription_sharing_usage_unavailable' else 502
                                raise safe_error(status, {'error': error}, response.headers.get('x-request-id'))
                            elif kind == 'response.incomplete':
                                raise HTTPException(502, 'ChatGPT 回复未完成，请重试；本次提示进度没有改变。')
                            elif kind == 'response.completed':
                                completed = True
                    if not completed or not ''.join(text).strip():
                        raise HTTPException(502, 'ChatGPT 回复中断或为空，请重试；本次提示进度没有改变。')
            return ''.join(text)
        except httpx.TimeoutException:
            raise HTTPException(504, 'ChatGPT 回复超时，请稍后重试；本次提示进度没有改变。')
        except (httpx.HTTPError, ValueError, TypeError):
            raise HTTPException(502, 'ChatGPT 回复连接中断，请重试；本次提示进度没有改变。')


auth = ChatGPTAuth()
router = APIRouter()


class LoginInput(BaseModel):
    account_id: str | None = Field(default=None, max_length=256)
    add_account: bool = False
    reconsent: bool = False


class ModelInput(BaseModel):
    model: str = Field(min_length=1, max_length=160)


class AccountInput(BaseModel):
    account_id: str = Field(min_length=1, max_length=256)


def check_local_origin(request):
    origin = request.headers.get('origin')
    if origin:
        parsed = urlparse(origin)
        ports = [int(os.getenv('ZHIXU_FRONTEND_PORT', '3000')), int(os.getenv('CHATGPT_CALLBACK_PORT', '8000'))]
        if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or parsed.port not in ports:
            raise HTTPException(403, '请从本机 http://127.0.0.1:3000 发起授权操作。')


@router.get('/api/auth/status')
def status():
    return auth.status()


@router.post('/api/auth/start')
async def start(body: LoginInput, request: Request, response: Response):
    check_local_origin(request)
    browser_id = secrets.token_urlsafe(32)
    redirect_uri = f'http://127.0.0.1:{os.getenv("CHATGPT_CALLBACK_PORT", "8000")}/auth/callback'
    url = await auth.start(browser_id, redirect_uri, body.account_id, body.add_account, body.reconsent)
    ticket = secrets.token_urlsafe(32)
    auth.pending['authorization_url'] = url
    auth.pending['ticket'] = ticket
    response.set_cookie(COOKIE, browser_id, httponly=True, samesite='lax', max_age=600, path='/')
    response.headers['Cache-Control'] = 'no-store'
    return {'authorization_url': '/api/auth/authorize?' + urlencode({'ticket': ticket})}


@router.get('/api/auth/authorize')
async def authorize(request: Request):
    ticket = request.query_params.get('ticket', '')
    request.scope['query_string'] = b''
    async with auth.lock:
        pending = auth.pending
        cookie = request.cookies.get(COOKIE, '')
        if not pending or pending['expires_at'] <= time.time() or not secrets.compare_digest(ticket, pending.get('ticket', '')) or not cookie or not secrets.compare_digest(cookie, pending['browser_id']):
            raise HTTPException(400, '授权入口已过期，请从知序重新登录。')
        # Consume the browser-launch ticket once. OAuth callback state remains pending.
        url = pending.pop('authorization_url')
        pending['ticket'] = secrets.token_urlsafe(32)
    return RedirectResponse(url, status_code=303, headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'})


@router.get('/auth/callback')
async def callback(request: Request):
    # Never reflect/log the incoming callback, code, ID token, or provider error text.
    query = dict(request.query_params)
    request.scope['query_string'] = b''
    frontend_url = f'http://127.0.0.1:{int(os.getenv("ZHIXU_FRONTEND_PORT", "3000"))}/?view=settings'
    try:
        await auth.complete(query, request.cookies.get(COOKIE))
        state = auth.status()
        message = '账号授权已完成。回到知序，选择模型就可以开始做题。' if state['plan_enabled'] else state['error']
        title, code = 'ChatGPT 登录完成', 200
    except HTTPException as error:
        message, title, code = str(error.detail), '授权尚未完成', error.status_code
    page = f'''<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title><style>body{{background:#EEF4F9;color:#24303C;font-family:system-ui;margin:0;display:grid;place-items:center;min-height:100vh}}main{{max-width:460px;padding:38px;background:white;border:1px solid #D5E0EA;border-radius:16px;margin:24px}}h1{{font-size:22px}}p{{line-height:1.9;color:#667788}}a{{display:inline-block;background:#2E5B8A;color:white;padding:12px 20px;border-radius:8px;text-decoration:none}}</style><main><h1>{html.escape(title)}</h1><p>{html.escape(message)}</p><a href="{frontend_url}">返回知序</a><p>也可以关闭本页，回到刚才的学习设置页面。</p></main></html>'''
    response = HTMLResponse(page, status_code=code, headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"})
    response.delete_cookie(COOKIE, path='/')
    return response


@router.get('/api/auth/models')
async def models():
    return await auth.models()


@router.put('/api/auth/model')
async def choose_model(body: ModelInput, request: Request):
    check_local_origin(request)
    return await auth.choose_model(body.model)


@router.post('/api/auth/account')
async def select_account(body: AccountInput, request: Request):
    check_local_origin(request)
    return await auth.select_account(body.account_id)


@router.post('/api/auth/cancel')
async def cancel(request: Request):
    check_local_origin(request)
    async with auth.lock:
        auth.pending = None
        auth.last_error = None
    return auth.status()


@router.post('/api/auth/logout')
async def logout(request: Request):
    check_local_origin(request)
    return await auth.logout()
