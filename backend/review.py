"""Explicit self-rated review schedules. No inferred mastery or AI grading."""
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, delete, func, select, update
from sqlalchemy.orm import Mapped, mapped_column

DAY_STEPS = (1, 3, 7, 14, 30)
Rating = Literal['again', 'hard', 'good', 'easy']

def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)

def review_clock():
    return datetime.now(timezone.utc)

def schedule(step: int, rating: Rating):
    if not 0 <= step < len(DAY_STEPS) or rating not in ('again', 'hard', 'good', 'easy'):
        raise ValueError('Invalid review state')
    if rating == 'again': return 0, 10
    if rating == 'hard': return step, 1440
    offset = 1 if rating == 'easy' else 0
    days = DAY_STEPS[min(step + offset, len(DAY_STEPS) - 1)]
    return min(step + offset + 1, len(DAY_STEPS) - 1), days * 1440

def review_models(base):
    class ReviewPlan(base):
        __tablename__ = 'review_plans'
        session_id: Mapped[int] = mapped_column(ForeignKey('learning_sessions.id'), primary_key=True)
        step: Mapped[int] = mapped_column(Integer, default=0)
        version: Mapped[int] = mapped_column(Integer, default=0)
        due_at: Mapped[datetime] = mapped_column(DateTime)
        enrolled_at: Mapped[datetime] = mapped_column(DateTime)
        last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    class ReviewEvent(base):
        __tablename__ = 'review_events'
        id: Mapped[int] = mapped_column(primary_key=True)
        session_id: Mapped[int] = mapped_column(ForeignKey('learning_sessions.id'), index=True)
        rating: Mapped[str] = mapped_column(String(10))
        note: Mapped[str] = mapped_column(Text, default='')
        reviewed_at: Mapped[datetime] = mapped_column(DateTime, index=True)
        next_due_at: Mapped[datetime] = mapped_column(DateTime)
        interval_minutes: Mapped[int] = mapped_column(Integer)
        step: Mapped[int] = mapped_column(Integer)
    return ReviewPlan, ReviewEvent

class ReviewInput(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    rating: Rating
    expected_version: int = Field(ge=0)
    note: str = Field(default='', max_length=3000)

def review_router(db, LearningSession, ReviewPlan, ReviewEvent, get_session, write_session):
    router = APIRouter(tags=['review'])
    def serialize_plan(plan, now=None):
        now = now or review_clock()
        return {'session_id': plan.session_id, 'step': plan.step, 'version': plan.version,
            'due_at': utc(plan.due_at), 'enrolled_at': utc(plan.enrolled_at),
            'last_reviewed_at': utc(plan.last_reviewed_at) if plan.last_reviewed_at else None,
            'due': utc(plan.due_at) <= now, 'next_good_days': DAY_STEPS[plan.step],
            'next_easy_days': DAY_STEPS[min(plan.step + 1, len(DAY_STEPS) - 1)]}
    def serialize_event(event):
        return {**{key: getattr(event, key) for key in ['id', 'session_id', 'rating', 'note', 'interval_minutes', 'step']},
            'reviewed_at': utc(event.reviewed_at), 'next_due_at': utc(event.next_due_at)}

    @router.get('/api/reviews')
    def overview(session=Depends(db)):
        now = review_clock()
        counts = dict(session.execute(select(ReviewEvent.session_id, func.count()).group_by(ReviewEvent.session_id)).all())
        entries = []
        for plan, item in session.execute(select(ReviewPlan, LearningSession).join(LearningSession, LearningSession.id == ReviewPlan.session_id).order_by(ReviewPlan.due_at, ReviewPlan.session_id)):
            entries.append({**serialize_plan(plan, now), **{key: getattr(item, key) for key in ['title', 'language', 'stage', 'status']}, 'created_at': utc(item.created_at), 'review_count': counts.get(item.id, 0)})
        china = timezone(timedelta(hours=8))
        day = now.astimezone(china).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
        reviewed = session.scalar(select(func.count(func.distinct(ReviewEvent.session_id))).where(ReviewEvent.reviewed_at >= day, ReviewEvent.reviewed_at <= now)) or 0
        return {'entries': entries, 'now': now, 'stats': {'scheduled': len(entries), 'due': sum(item['due'] for item in entries), 'reviewed_today': reviewed}, 'day_timezone': 'Asia/Shanghai'}

    @router.get('/api/sessions/{id}/review-plan')
    def current_plan(id: int, session=Depends(db)):
        get_session(id, session)
        plan = session.get(ReviewPlan, id)
        return serialize_plan(plan) if plan else None

    @router.post('/api/sessions/{id}/review-plan')
    def enroll(id: int, session=Depends(db)):
        item = get_session(id, session)
        existing = session.get(ReviewPlan, id)
        if existing: return serialize_plan(existing)
        now = review_clock()
        write_session(item, {}, session)
        plan = ReviewPlan(session_id=id, step=0, version=0, due_at=now, enrolled_at=now)
        session.add(plan); session.commit()
        return serialize_plan(plan, now)

    @router.delete('/api/sessions/{id}/review-plan', status_code=204)
    def pause(id: int, version: int = Query(ge=0), session=Depends(db)):
        item = get_session(id, session)
        plan = session.get(ReviewPlan, id)
        if not plan or plan.version != version:
            raise HTTPException(409, '复习计划已改变，请刷新列表；已有复习记录没有删除。')
        write_session(item, {}, session)
        result = session.execute(delete(ReviewPlan).where(ReviewPlan.session_id == id, ReviewPlan.version == version))
        if result.rowcount != 1:
            session.rollback(); raise HTTPException(409, '复习计划已改变，请刷新列表。')
        session.commit()

    @router.get('/api/sessions/{id}/reviews')
    def history(id: int, session=Depends(db)):
        get_session(id, session)
        events = session.scalars(select(ReviewEvent).where(ReviewEvent.session_id == id).order_by(ReviewEvent.reviewed_at.desc(), ReviewEvent.id.desc()).limit(100))
        return [serialize_event(event) for event in events]

    @router.post('/api/sessions/{id}/reviews', status_code=201)
    def rate(id: int, body: ReviewInput, session=Depends(db)):
        item = get_session(id, session)
        plan = session.get(ReviewPlan, id)
        if not plan or plan.version != body.expected_version:
            raise HTTPException(409, '复习计划已改变，请刷新列表再记录；本次没有重复计入复习。')
        now = review_clock()
        next_step, minutes = schedule(plan.step, body.rating)
        due_at = now + timedelta(minutes=minutes)
        write_session(item, {}, session)
        result = session.execute(update(ReviewPlan).where(ReviewPlan.session_id == id, ReviewPlan.version == body.expected_version).values(
            step=next_step, version=body.expected_version + 1, due_at=due_at, last_reviewed_at=now).execution_options(synchronize_session=False))
        if result.rowcount != 1:
            session.rollback(); raise HTTPException(409, '复习计划已改变，请刷新列表。')
        event = ReviewEvent(session_id=id, rating=body.rating, note=body.note.strip(), reviewed_at=now, next_due_at=due_at, interval_minutes=minutes, step=next_step)
        session.add(event); session.commit(); session.refresh(plan)
        return {'plan': serialize_plan(plan, now), 'event': serialize_event(event)}
    return router
