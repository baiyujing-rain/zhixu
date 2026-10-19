"""LeetCode's normal web endpoints; credentials never leave their selected site."""
import json
import os
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse, quote

import httpx
from fastapi import HTTPException

from backend.credential_store import CredentialStore

SITES = {'cn': 'https://leetcode.cn', 'com': 'https://leetcode.com'}
DETAIL_QUERY = '''query questionData($titleSlug: String!) {
 question(titleSlug: $titleSlug) {
  questionId questionFrontendId titleSlug title translatedTitle content translatedContent
  difficulty isPaidOnly sampleTestCase exampleTestcases metaData enableRunCode
  codeSnippets { langSlug code } topicTags { name translatedName }
 }
}'''
USER_QUERY = 'query userStatus { userStatus { isSignedIn username } }'
SEARCH_CN = '''query problemsetQuestionList($filters: QuestionListFilterInput) {
 problemsetQuestionList(categorySlug: "", skip:0, limit:30, filters:$filters) {
  questions { questionFrontendId:frontendQuestionId titleSlug title translatedTitle:titleCn difficulty }
 }
}'''
SEARCH_COM = '''query problemsetQuestionList($filters: QuestionListFilterInput) {
 problemsetQuestionList(categorySlug: "", skip:0, limit:30, filters:$filters) {
  questions { questionFrontendId:frontendQuestionId titleSlug title difficulty }
 }
}'''
DIFFICULTIES = {'EASY': '简单', 'MEDIUM': '中等', 'HARD': '困难'}


def site_url(site):
    if not isinstance(site, str) or site not in SITES: raise HTTPException(422, '请选择力扣中国站或国际站。')
    return SITES[site]


def title_slug(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,120}', value):
        raise HTTPException(422, '力扣题目地址不完整，请复制官方题目链接。')
    return value


def identify(value, default_site='cn'):
    """Extract only an allowed domain/slug; never fetch a user supplied URL."""
    site_url(default_site)
    if not isinstance(value, str) or not value.strip() or len(value) > 20000:
        raise HTTPException(422, '请粘贴题目、题号或力扣题目链接（最多 20,000 字符）。')
    match = re.search(r'https?://[^\s<>]+', value)
    if match:
        parsed = urlparse(match.group().rstrip(')）。，'))
        domains = {'leetcode.cn': 'cn', 'www.leetcode.cn': 'cn', 'leetcode.com': 'com', 'www.leetcode.com': 'com'}
        try: port = parsed.port
        except ValueError: raise HTTPException(422, '力扣链接的端口格式不正确。') from None
        if parsed.scheme != 'https' or parsed.hostname not in domains or parsed.username or parsed.password or port not in (None, 443):
            raise HTTPException(422, '请使用 HTTPS 的力扣官方题目链接。')
        parts = parsed.path.strip('/').split('/')
        if len(parts) < 2 or parts[0] != 'problems': raise HTTPException(422, '请复制力扣题目页面的链接。')
        return {'site': domains[parsed.hostname], 'slug': title_slug(parts[1])}
    first = next(line.strip().lstrip('#').strip() for line in value.splitlines() if line.strip())[:120]
    if re.fullmatch(r'[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+', first) and '\n' not in value.strip():
        return {'site': default_site, 'slug': title_slug(first)}
    number = re.match(r'^(?:(?:LC|LeetCode|力扣)\s*#?\s*)?(\d{1,6})(?=$|[.、:：)\s-])', first, re.I)
    keyword = number.group(1) if number else first
    return {'site': default_site, 'keyword': keyword, 'number': number.group(1) if number else None, 'title': re.sub(r'^\d+[.、:：)\s-]+', '', first).strip()}


class ProblemHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.pre, self.suppressed = [], False, 0
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'iframe', 'object'): self.suppressed += 1; return
        if self.suppressed: return
        attrs = dict(attrs)
        marks = {'p': '\n\n', 'div': '\n', 'br': '\n', 'li': '\n- ', 'strong': '**', 'b': '**', 'em': '*', 'sup': '^(', 'sub': '_('}
        if tag == 'pre': self.pre = True; self.parts.append('\n\n````\n')
        elif tag == 'code' and not self.pre: self.parts.append('`')
        elif tag == 'img':
            src = attrs.get('src', '')
            parsed = urlparse(src)
            if parsed.scheme == 'https' and parsed.hostname in ('assets.leetcode.com', 'assets.leetcode.cn', 'pic.leetcode.cn', 'pic.leetcode-cn.com'):
                alt = attrs.get('alt', '题目图示').replace(']', '')
                self.parts.append(f'\n\n![{alt}]({src})\n\n')
        else: self.parts.append(marks.get(tag, ''))
    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'iframe', 'object') and self.suppressed: self.suppressed -= 1; return
        if self.suppressed: return
        if tag == 'pre': self.pre = False; self.parts.append('\n````\n\n')
        elif tag == 'code' and not self.pre: self.parts.append('`')
        else: self.parts.append({'p': '\n\n', 'div': '\n', 'li': '\n', 'strong': '**', 'b': '**', 'em': '*', 'sup': ')', 'sub': ')'}.get(tag, ''))
    def handle_data(self, data):
        if not self.suppressed: self.parts.append(data)
    def markdown(self): return re.sub(r'\n{3,}', '\n\n', ''.join(self.parts)).strip()


def normalize_markdown(value):
    """Repair emphasis and whitespace emitted by LeetCode's nested HTML tags."""
    value = (re.sub(r'\*\*([^*\n]+?)\*\*\s*\*\*([^*\n]+?)\*\*', r'**\1 \2**', value)
        .replace('\u00a0', ' ')
        .replace('** ', '**')
        .replace(' **', '**')
        .replace('\t', '')
        .replace('\n\n- ', '\n- ')
        .replace('\n\n\n', '\n\n'))
    return value.replace('**', '') if '** ' in value or ' **' in value else value


def parse_problem(raw, site):
    slug = title_slug(raw.get('titleSlug'))
    html = raw.get('translatedContent') or raw.get('content') or ''
    if not html.strip(): raise HTTPException(403, '当前账号不能读取这道题的题面。请确认会员权限或在官方页面查看。')
    if len(html) > 80000: raise HTTPException(422, '题目内容超过当前导入范围，请先保存为本地题目。')
    parser = ProblemHTML(); parser.feed(html)
    content = normalize_markdown(parser.markdown())
    if not 15 <= len(content) <= 20000: raise HTTPException(422, '题目长度不在当前 15～20,000 字符范围内。')
    try: metadata = json.loads(raw.get('metaData') or '{}')
    except (ValueError, TypeError): metadata = {}
    if not isinstance(metadata, dict): metadata = {}
    snippets = {entry.get('langSlug'): entry.get('code') for entry in raw.get('codeSnippets') or [] if entry.get('langSlug') in ('cpp', 'python3') and isinstance(entry.get('code'), str) and len(entry['code']) <= 50000}
    examples = raw.get('exampleTestcases') or raw.get('sampleTestCase') or ''
    return {'site': site, 'slug': slug, 'question_id': str(raw.get('questionId') or '')[:80], 'frontend_id': str(raw.get('questionFrontendId') or '')[:40],
        'title': (raw.get('translatedTitle') or raw.get('title') or slug)[:160], 'original_title': (raw.get('title') or slug)[:160],
        'content': content, 'difficulty': DIFFICULTIES.get(str(raw.get('difficulty', '')).upper(), '未分类'),
        'tags': [(tag.get('translatedName') or tag.get('name') or '')[:80] for tag in (raw.get('topicTags') or [])[:30]],
        'code_snippets': snippets, 'metadata': metadata, 'sample_test_case': str(raw.get('sampleTestCase') or '')[:50000], 'example_testcases': str(examples)[:50000],
        'paid_only': bool(raw.get('isPaidOnly')), 'run_enabled': raw.get('enableRunCode') is not False and bool(snippets),
        'source_url': site_url(site) + '/problems/' + slug + '/', 'fetched_at': datetime.now(timezone.utc).isoformat()}


def parse_cookie(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 16000 or any(ord(char) < 32 or ord(char) > 126 for char in value):
        raise HTTPException(422, '请只粘贴 Cookie 请求头，内容必须为单行，最多 16,000 字符。')
    value = re.sub(r'^Cookie:\s*', '', value.strip(), flags=re.I)
    cookies = {}
    allowed = {'LEETCODE_SESSION', 'csrftoken', 'cf_clearance', '__cf_bm'}
    for part in value.split(';'):
        name, separator, token = part.strip().partition('=')
        if name in allowed and separator and token: cookies[name] = token
    if not cookies.get('LEETCODE_SESSION'): raise HTTPException(422, 'Cookie 中缺少 LEETCODE_SESSION，请从已登录的力扣页面复制。')
    return cookies


class LeetCodeService:
    def __init__(self, store=None, transport=None):
        default = Path(os.getenv('LOCALAPPDATA', str(Path.home() / '.local' / 'share'))) / 'Zhixu' / 'leetcode'
        self.store = store or CredentialStore(os.getenv('ZHIXU_LEETCODE_AUTH_DIR') or default)
        self.transport = transport
    def saved(self, site): return (self.store.load().get('sites') or {}).get(site)
    def status(self, site):
        site_url(site); item = self.saved(site)
        return {'site': site, 'configured': bool(item), 'username': item.get('username', '') if item else '', 'verified_at': item.get('verified_at') if item else None}
    async def request(self, site, path, body=None, cookies=None):
        base = site_url(site)
        entry = self.saved(site) if cookies is None else None
        jar = cookies if cookies is not None else (entry or {}).get('cookies', {})
        headers = {'User-Agent': 'Mozilla/5.0', 'Referer': base + '/', 'Origin': base, 'Accept': 'application/json'}
        if jar.get('csrftoken'): headers['X-CSRFToken'] = jar['csrftoken']
        try:
            async with httpx.AsyncClient(timeout=25, follow_redirects=False, cookies=jar, transport=self.transport) as client:
                if body is not None and path != '/graphql/':
                    headers['Referer'] = base + '/problems/' + path.split('/')[2] + '/'
                    if not jar.get('csrftoken'):
                        initial = await client.get(headers['Referer'], headers=headers)
                        token = client.cookies.get('csrftoken')
                        if not token: raise HTTPException(401, '没有获取到力扣校验信息，请更新包含 csrftoken 的 Cookie。')
                        headers['X-CSRFToken'] = token
                response = await client.request('GET' if body is None else 'POST', base + path, json=body, headers=headers)
        except httpx.RequestError:
            raise HTTPException(502, '连接力扣中断，请稍后重试。若是提交判题，请先到力扣查看是否已受理，避免重复提交。') from None
        if response.status_code in (401, 403): raise HTTPException(401, '力扣拒绝连接。请在官方页面重新登录或完成网页验证，再更新 Cookie。')
        if response.status_code == 429: raise HTTPException(429, '力扣请求过于频繁，请稍后再试。没有自动重复提交。')
        if response.status_code == 404: raise HTTPException(404, '没有找到对应的力扣题目或评测记录。')
        if response.status_code >= 300: raise HTTPException(502, '力扣接口暂时不可用或已变化，请稍后重试。')
        if len(response.content) > 2 * 1024 * 1024: raise HTTPException(502, '力扣返回的内容超过当前读取范围。')
        try: value = response.json()
        except ValueError: raise HTTPException(502, '力扣返回了网页验证或非 JSON 内容，请在官方页面确认登录状态。') from None
        if not isinstance(value, dict): raise HTTPException(502, '力扣返回的数据格式不完整。')
        return value
    async def graphql(self, site, query, variables=None, cookies=None):
        value = await self.request(site, '/graphql/', {'query': query, 'variables': variables or {}}, cookies)
        if value.get('errors') or not isinstance(value.get('data'), dict): raise HTTPException(502, '力扣题目信息接口已变化或未完成请求，请稍后再试。')
        return value['data']
    async def verify(self, site, cookies):
        data = await self.graphql(site, USER_QUERY, cookies=cookies)
        user = data.get('userStatus') or {}
        if user.get('isSignedIn') is not True: raise HTTPException(401, 'Cookie 未登录或已经过期，请从本人已登录的力扣页面重新复制。')
        return str(user.get('username') or '')[:100]
    async def connect(self, site, value):
        site_url(site); cookies = parse_cookie(value)
        username = await self.verify(site, cookies)
        data = self.store.load(); data.setdefault('sites', {})[site] = {'cookies': cookies, 'username': username, 'verified_at': datetime.now(timezone.utc).isoformat()}
        self.store.save(data)
        return self.status(site)
    def disconnect(self, site):
        site_url(site); data = self.store.load(); data.setdefault('sites', {}).pop(site, None); self.store.save(data)
        return self.status(site)
    async def problem(self, site, slug):
        data = await self.graphql(site, DETAIL_QUERY, {'titleSlug': title_slug(slug)})
        if not isinstance(data.get('question'), dict): raise HTTPException(404, '没有找到这道题，请核对力扣链接。')
        return parse_problem(data['question'], site)
    async def search(self, value, site='cn'):
        hint = identify(value, site)
        if hint.get('slug'): return {'problem': await self.problem(hint['site'], hint['slug']), 'candidates': []}
        data = await self.graphql(site, SEARCH_CN if site == 'cn' else SEARCH_COM, {'filters': {'searchKeywords': hint['keyword']}})
        rows = (data.get('problemsetQuestionList') or {}).get('questions') or []
        entries = [{'site': site, 'slug': title_slug(row['titleSlug']), 'frontend_id': str(row.get('questionFrontendId') or row.get('frontendQuestionId') or '')[:40],
            'title': (row.get('translatedTitle') or row.get('titleCn') or row.get('title') or '')[:160], 'difficulty': DIFFICULTIES.get(str(row.get('difficulty', '')).upper(), '未分类')} for row in rows[:30] if row.get('titleSlug')]
        exact = [row for row in entries if row['frontend_id'] == hint.get('number')] if hint.get('number') else [row for row in entries if row['title'] == hint.get('title')]
        if len(exact) == 1: return {'problem': await self.problem(site, exact[0]['slug']), 'candidates': []}
        return {'problem': None, 'candidates': exact or entries}
    async def judge(self, site, slug, question_id, language, code, mode, inputs):
        item = self.saved(site)
        if not item: raise HTTPException(401, '请先在设置中连接本人力扣账号。')
        await self.verify(site, item['cookies'])
        payload = {'question_id': question_id, 'lang': 'cpp' if language == 'cpp' else 'python3', 'typed_code': code}
        if mode == 'run': payload['data_input'] = inputs
        suffix = 'interpret_solution' if mode == 'run' else 'submit'
        value = await self.request(site, f'/problems/{title_slug(slug)}/{suffix}/', payload)
        remote_id = value.get('interpret_id' if mode == 'run' else 'submission_id')
        if remote_id is None or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', str(remote_id)):
            raise HTTPException(502, '没有收到可查询的力扣评测编号。请先在官方页面核对是否已受理，不要盲目重复提交。')
        return str(remote_id)
    async def check(self, site, remote_id):
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', remote_id): raise HTTPException(422, '评测编号不完整。')
        return await self.request(site, f'/submissions/detail/{quote(remote_id)}/check/')


leetcode = LeetCodeService()
