import os
import tempfile

import pytest
from backend import main

def new_example(client, language='cpp', example='two-sum'):
    response = client.post('/api/sessions', json={'example_id': example, 'language': language})
    assert response.status_code == 201
    return response.json()

def test_hint_ladder_does_not_reveal_solution(client):
    item = new_example(client)
    for stage in range(1, 5):
        response = client.post(f'/api/sessions/{item["id"]}/coach', json={'action': 'hint'})
        assert response.status_code == 200
        result = response.json()
        assert result['stage'] == stage
        assert 'vector<int> twoSum' not in result['messages'][-1]['content']
    again = client.post(f'/api/sessions/{item["id"]}/coach', json={'action': 'hint'}).json()
    assert again['stage'] == 4
    assert '主动点击' in again['messages'][-1]['content']

def test_solution_uses_selected_language(client):
    item = new_example(client)
    first = client.post(f'/api/sessions/{item["id"]}/coach', json={'action': 'solution'}).json()
    assert '```cpp' in first['messages'][-1]['content']
    client.patch(f'/api/sessions/{item["id"]}', json={'language': 'python'})
    second = client.post(f'/api/sessions/{item["id"]}/coach', json={'action': 'solution'}).json()
    assert '```python' in second['messages'][-1]['content']

def test_code_and_notes_survive_reload_and_language_switch(client):
    item = new_example(client)
    path = f'/api/sessions/{item["id"]}'
    client.patch(path, json={'code': '// cpp draft', 'notes': '先查后存'})
    client.patch(path, json={'language': 'python', 'code': '# python draft'})
    fresh = client.get(path).json()
    assert fresh['drafts']['cpp'] == '// cpp draft'
    assert fresh['drafts']['python'] == '# python draft'
    assert fresh['notes'] == '先查后存'

def test_arbitrary_problem_without_key_fails_without_advancing(client):
    item = client.post('/api/sessions', json={'content': '合并两个有序链表，返回一个新的有序链表。输入可以包含空链表。'}).json()
    response = client.post(f'/api/sessions/{item["id"]}/coach', json={'action': 'hint'})
    assert response.status_code == 409
    unchanged = client.get(f'/api/sessions/{item["id"]}').json()
    assert unchanged['stage'] == 0
    assert len(unchanged['messages']) == 1

def test_ai_prompt_contains_profile_and_language(client, monkeypatch):
    client.put('/api/profile', json={'language': 'python', 'level': 'beginner', 'style': 'example'})
    item = new_example(client, 'python')
    monkeypatch.setenv('AI_API_KEY', 'test-key')
    captured = {}
    async def fake_post(self, url, **kwargs):
        captured.update(kwargs)
        return main.httpx.Response(200, json={'choices': [{'message': {'content': '先用 [2,7] 走一遍。'}}]})
    monkeypatch.setattr(main.httpx.AsyncClient, 'post', fake_post)
    response = client.post(f'/api/sessions/{item["id"]}/coach', json={'action': 'ask', 'message': '请给我一个例子'})
    assert response.status_code == 200
    prompt = captured['json']['messages'][0]['content']
    assert 'Python 3' in prompt and 'beginner' in prompt and 'example' in prompt
    assert '先用' in response.json()['messages'][-1]['content']

def test_failed_provider_keeps_existing_progress(client, monkeypatch):
    item = new_example(client)
    monkeypatch.setenv('AI_API_KEY', 'test-key')
    async def fake_post(self, url, **kwargs):
        return main.httpx.Response(401, json={'error': 'invalid key'})
    monkeypatch.setattr(main.httpx.AsyncClient, 'post', fake_post)
    response = client.post(f'/api/sessions/{item["id"]}/coach', json={'action': 'review'})
    assert response.status_code == 502
    assert len(client.get(f'/api/sessions/{item["id"]}').json()['messages']) == 1

def test_validation_and_deletion(client):
    assert client.post('/api/sessions', json={'content': '   '}).status_code == 422
    assert client.post('/api/sessions', json={'example_id': 'missing'}).status_code == 422
    item = new_example(client)
    assert client.post(f'/api/sessions/{item["id"]}/coach', json={'action': 'ask', 'message': ''}).status_code == 422
    assert client.get('/api/sessions/99999').status_code == 404
    assert client.delete(f'/api/sessions/{item["id"]}').status_code == 204
    assert client.get(f'/api/sessions/{item["id"]}').status_code == 404

def test_recap_respects_hint_depth(client):
    item = new_example(client)
    client.post(f'/api/sessions/{item["id"]}/coach', json={'action': 'hint'})
    result = client.post(f'/api/sessions/{item["id"]}/coach', json={'action': 'recap'}).json()
    assert '先把问题' in result['messages'][-1]['content']
    assert '哈希表' not in result['messages'][-1]['content']
    assert result['stage'] == 1

def test_settings_never_return_secret_and_preserve_existing_key(client, monkeypatch, tmp_path):
    monkeypatch.setattr(main, 'ROOT', tmp_path)
    response = client.put('/api/settings', json={'base_url': 'https://example.com/v1', 'model': 'test-model', 'api_key': 'a-secret-value'})
    assert response.status_code == 200
    assert response.json()['configured'] is True
    assert 'a-secret-value' not in response.text
    client.put('/api/settings', json={'base_url': 'https://example.com/v1', 'model': 'other-model'})
    assert os.getenv('AI_API_KEY') == 'a-secret-value'
    assert 'a-secret-value' not in client.get('/api/settings').text
    # These settings mutations remain confined to this test's process and directory.
    monkeypatch.delenv('AI_BASE_URL', raising=False)
    monkeypatch.delenv('AI_MODEL', raising=False)


def optimization_fixture():
    return {
        'assessment': 'correct', 'summary': '双重循环可以用哈希表减少重复查找。', 'variables': ['n 是数组长度'],
        'current': {'time': '最坏 O(n²)', 'space': 'O(1)', 'time_reason': '枚举 n(n-1)/2 对下标。', 'space_reason': '只维护固定数量的下标，输出大小固定。'},
        'target': {'time': '平均 O(n)，最坏 O(n²)', 'space': 'O(n)', 'time_reason': '遍历一次，哈希表查询平均 O(1)，最坏可能退化。', 'space_reason': '最多记录 n 个数值与下标，输出大小固定。'},
        'bottlenecks': ['重复扫描另一个数的位置。'], 'steps': ['记录已出现的值及下标。', '先查补数，再记录当前数。'],
        'changes': ['用 seen 和 need 表示映射与补数。'], 'tradeoffs': ['用 O(n) 额外空间换取平均线性时间。'],
        'checks': ['[3,3]，target=6：返回两个不同下标。', '[-2,7,5]，target=3：负数也能配对。', '[1,2,3,4]，target=7：答案位于末尾。'],
        'proof': '查询时哈希表仅记录之前的元素，找到的两个下标不同且和为目标。',
        'optimized_code': 'class Solution:\n    def twoSum(self, nums, target):\n        seen = {}\n        for i, value in enumerate(nums):\n            need = target - value\n            if need in seen:\n                return [seen[need], i]\n            seen[value] = i\n        return []',
    }


def new_optimization_session(client):
    item = new_example(client, 'python')
    code = 'class Solution:\n    def twoSum(self, nums, target):\n        for i in range(len(nums)):\n            for j in range(i + 1, len(nums)):\n                if nums[i] + nums[j] == target:\n                    return [i, j]'
    client.patch(f'/api/sessions/{item["id"]}', json={'code': code})
    return item, code


def test_optimization_preserves_draft_hint_progress_and_stores_both_versions(client, monkeypatch):
    import json
    item, code = new_optimization_session(client)
    async def reply(instruction, messages):
        assert 'Python 3' in instruction and '哈希操作不能声称最坏 O(1)' in instruction
        assert code in messages[0]['content']
        return json.dumps(optimization_fixture(), ensure_ascii=False)
    monkeypatch.setattr(main, 'generate_reply', reply)
    first = client.post(f'/api/sessions/{item["id"]}/optimize', json={'phase': 'analyze', 'goal': 'time', 'passed': True})
    assert first.status_code == 201
    analysis = first.json()
    assert analysis['data']['optimized_code'] is None  # a model can't accidentally reveal the full code in phase one
    second = client.post(f'/api/sessions/{item["id"]}/optimize', json={'phase': 'refine', 'goal': 'time', 'analysis_id': analysis['id']})
    assert second.status_code == 201 and 'seen = {}' in second.json()['data']['optimized_code']
    retained = client.get(f'/api/sessions/{item["id"]}').json()
    assert retained['drafts']['python'] == code and retained['stage'] == 0
    assert len(retained['messages']) == 1
    history = client.get(f'/api/sessions/{item["id"]}/optimizations').json()
    assert len(history) == 2 and all(report['input_code'] == code for report in history)
    client.delete(f'/api/sessions/{item["id"]}')
    with main.SessionLocal() as db:
        assert list(db.scalars(main.select(main.OptimizationReport).where(main.OptimizationReport.session_id == item['id']))) == []


def test_refine_rejects_changed_code_goal_or_language(client, monkeypatch):
    import json
    item, code = new_optimization_session(client)
    async def reply(instruction, messages): return json.dumps(optimization_fixture())
    monkeypatch.setattr(main, 'generate_reply', reply)
    analysis = client.post(f'/api/sessions/{item["id"]}/optimize', json={'phase': 'analyze'}).json()
    refine = {'phase': 'refine', 'analysis_id': analysis['id']}
    assert client.post(f'/api/sessions/{item["id"]}/optimize', json={**refine, 'goal': 'space'}).status_code == 409
    client.patch(f'/api/sessions/{item["id"]}', json={'code': code + '\n# changed'})
    assert client.post(f'/api/sessions/{item["id"]}/optimize', json=refine).status_code == 409
    client.patch(f'/api/sessions/{item["id"]}', json={'language': 'cpp', 'code': '// C++ complete draft\nclass Solution { public: int test() { return 1; } };'})
    assert client.post(f'/api/sessions/{item["id"]}/optimize', json=refine).status_code == 409


def test_optimization_rejects_skeletons_missing_analysis_and_incomplete_model_output(client, monkeypatch):
    item = new_example(client)
    path = f'/api/sessions/{item["id"]}/optimize'
    assert client.post(path, json={}).status_code == 422
    client.patch(f'/api/sessions/{item["id"]}', json={'code': '// A complete C++ draft\nclass Solution { public: int test() { return 1; } };'})
    assert client.post(path, json={'phase': 'refine'}).status_code == 422
    async def invalid_reply(instruction, messages): return 'This is not a structured analysis.'
    monkeypatch.setattr(main, 'generate_reply', invalid_reply)
    assert client.post(path, json={}).status_code == 502
    assert client.get(f'/api/sessions/{item["id"]}/optimizations').json() == []


def test_refine_cannot_reference_another_problem_and_reports_fail_atomically(client, monkeypatch):
    import json
    first, _ = new_optimization_session(client)
    second, _ = new_optimization_session(client)
    async def reply(instruction, messages): return json.dumps(optimization_fixture())
    monkeypatch.setattr(main, 'generate_reply', reply)
    analysis = client.post(f'/api/sessions/{first["id"]}/optimize', json={}).json()
    response = client.post(f'/api/sessions/{second["id"]}/optimize', json={'phase': 'refine', 'analysis_id': analysis['id']})
    assert response.status_code == 422
    async def failed_reply(instruction, messages): raise main.HTTPException(429, '模型额度不足')
    monkeypatch.setattr(main, 'generate_reply', failed_reply)
    assert client.post(f'/api/sessions/{first["id"]}/optimize', json={}).status_code == 429
    assert len(client.get(f'/api/sessions/{first["id"]}/optimizations').json()) == 1


def test_cpp_optimization_prompt_and_report_keep_cpp_language(client, monkeypatch):
    import json
    from backend.examples import EXAMPLES
    item = new_example(client, 'cpp')
    brute = 'class Solution { public: vector<int> twoSum(vector<int>& a, int target) { for (int i=0; i<a.size(); ++i) for (int j=i+1; j<a.size(); ++j) if (a[i]+a[j]==target) return {i,j}; return {}; } };'
    client.patch(f'/api/sessions/{item["id"]}', json={'code': brute})
    async def cpp_reply(instruction, messages):
        assert 'C++17' in instruction and '优先降低时间复杂度' in instruction
        assert brute in messages[0]['content']
        report = optimization_fixture()
        report['optimized_code'] = EXAMPLES['two-sum']['cpp']
        return json.dumps(report)
    monkeypatch.setattr(main, 'generate_reply', cpp_reply)
    analysis = client.post(f'/api/sessions/{item["id"]}/optimize', json={'goal': 'time'}).json()
    refined = client.post(f'/api/sessions/{item["id"]}/optimize', json={'phase': 'refine', 'goal': 'time', 'analysis_id': analysis['id']})
    assert refined.status_code == 201
    assert refined.json()['language'] == 'cpp'
    assert 'unordered_map<int, int>' in refined.json()['data']['optimized_code']
    assert client.get(f'/api/sessions/{item["id"]}').json()['drafts']['cpp'] == brute


def test_deepseek_settings_preserve_other_credentials_and_hide_secrets(client, monkeypatch, tmp_path):
    monkeypatch.setattr(main, 'ROOT', tmp_path)
    monkeypatch.setenv('AI_API_KEY', 'existing-other-key')
    monkeypatch.delenv('DEEPSEEK_API_KEY', raising=False)
    monkeypatch.delenv('DEEPSEEK_MODEL', raising=False)
    assert client.put('/api/settings/deepseek', json={}).status_code == 422
    response = client.put('/api/settings/deepseek', json={'api_key': 'deepseek-test-secret', 'model': 'deepseek-flash'})
    assert response.status_code == 200 and response.json()['provider'] == 'deepseek'
    assert response.json()['deepseek_configured'] and 'deepseek-test-secret' not in response.text
    assert os.getenv('AI_API_KEY') == 'existing-other-key'
    assert client.put('/api/settings/deepseek', json={'model': 'deepseek-v4-pro'}).status_code == 200
    assert os.getenv('DEEPSEEK_API_KEY') == 'deepseek-test-secret'
    assert client.put('/api/settings/provider', json={'provider': 'deepseek_web'}).json()['configured']
    assert 'deepseek-test-secret' not in client.get('/api/settings').text
    # set_key writes only the isolated test directory; remove new variables on teardown.
    monkeypatch.delenv('DEEPSEEK_API_KEY', raising=False)
    monkeypatch.delenv('DEEPSEEK_MODEL', raising=False)


def test_web_transfer_is_persistent_consumed_once_and_never_calls_api(client, monkeypatch):
    monkeypatch.setenv('AI_PROVIDER', 'deepseek_web')
    async def forbidden(*args): raise AssertionError('Web handoff must not call an API')
    monkeypatch.setattr(main, 'generate_reply', forbidden)
    item = new_example(client, 'python')
    task = client.post(f'/api/sessions/{item["id"]}/coach', json={'action': 'hint'}).json()
    assert task['external'] and 'Python 3' in task['prompt'] and '理解题目' in task['prompt']
    assert client.get(f'/api/sessions/{item["id"]}').json()['stage'] == 0
    assert client.get(f'/api/sessions/{item["id"]}/external').json()['id'] == task['id']
    path = f'/api/sessions/{item["id"]}/external/{task["id"]}'
    assert client.post(path, json={'reply': '   '}).status_code == 422
    imported = client.post(path, json={'reply': '先手算一个例子，返回的是下标。'}).json()
    assert imported['stage'] == 1 and imported['messages'][-1]['source'] == 'deepseek_web'
    assert client.get(f'/api/sessions/{item["id"]}/external').json() is None
    assert client.post(path, json={'reply': '重复导入'}).status_code == 404


def test_web_transfer_rejects_stale_and_cross_session_reply_and_deletes_tasks(client):
    first = new_example(client)
    second = new_example(client)
    task = client.post(f'/api/sessions/{first["id"]}/external/coach', json={'action': 'review'}).json()
    assert client.post(f'/api/sessions/{second["id"]}/external/{task["id"]}', json={'reply': '错误题目'}).status_code == 404
    client.patch(f'/api/sessions/{first["id"]}', json={'language': 'python'})
    assert client.post(f'/api/sessions/{first["id"]}/external/{task["id"]}', json={'reply': '旧语言回复'}).status_code == 409
    assert len(client.get(f'/api/sessions/{first["id"]}').json()['messages']) == 1
    client.delete(f'/api/sessions/{first["id"]}')
    with main.SessionLocal() as session:
        assert session.get(main.ExternalExchange, task['id']) is None


def test_web_optimization_import_validates_json_and_keeps_two_phases(client):
    import json
    item, code = new_optimization_session(client)
    base = f'/api/sessions/{item["id"]}'
    task = client.post(base + '/external/optimize', json={'phase': 'analyze'}).json()
    path = base + '/external/' + task['id']
    assert client.post(path, json={'reply': 'not JSON'}).status_code == 422
    assert client.get(base + '/optimizations').json() == []
    assert client.get(base + '/external').json()['id'] == task['id']
    report = client.post(path, json={'reply': '```json\n' + json.dumps(optimization_fixture()) + '\n```'}).json()
    assert report['id'] and report['data']['optimized_code'] is None
    task = client.post(base + '/external/optimize', json={'phase': 'refine', 'analysis_id': report['id']}).json()
    refined = client.post(base + '/external/' + task['id'], json={'reply': json.dumps(optimization_fixture())}).json()
    assert 'seen = {}' in refined['data']['optimized_code']
    assert client.get(base).json()['drafts']['python'] == code
    assert len(client.get(base + '/optimizations').json()) == 2


def test_deepseek_api_uses_official_endpoint_and_handles_balance_without_progress(client, monkeypatch):
    import httpx
    monkeypatch.setenv('AI_PROVIDER', 'deepseek')
    monkeypatch.setenv('DEEPSEEK_API_KEY', 'fake-deepseek-key')
    monkeypatch.setenv('DEEPSEEK_MODEL', 'deepseek-flash')
    captured = []
    class FakeClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, url, headers, json):
            captured.append((url, headers, json))
            return httpx.Response(200, json={'choices': [{'message': {'content': '检查循环边界。'}}]})
    monkeypatch.setattr(main.httpx, 'AsyncClient', FakeClient)
    item = new_example(client)
    response = client.post(f'/api/sessions/{item["id"]}/coach', json={'action': 'review'})
    assert response.status_code == 200
    url, headers, payload = captured[0]
    assert url == 'https://api.deepseek.com/chat/completions'
    assert headers['Authorization'] == 'Bearer fake-deepseek-key'
    assert payload['model'] == 'deepseek-flash' and payload['thinking']['type'] == 'disabled'
    async def insufficient(self, *args, **kwargs): return httpx.Response(402)
    monkeypatch.setattr(FakeClient, 'post', insufficient)
    before = client.get(f'/api/sessions/{item["id"]}').json()
    response = client.post(f'/api/sessions/{item["id"]}/coach', json={'action': 'ask', 'message': '下一步呢？'})
    assert response.status_code == 402 and '网页版' in response.json()['detail']
    assert client.get(f'/api/sessions/{item["id"]}').json()['messages'] == before['messages']


def test_draft_expected_code_prevents_overwriting_another_window(client):
    item = new_example(client)
    path = f'/api/sessions/{item["id"]}'
    original = item['drafts']['cpp']
    first = client.patch(path, json={'language': 'cpp', 'code': '// first window', 'expected_code': original})
    assert first.status_code == 200
    stale = client.patch(path, json={'language': 'cpp', 'code': '// stale window', 'expected_code': original})
    assert stale.status_code == 409
    assert client.get(path).json()['drafts']['cpp'] == '// first window'
    assert client.get(path).json()['drafts']['python'] == item['drafts']['python']
    assert client.patch(path, json={'expected_code': original}).status_code == 422


def test_concurrent_draft_writes_compare_and_update_atomically(client, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    item = new_example(client)
    barrier = Barrier(2)
    get_session = main.get_session
    def rendezvous(id, session):
        record = get_session(id, session)
        barrier.wait(timeout=5)
        return record
    monkeypatch.setattr(main, 'get_session', rendezvous)
    def save(code):
        return client.patch(f'/api/sessions/{item["id"]}', json={'language': 'cpp', 'code': code, 'expected_code': item['drafts']['cpp']})
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, ['// window A', '// window B']))
    assert sorted(response.status_code for response in results) == [200, 409]
    monkeypatch.setattr(main, 'get_session', get_session)
    retained = client.get(f'/api/sessions/{item["id"]}').json()
    assert retained['drafts']['cpp'] in ['// window A', '// window B']
    assert retained['drafts']['python'] == item['drafts']['python']


@pytest.mark.parametrize('operation', ['coach', 'optimize'])
@pytest.mark.parametrize('mutation', ['code', 'notes', 'delete'])
def test_ai_result_cannot_overwrite_changes_made_during_generation(client, monkeypatch, operation, mutation):
    import json
    item, code = new_optimization_session(client)
    path = f'/api/sessions/{item["id"]}'
    async def reply(instruction, messages):
        import asyncio
        if mutation == 'delete':
            assert (await asyncio.to_thread(client.delete, path)).status_code == 204
        else:
            assert (await asyncio.to_thread(client.patch, path, json={mutation: 'changed while AI was thinking'})).status_code == 200
        return json.dumps(optimization_fixture()) if operation == 'optimize' else 'Old review of the previous code'
    monkeypatch.setattr(main, 'generate_reply', reply)
    response = client.post(path + '/' + operation, json={} if operation == 'optimize' else {'action': 'review'})
    assert response.status_code == 409
    if mutation == 'delete':
        assert client.get(path).status_code == 404
        with main.SessionLocal() as session:
            assert list(session.scalars(main.select(main.OptimizationReport))) == []
    else:
        retained = client.get(path).json()
        assert len(retained['messages']) == 1 and retained['stage'] == 0
        assert client.get(path + '/optimizations').json() == []
        assert retained['drafts']['python'] == ('changed while AI was thinking' if mutation == 'code' else code)
        if mutation == 'notes': assert retained['notes'] == 'changed while AI was thinking'


@pytest.mark.parametrize('operation', ['coach', 'optimize'])
def test_two_ai_requests_commit_at_most_one_result_for_same_version(client, monkeypatch, operation):
    import json
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    item, _ = new_optimization_session(client)
    barrier = Barrier(2)
    async def reply(instruction, messages):
        import asyncio
        await asyncio.to_thread(barrier.wait, timeout=5)
        return json.dumps(optimization_fixture()) if operation == 'optimize' else 'A review response'
    monkeypatch.setattr(main, 'generate_reply', reply)
    path = f'/api/sessions/{item["id"]}'
    def send(_): return client.post(path + '/' + operation, json={} if operation == 'optimize' else {'action': 'review'})
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(send, range(2)))
    assert sorted(result.status_code for result in results) == [201 if operation == 'optimize' else 200, 409]
    assert len(client.get(path + '/optimizations').json()) == (1 if operation == 'optimize' else 0)
    assert len(client.get(path).json()['messages']) == (1 if operation == 'optimize' else 3)


def test_concurrent_external_import_consumes_reply_exactly_once(client, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    item = new_example(client)
    path = f'/api/sessions/{item["id"]}'
    task = client.post(path + '/external/coach', json={'action': 'hint'}).json()
    barrier = Barrier(2)
    snapshot = main.exchange_snapshot
    def rendezvous(record):
        value = snapshot(record)
        barrier.wait(timeout=5)
        return value
    monkeypatch.setattr(main, 'exchange_snapshot', rendezvous)
    def send(_): return client.post(path + '/external/' + task['id'], json={'reply': 'One hint only'})
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(send, range(2)))
    assert sorted(result.status_code for result in results) == [200, 404]
    retained = client.get(path).json()
    assert retained['stage'] == 1 and len(retained['messages']) == 3
    assert client.get(path + '/external').json() is None


def test_full_solution_followed_by_hint_never_regresses_progress_or_calls_model(client, monkeypatch):
    item = new_example(client)
    path = f'/api/sessions/{item["id"]}'
    assert client.post(path + '/coach', json={'action': 'solution'}).json()['stage'] == 5
    async def forbidden(*args): raise AssertionError('Completed hints need no new AI request')
    monkeypatch.setattr(main, 'generate_reply', forbidden)
    result = client.post(path + '/coach', json={'action': 'hint'})
    assert result.status_code == 200 and result.json()['stage'] == 5
    assert '四层提示' in result.json()['messages'][-1]['content']



def test_learning_archive_round_trip_preserves_code_notes_messages_reports_and_profile(client, monkeypatch):
    import json
    item, code = new_optimization_session(client)
    path = f'/api/sessions/{item["id"]}'
    client.patch(path, json={'notes': '关键：查询补数后再插入，不能重复使用当前位置。', 'status': 'mastered'})
    client.post(path + '/coach', json={'action': 'hint'})
    async def reply(*args): return json.dumps(optimization_fixture())
    monkeypatch.setattr(main, 'generate_reply', reply)
    analysis = client.post(path + '/optimize', json={}).json()
    client.post(path + '/optimize', json={'phase': 'refine', 'analysis_id': analysis['id']})
    client.put('/api/profile', json={'language': 'python', 'level': 'intermediate', 'style': 'example'})
    response = client.get('/api/data/export')
    assert response.status_code == 200 and 'attachment' in response.headers['content-disposition']
    archive = response.json()
    assert archive['payload']['format'] == 'zhixu.learning-backup'
    record = archive['payload']['sessions'][0]
    assert record['drafts']['python'] == code and len(record['optimizations']) == 2
    client.delete(path)
    client.put('/api/profile', json={'language': 'cpp', 'level': 'beginner', 'style': 'guided'})
    plan = client.post('/api/data/preview', json=archive)
    assert plan.status_code == 200 and plan.json()['new_count'] == 1
    response = client.post('/api/data/import', json={'archive': archive, 'source_ids': [item['id']], 'preview_hash': plan.json()['preview_hash'], 'restore_profile': True})
    assert response.status_code == 201 and len(response.json()['imported']) == 1
    restored = client.get('/api/sessions/' + str(response.json()['imported'][0]['id'])).json()
    assert restored['drafts'] == record['drafts'] and restored['notes'] == record['notes']
    assert restored['messages'] == [{key: value for key, value in message.items() if value is not None} for message in record['messages']]
    assert restored['stage'] == record['stage'] and restored['status'] == 'mastered'
    reports = client.get(f'/api/sessions/{restored["id"]}/optimizations').json()
    assert sorted(report['data']['optimized_code'] is None for report in reports) == [False, True]
    assert client.get('/api/profile').json() == archive['payload']['profile']
    again = client.post('/api/data/preview', json=archive).json()
    assert again['duplicate_count'] == 1 and again['new_count'] == 0
    repeated = client.post('/api/data/import', json={'archive': archive, 'source_ids': [item['id']], 'preview_hash': again['preview_hash']})
    assert repeated.status_code == 201 and repeated.json()['imported'] == []
    assert len(repeated.json()['skipped']) == 1 and len(client.get('/api/sessions').json()) == 1


def test_archive_never_contains_credentials_and_preferences_restore_is_optional(client, monkeypatch):
    monkeypatch.setenv('AI_API_KEY', 'secret-not-exportable')
    monkeypatch.setenv('DEEPSEEK_API_KEY', 'another-secret-not-exportable')
    item = new_example(client)
    client.put('/api/profile', json={'language': 'python', 'level': 'intermediate', 'style': 'example'})
    response = client.get('/api/data/export')
    assert 'secret-not-exportable' not in response.text and 'credentials' not in response.text and 'api_key' not in response.text
    archive = response.json()
    client.put('/api/profile', json={'language': 'cpp', 'level': 'beginner', 'style': 'guided'})
    plan = client.post('/api/data/preview', json=archive).json()
    result = client.post('/api/data/import', json={'archive': archive, 'source_ids': [item['id']], 'preview_hash': plan['preview_hash']})
    assert result.status_code == 201 and not result.json()['profile_restored']
    assert client.get('/api/profile').json()['language'] == 'cpp'
    plan = client.post('/api/data/preview', json=archive).json()
    result = client.post('/api/data/import', json={'archive': archive, 'source_ids': [], 'preview_hash': plan['preview_hash'], 'restore_profile': True})
    assert result.status_code == 201 and result.json()['profile_restored']
    assert client.get('/api/profile').json()['language'] == 'python'


def test_archive_import_preserves_changed_existing_record_and_requires_fresh_preview(client):
    item = new_example(client)
    path = f'/api/sessions/{item["id"]}'
    archive = client.get('/api/data/export').json()
    plan = client.post('/api/data/preview', json=archive).json()
    client.patch(path, json={'notes': 'new note written after backup'})
    stale = client.post('/api/data/import', json={'archive': archive, 'source_ids': [item['id']], 'preview_hash': plan['preview_hash']})
    assert stale.status_code == 409 and len(client.get('/api/sessions').json()) == 1
    plan = client.post('/api/data/preview', json=archive).json()
    assert plan['new_count'] == 1
    response = client.post('/api/data/import', json={'archive': archive, 'source_ids': [item['id']], 'preview_hash': plan['preview_hash']})
    assert response.status_code == 201
    assert client.get(path).json()['notes'] == 'new note written after backup'
    restored_id = response.json()['imported'][0]['id']
    assert restored_id != item['id'] and client.get(f'/api/sessions/{restored_id}').json()['notes'] == ''


def test_archive_rejects_corruption_unknown_fields_invalid_selection_and_size_without_writes(client, monkeypatch):
    import copy
    from backend import archive as module
    item = new_example(client)
    archive = client.get('/api/data/export').json()
    damaged = copy.deepcopy(archive)
    damaged['payload']['sessions'][0]['notes'] = 'changed without checksum'
    assert client.post('/api/data/preview', json=damaged).status_code == 422
    damaged = copy.deepcopy(archive)
    damaged['payload']['credentials'] = {'token': 'fake'}
    assert client.post('/api/data/preview', json=damaged).status_code == 422
    damaged = copy.deepcopy(archive)
    damaged['payload']['sessions'][0]['stage'] = 10
    damaged['checksum'] = module.digest(damaged['payload'])
    assert client.post('/api/data/preview', json=damaged).status_code == 422
    plan = client.post('/api/data/preview', json=archive).json()
    assert client.post('/api/data/import', json={'archive': archive, 'source_ids': [999999], 'preview_hash': plan['preview_hash']}).status_code == 422
    assert client.post('/api/data/import', json={'archive': archive, 'source_ids': [item['id'], item['id']], 'preview_hash': plan['preview_hash']}).status_code == 422
    monkeypatch.setattr(module, 'MAX_ARCHIVE_BYTES', 100)
    assert client.post('/api/data/preview', json=archive).status_code == 413
    assert len(client.get('/api/sessions').json()) == 1


def test_archive_import_is_atomic_if_a_later_record_cannot_be_written(client):
    from sqlalchemy import event
    first = new_example(client)
    second = new_example(client, example='valid-parentheses')
    archive = client.get('/api/data/export').json()
    client.delete(f'/api/sessions/{first["id"]}'); client.delete(f'/api/sessions/{second["id"]}')
    plan = client.post('/api/data/preview', json=archive).json()
    def fail_second(mapper, connection, record):
        if record.title == second['title']: raise main.HTTPException(422, 'Injected second-record failure')
    event.listen(main.LearningSession, 'before_insert', fail_second)
    try:
        response = client.post('/api/data/import', json={'archive': archive, 'source_ids': [first['id'], second['id']], 'preview_hash': plan['preview_hash']})
        assert response.status_code == 422
    finally: event.remove(main.LearningSession, 'before_insert', fail_second)
    assert client.get('/api/sessions').json() == []


def test_concurrent_archive_imports_do_not_duplicate_records(client):
    from concurrent.futures import ThreadPoolExecutor
    item = new_example(client)
    archive = client.get('/api/data/export').json()
    client.delete(f'/api/sessions/{item["id"]}')
    plan = client.post('/api/data/preview', json=archive).json()
    def send(_): return client.post('/api/data/import', json={'archive': archive, 'source_ids': [item['id']], 'preview_hash': plan['preview_hash']})
    with ThreadPoolExecutor(max_workers=2) as pool: results = list(pool.map(send, range(2)))
    assert sorted(response.status_code for response in results) == [201, 409]
    assert len(client.get('/api/sessions').json()) == 1



def test_notes_expected_version_rejects_stale_window_and_preserves_both_code_drafts(client):
    item = new_example(client)
    path = f'/api/sessions/{item["id"]}'
    first = client.patch(path, json={'notes': 'first reflection', 'expected_notes': ''})
    assert first.status_code == 200
    stale = client.patch(path, json={'notes': 'stale reflection', 'expected_notes': ''})
    assert stale.status_code == 409
    assert client.get(path).json()['notes'] == 'first reflection'
    assert client.get(path).json()['drafts'] == item['drafts']
    assert client.patch(path, json={'expected_notes': 'first reflection'}).status_code == 422



def test_deleted_record_id_reuse_cannot_redirect_stale_window_writes(client):
    old = new_example(client)
    path = f'/api/sessions/{old["id"]}'
    client.delete(path)
    fresh = new_example(client, example='valid-parentheses')
    assert fresh['id'] == old['id']  # reproduces SQLite INTEGER PRIMARY KEY reuse
    origin = {'X-Zhixu-Record-Created-At': old['created_at']}
    for operation in ['PATCH', 'DELETE']:
        response = client.request(operation, path, headers=origin, json={'code': '// stale window code'} if operation == 'PATCH' else None)
        assert response.status_code == 409
    assert client.post(path + '/coach', headers=origin, json={'action': 'hint'}).status_code == 409
    assert client.post(path + '/external/coach', headers=origin, json={'action': 'hint'}).status_code == 409
    assert client.get(path).json()['drafts'] == fresh['drafts']
    assert client.get(path).json()['stage'] == 0
    assert client.patch(path, headers={'X-Zhixu-Record-Created-At': fresh['created_at']}, json={'notes': 'fresh record note'}).status_code == 200
    assert client.patch(path, headers={'X-Zhixu-Record-Created-At': 'not-a-date'}, json={'notes': 'invalid'}).status_code == 422



@pytest.mark.parametrize('operation', ['coach', 'optimize', 'external/coach', 'external/optimize'])
@pytest.mark.parametrize('changed', ['language', 'code'])
def test_model_requests_require_the_code_and_language_the_user_is_viewing(client, monkeypatch, operation, changed):
    item, code = new_optimization_session(client)
    async def forbidden(*args): raise AssertionError('A mismatched editor must not call AI')
    monkeypatch.setattr(main, 'generate_reply', forbidden)
    body = {'language': 'cpp' if changed == 'language' else 'python', 'expected_code': code + '\n# stale' if changed == 'code' else code}
    if operation.endswith('coach'): body['action'] = 'review'
    response = client.post(f'/api/sessions/{item["id"]}/{operation}', json=body)
    assert response.status_code == 409 and '没有调用 AI' in response.json()['detail']
    assert client.get(f'/api/sessions/{item["id"]}').json()['stage'] == 0
    assert client.get(f'/api/sessions/{item["id"]}/optimizations').json() == []
    assert client.get(f'/api/sessions/{item["id"]}/external').json() is None
