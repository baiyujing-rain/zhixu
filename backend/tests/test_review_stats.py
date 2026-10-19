from datetime import datetime, timedelta, timezone

from backend import review

NOW = datetime(2026, 10, 13, 16, 0, tzinfo=timezone.utc)


def new_record(client, example_id='two-sum', language='python', content=None):
    payload = {'language': language}
    if example_id:
        payload['example_id'] = example_id
    else:
        payload['content'] = content or '给定一个数组，找出和为目标值的两个数的下标。示例：nums = [2,7], target = 9。'
    response = client.post('/api/sessions', json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def enroll(client, item):
    response = client.post(f"/api/sessions/{item['id']}/review-plan")
    assert response.status_code == 200, response.text
    return response.json()


def rate(client, item, rating, version):
    response = client.post(
        f"/api/sessions/{item['id']}/reviews",
        json={'rating': rating, 'expected_version': version},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_review_curve_is_ordered_and_carries_ordinal_and_current_step(client, monkeypatch):
    monkeypatch.setattr(review, 'review_clock', lambda: NOW)
    item = new_record(client)
    enroll(client, item)
    rate(client, item, 'good', 0)
    monkeypatch.setattr(review, 'review_clock', lambda: NOW + timedelta(days=1))
    rate(client, item, 'easy', 1)

    body = client.get(f"/api/sessions/{item['id']}/review-curve").json()
    assert body['session_id'] == item['id']
    assert body['title'] == '两数之和'
    assert body['day_steps'] == [1, 3, 7, 14, 30]
    assert body['current_step'] == 3
    assert len(body['points']) == 2
    assert body['points'][0]['rating'] == 'good' and body['points'][0]['rating_ordinal'] == 2
    assert body['points'][1]['rating'] == 'easy' and body['points'][1]['rating_ordinal'] == 3
    first = datetime.fromisoformat(body['points'][0]['reviewed_at'])
    second = datetime.fromisoformat(body['points'][1]['reviewed_at'])
    assert first == NOW and second == NOW + timedelta(days=1)
    assert body['points'][1]['interval_minutes'] == 7 * 1440


def test_review_curve_empty_has_zero_current_step(client):
    item = new_record(client)
    body = client.get(f"/api/sessions/{item['id']}/review-curve").json()
    assert body['points'] == []
    assert body['current_step'] == 0
    assert body['day_steps'] == [1, 3, 7, 14, 30]


def test_weaknesses_aggregates_tags_and_uncategorised(client, monkeypatch):
    monkeypatch.setattr(review, 'review_clock', lambda: NOW)
    two_sum = new_record(client, example_id='two-sum')          # 数组 / 哈希表
    parentheses = new_record(client, example_id='valid-parentheses')  # 字符串 / 栈
    pasted = new_record(client, example_id=None)                # 未分类
    for item, rating in [(two_sum, 'again'), (parentheses, 'good'), (pasted, 'again')]:
        enroll(client, item)
        rate(client, item, rating, 0)

    body = client.get('/api/reviews/weaknesses').json()
    assert body['total_events'] == 3
    by_tag = {axis['tag']: axis for axis in body['axes']}
    assert set(by_tag) == {'数组', '哈希表', '字符串', '栈', '未分类'}
    assert by_tag['数组']['event_count'] == 1
    assert by_tag['数组']['again_count'] == 1 and by_tag['数组']['again_rate'] == 1.0
    assert by_tag['字符串']['again_count'] == 0 and by_tag['字符串']['again_rate'] == 0.0
    assert by_tag['未分类']['event_count'] == 1 and by_tag['未分类']['again_rate'] == 1.0
    assert by_tag['哈希表']['session_count'] == 1
    # Stable ordering: event_count descending, then tag name ascending.
    assert [axis['event_count'] for axis in body['axes']] == sorted([axis['event_count'] for axis in body['axes']], reverse=True)


def test_weaknesses_empty(client):
    body = client.get('/api/reviews/weaknesses').json()
    assert body['total_events'] == 0
    assert body['axes'] == []
    assert 'again 占比' in body['note']
