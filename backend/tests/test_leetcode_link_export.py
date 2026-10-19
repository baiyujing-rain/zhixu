"""Integration tests for LeetCode problem linking and Markdown export."""
from backend import leetcode


def create(client, content):
    response = client.post('/api/sessions', json={'content': content, 'language': 'cpp'})
    assert response.status_code == 201, response.text
    return response.json()


def test_offline_detects_frontend_id_but_has_no_source_url(client):
    item = create(client, '1. 两数之和\n\n给定一个整数数组 nums 和目标值 target，请找出和为目标值的两个整数。')
    assert item['leetcode'] is not None
    assert item['leetcode']['frontend_id'] == '1'
    assert item['leetcode']['title'] == '两数之和'
    assert item['leetcode']['source_url'] is None
    assert item['leetcode']['slug'] is None


def test_offline_title_strips_number_for_all_prefix_forms(client):
    cases = [
        ('LeetCode 1. 两数之和', '1', '两数之和'),
        ('LC 167. 两数之和 II', '167', '两数之和 II'),
        ('力扣 167 两数之和 II', '167', '两数之和 II'),
        ('167. 两数之和 II', '167', '两数之和 II'),
    ]
    for text, expected_id, expected_title in cases:
        item = create(client, f'{text}\n\n给定一个整数数组 nums 和目标值 target，请找出两个数。')
        assert item['leetcode']['frontend_id'] == expected_id, text
        assert item['leetcode']['title'] == expected_title, text


def test_offline_detects_slug_and_builds_source_url(client):
    item = create(client, 'https://leetcode.cn/problems/two-sum/\n\n给定一个整数数组 nums 和目标值 target，请找出两个数。')
    assert item['leetcode']['slug'] == 'two-sum'
    assert item['leetcode']['source_url'] == 'https://leetcode.cn/problems/two-sum/'


def test_link_endpoint_fills_source_url_and_difficulty(client, monkeypatch):
    item = create(client, '1. 两数之和\n\n给定一个整数数组 nums 和目标值 target，请找出两个数。')
    assert item['leetcode']['source_url'] is None

    async def fake_search(value, site='cn'):
        return {'problem': {'site': site, 'slug': 'two-sum', 'frontend_id': '1', 'title': '两数之和',
            'source_url': 'https://leetcode.cn/problems/two-sum/', 'difficulty': '简单'}, 'candidates': []}

    monkeypatch.setattr(leetcode.leetcode, 'search', fake_search)
    linked = client.post(f"/api/sessions/{item['id']}/leetcode/link", json={'site': 'cn'})
    assert linked.status_code == 200
    data = linked.json()
    assert data['leetcode']['source_url'] == 'https://leetcode.cn/problems/two-sum/'
    assert data['leetcode']['difficulty'] == '简单'
    assert data['leetcode']['frontend_id'] == '1'
    assert data['leetcode']['title'] == '两数之和'


def test_export_markdown_returns_attachment_with_expected_sections(client):
    item = create(client, '两数之和问题\n\n给定一个整数数组 nums 和目标值 target，请找出两个数并返回下标。')
    response = client.get(f"/api/sessions/{item['id']}/export.md")
    assert response.status_code == 200
    assert 'text/markdown' in response.headers['content-type']
    assert 'attachment' in response.headers['content-disposition']
    body = response.text
    assert item['title'] in body
    assert '## 题目' in body
    assert '## 我的代码' in body
    assert '## 思路过程（与教练的对话）' in body
    assert '## 复杂度分析' in body
    assert '## 复盘笔记' in body
    assert '尚未填写复盘笔记。' in body


def test_plain_text_does_not_misidentify_a_problem_number(client):
    item = create(client, '给定一个整数数组，找出和为目标值的两个数并返回它们的下标。')
    assert item['leetcode'] is None
