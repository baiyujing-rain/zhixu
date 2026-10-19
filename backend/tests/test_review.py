from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from backend import main, review

NOW = datetime(2026, 10, 13, 16, 0, tzinfo=timezone.utc)

def new_record(client):
    response = client.post('/api/sessions', json={'example_id': 'two-sum', 'language': 'python'})
    assert response.status_code == 201
    return response.json()

@pytest.mark.parametrize('step, expected', [
    (0, {'again': (0, 10), 'hard': (0, 1440), 'good': (1, 1440), 'easy': (2, 4320)}),
    (1, {'again': (0, 10), 'hard': (1, 1440), 'good': (2, 4320), 'easy': (3, 10080)}),
    (2, {'again': (0, 10), 'hard': (2, 1440), 'good': (3, 10080), 'easy': (4, 20160)}),
    (3, {'again': (0, 10), 'hard': (3, 1440), 'good': (4, 20160), 'easy': (4, 43200)}),
    (4, {'again': (0, 10), 'hard': (4, 1440), 'good': (4, 43200), 'easy': (4, 43200)}),
])
def test_transparent_fixed_schedule_for_every_step_and_rating(step, expected):
    for rating, result in expected.items(): assert review.schedule(step, rating) == result
    with pytest.raises(ValueError): review.schedule(-1, 'good')
    with pytest.raises(ValueError): review.schedule(5, 'good')
    with pytest.raises(ValueError): review.schedule(step, 'unknown')


def test_review_is_explicit_idempotent_and_never_changes_code_hint_stage_or_mastery(client, monkeypatch):
    monkeypatch.setattr(review, 'review_clock', lambda: NOW)
    item = new_record(client)
    path = f'/api/sessions/{item["id"]}'
    assert client.get('/api/reviews').json()['stats'] == {'scheduled': 0, 'due': 0, 'reviewed_today': 0}
    plan = client.post(path + '/review-plan').json()
    assert plan['due'] and plan['version'] == 0 and plan['next_good_days'] == 1
    again = client.post(path + '/review-plan').json()
    assert again['version'] == 0 and client.get('/api/reviews').json()['stats']['scheduled'] == 1
    graded = client.post(path + '/reviews', json={'rating': 'good', 'expected_version': 0, 'note': '先查询补数，再记录当前元素。'})
    assert graded.status_code == 201
    assert graded.json()['plan']['next_good_days'] == 3
    assert datetime.fromisoformat(graded.json()['plan']['due_at']) == NOW + timedelta(days=1)
    unchanged = client.get(path).json()
    for key in ['drafts', 'messages', 'stage', 'status', 'notes']: assert unchanged[key] == item[key]
    assert client.get('/api/reviews').json()['stats'] == {'scheduled': 1, 'due': 0, 'reviewed_today': 1}
    assert len(client.get(path + '/reviews').json()) == 1
    assert client.post(path + '/reviews', json={'rating': 'easy', 'expected_version': 0}).status_code == 409
    assert client.get(path + '/reviews').json()[0]['note'] == '先查询补数，再记录当前元素。'
    assert client.post(path + '/reviews', json={'rating': 'easy'}).status_code == 422


def test_again_resets_interval_and_today_counter_uses_beijing_day_boundary(client, monkeypatch):
    before = NOW - timedelta(minutes=1)
    monkeypatch.setattr(review, 'review_clock', lambda: before)
    item = new_record(client); path = f'/api/sessions/{item["id"]}'
    client.post(path + '/review-plan')
    graded = client.post(path + '/reviews', json={'rating': 'easy', 'expected_version': 0}).json()
    assert graded['plan']['step'] == 2
    monkeypatch.setattr(review, 'review_clock', lambda: NOW + timedelta(minutes=1))
    assert client.get('/api/reviews').json()['stats']['reviewed_today'] == 0
    graded = client.post(path + '/reviews', json={'rating': 'again', 'expected_version': 1}).json()
    assert graded['plan']['step'] == 0 and graded['event']['interval_minutes'] == 10
    assert client.get('/api/reviews').json()['stats']['reviewed_today'] == 1
    monkeypatch.setattr(review, 'review_clock', lambda: NOW + timedelta(minutes=12))
    assert client.get('/api/reviews').json()['stats']['due'] == 1


def test_pause_keeps_history_reenroll_resets_plan_and_problem_deletion_cleans_dependents(client):
    item = new_record(client); path = f'/api/sessions/{item["id"]}'
    client.post(path + '/review-plan')
    client.post(path + '/reviews', json={'rating': 'hard', 'expected_version': 0})
    assert client.delete(path + '/review-plan?version=0').status_code == 409
    assert client.delete(path + '/review-plan?version=1').status_code == 204
    assert client.get(path + '/review-plan').json() is None
    assert len(client.get(path + '/reviews').json()) == 1
    plan = client.post(path + '/review-plan').json()
    assert plan['step'] == 0 and plan['version'] == 0
    client.delete(path)
    with main.SessionLocal() as session:
        assert session.get(main.ReviewPlan, item['id']) is None
        assert list(session.scalars(main.select(main.ReviewEvent))) == []


def test_concurrent_self_ratings_are_recorded_once(client, monkeypatch):
    item = new_record(client); path = f'/api/sessions/{item["id"]}'
    client.post(path + '/review-plan')
    barrier = Barrier(2)
    # Synchronize both reads using the SQLAlchemy row-load event.
    from sqlalchemy import event
    def loaded(record, context):
        if isinstance(record, main.ReviewPlan): barrier.wait(timeout=5)
    event.listen(main.ReviewPlan, 'load', loaded)
    try:
        def send(rating): return client.post(path + '/reviews', json={'rating': rating, 'expected_version': 0})
        with ThreadPoolExecutor(max_workers=2) as pool: results = list(pool.map(send, ['good', 'easy']))
    finally: event.remove(main.ReviewPlan, 'load', loaded)
    assert sorted(response.status_code for response in results) == [201, 409]
    assert len(client.get(path + '/reviews').json()) == 1


def test_archive_v2_preserves_review_plan_and_history_and_accepts_v1_files(client, monkeypatch):
    from backend.archive import digest
    monkeypatch.setattr(review, 'review_clock', lambda: NOW)
    item = new_record(client); path = f'/api/sessions/{item["id"]}'
    client.post(path + '/review-plan')
    client.post(path + '/reviews', json={'rating': 'good', 'expected_version': 0, 'note': '记住了一个关键不变式。'})
    archive = client.get('/api/data/export').json()
    assert archive['payload']['version'] == 2
    assert len(archive['payload']['sessions'][0]['review']['events']) == 1
    client.delete(path)
    plan = client.post('/api/data/preview', json=archive).json()
    response = client.post('/api/data/import', json={'archive': archive, 'source_ids': [item['id']], 'preview_hash': plan['preview_hash']})
    assert response.status_code == 201
    restored_id = response.json()['imported'][0]['id']
    assert client.get(f'/api/sessions/{restored_id}/review-plan').json()['step'] == 1
    history = client.get(f'/api/sessions/{restored_id}/reviews').json()
    assert len(history) == 1 and history[0]['note'] == '记住了一个关键不变式。'
    assert client.post('/api/data/preview', json=archive).json()['duplicate_count'] == 1
    # A genuine older format has no review field. Its original checksum remains valid.
    legacy = client.get('/api/data/export').json()
    legacy['payload']['version'] = 1
    for record in legacy['payload']['sessions']: record.pop('review')
    legacy['checksum'] = digest(legacy['payload'])
    assert client.post('/api/data/preview', json=legacy).status_code == 200
    legacy['payload']['version'] = 99
    legacy['checksum'] = digest(legacy['payload'])
    assert client.post('/api/data/preview', json=legacy).status_code == 422
