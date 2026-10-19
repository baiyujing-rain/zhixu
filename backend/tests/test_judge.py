import json

from backend.examples import starter

ACCEPTED = '''class Solution:
    def twoSum(self, nums: list[int], target: int) -> list[int]:
        seen = {}
        for i, value in enumerate(nums):
            need = target - value
            if need in seen:
                return [seen[need], i]
            seen[value] = i
        return []
'''

WRONG = '''class Solution:
    def twoSum(self, nums, target):
        return [0, 0]
'''

INFINITE = '''class Solution:
    def twoSum(self, nums, target):
        while True:
            pass
'''

DANGEROUS_IMPORT = '''import os

class Solution:
    def twoSum(self, nums, target):
        return [0, 1]
'''

RUNTIME_ERROR = '''class Solution:
    def twoSum(self, nums, target):
        return nums[999]
'''

LOUD = '''class Solution:
    def twoSum(self, nums, target):
        print('x' * 30000)
        seen = {}
        for i, value in enumerate(nums):
            need = target - value
            if need in seen:
                return [seen[need], i]
            seen[value] = i
        return []
'''


def new_record(client, language='python', example_id='two-sum', content=None):
    payload = {'language': language}
    if example_id:
        payload['example_id'] = example_id
    else:
        payload['content'] = content or '给定一个数组，找出和为目标值的两个数的下标。示例：nums = [2,7], target = 9，返回 [0,1]。'
    response = client.post('/api/sessions', json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def set_code(client, item, code, language=None):
    language = language or item['language']
    response = client.patch(
        f"/api/sessions/{item['id']}",
        json={'language': language, 'code': code, 'expected_code': item['drafts'][language]},
    )
    assert response.status_code == 200, response.text
    return response.json()


def judge(client, item, language=None, expected_code=None):
    language = language or item['language']
    expected = item['drafts'][language] if expected_code is None else expected_code
    return client.post(f"/api/sessions/{item['id']}/judge", json={'language': language, 'expected_code': expected})


def test_judge_accepts_correct_solution(client):
    item = set_code(client, new_record(client), ACCEPTED)
    response = judge(client, item)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['verdict'] == 'accepted'
    assert body['passed'] == body['total'] == 3
    assert all(case['passed'] for case in body['cases'])
    assert '本地缓解措施' in body['verification']


def test_judge_reports_wrong_answer(client):
    item = set_code(client, new_record(client), WRONG)
    body = judge(client, item).json()
    assert body['verdict'] == 'wrong_answer'
    assert body['passed'] == 0 and body['total'] == 3
    assert body['cases'][0]['expected'] == [0, 1]
    assert body['cases'][0]['actual'] == [0, 0]


def test_judge_rejects_language_mismatch_with_409(client):
    item = new_record(client, language='python')
    response = client.post(
        f"/api/sessions/{item['id']}/judge",
        json={'language': 'cpp', 'expected_code': item['drafts']['python']},
    )
    assert response.status_code == 409


def test_judge_rejects_cpp_with_422(client):
    item = new_record(client, language='cpp')
    response = judge(client, item)
    assert response.status_code == 422
    assert '仅支持 Python' in response.json()['detail']


def test_judge_rejects_starter_template_with_422(client):
    item = new_record(client, language='python')
    assert item['drafts']['python'] == starter('python', 'two-sum')
    response = judge(client, item)
    assert response.status_code == 422
    assert '完整解法' in response.json()['detail']


def test_judge_rejects_pasted_problem_with_422(client):
    item = new_record(client, language='python', example_id=None)
    response = judge(client, item)
    assert response.status_code == 422
    assert '内置示例题' in response.json()['detail']


def test_judge_rejects_mismatched_expected_code_with_409(client):
    item = set_code(client, new_record(client), ACCEPTED)
    response = client.post(
        f"/api/sessions/{item['id']}/judge",
        json={'language': 'python', 'expected_code': item['drafts']['python'] + '\n# changed'},
    )
    assert response.status_code == 409


def test_judge_times_out_infinite_loop(client):
    item = set_code(client, new_record(client), INFINITE)
    body = judge(client, item).json()
    assert body['verdict'] == 'error'
    assert '4 秒' in body['error']


def test_judge_rejects_dangerous_import(client):
    item = set_code(client, new_record(client), DANGEROUS_IMPORT)
    body = judge(client, item).json()
    assert body['verdict'] == 'setup_error'
    assert 'PermissionError' in body['error']
    assert 'os' in body['error']


def test_judge_reports_clean_per_case_runtime_error(client):
    item = set_code(client, new_record(client), RUNTIME_ERROR)
    body = judge(client, item).json()
    assert body['verdict'] == 'wrong_answer'
    assert body['passed'] == 0 and body['total'] == 3
    assert body['cases'][0]['passed'] is False
    assert 'IndexError' in body['cases'][0]['error']
    assert '异常退出' not in json.dumps(body, ensure_ascii=False)


def test_judge_returns_valid_truncated_result_for_loud_prints(client):
    item = set_code(client, new_record(client), LOUD)
    body = judge(client, item).json()
    assert body['verdict'] == 'accepted'
    assert body['passed'] == 3 and body['total'] == 3
    assert body['cases'][0]['stdout'].startswith('x' * 100)
    assert '没有返回有效结果' not in json.dumps(body, ensure_ascii=False)
    assert len(body['cases'][0]['stdout']) == 30001
