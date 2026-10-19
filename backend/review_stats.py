"""Read-only aggregates for the review memory curve and weakness radar."""
from fastapi import APIRouter, Depends
from sqlalchemy import select

from backend.review import DAY_STEPS, utc

RATING_ORDINAL = {'again': 0, 'hard': 1, 'good': 2, 'easy': 3}


def review_stats_router(db, LearningSession, ReviewEvent, get_session):
    router = APIRouter(tags=['review-stats'])

    @router.get('/api/sessions/{id}/review-curve')
    def review_curve(id: int, session=Depends(db)):
        item = get_session(id, session)
        events = session.scalars(
            select(ReviewEvent)
            .where(ReviewEvent.session_id == id)
            .order_by(ReviewEvent.reviewed_at.asc(), ReviewEvent.id.asc())
        ).all()
        points = [{
            'reviewed_at': utc(event.reviewed_at),
            'rating': event.rating,
            'rating_ordinal': RATING_ORDINAL.get(event.rating, 0),
            'step': event.step,
            'interval_minutes': event.interval_minutes,
        } for event in events]
        return {
            'session_id': id,
            'title': item.title,
            'tags': item.tags or [],
            'current_step': events[-1].step if events else 0,
            'day_steps': list(DAY_STEPS),
            'points': points,
        }

    @router.get('/api/reviews/weaknesses')
    def weaknesses(session=Depends(db)):
        rows = session.execute(
            select(ReviewEvent, LearningSession)
            .join(LearningSession, LearningSession.id == ReviewEvent.session_id)
        ).all()

        event_count = {}
        again_count = {}
        step_sum = {}
        session_sets = {}
        for event, item in rows:
            tags = [tag for tag in (item.tags or []) if isinstance(tag, str) and tag.strip()]
            if not tags:
                tags = ['未分类']
            for tag in tags:
                event_count[tag] = event_count.get(tag, 0) + 1
                if event.rating == 'again':
                    again_count[tag] = again_count.get(tag, 0) + 1
                step_sum[tag] = step_sum.get(tag, 0) + (event.step or 0)
                session_sets.setdefault(tag, set()).add(item.id)

        axes = []
        for tag in event_count:
            count = event_count[tag]
            again = again_count.get(tag, 0)
            axes.append({
                'tag': tag,
                'event_count': count,
                'session_count': len(session_sets.get(tag, set())),
                'again_count': again,
                'again_rate': round(again / count, 4) if count else 0.0,
                'avg_step': round(step_sum.get(tag, 0) / count, 1) if count else 0.0,
            })
        axes.sort(key=lambda axis: (-axis['event_count'], axis['tag']))

        return {
            'total_events': len(rows),
            'axes': axes,
            'note': 'again 占比越高、平均步数越低，代表该题型越需要巩固。',
        }

    return router
