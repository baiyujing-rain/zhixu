"""Portable learning-only archives, with preview and transactional append."""
import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator
from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError

from backend.examples import EXAMPLES
from backend.optimization import OptimizationPayload

MAX_ARCHIVE_BYTES = 20 * 1024 * 1024

class ArchiveModel(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)

class ArchivedMessage(ArchiveModel):
    role: Literal['user', 'assistant']
    content: str = Field(max_length=120000)
    kind: str | None = Field(default=None, max_length=40)
    source: str | None = Field(default=None, max_length=40)

class ArchivedReport(ArchiveModel):
    id: int = Field(ge=1)
    language: Literal['cpp', 'python']
    goal: Literal['balanced', 'time', 'space', 'readability']
    phase: Literal['analyze', 'refine']
    input_code: str = Field(max_length=50000)
    data: OptimizationPayload
    created_at: datetime

    @model_validator(mode='after')
    def check_phase(self):
        if self.phase == 'analyze' and self.data.optimized_code is not None:
            raise ValueError('Analysis archives must not contain replacement code')
        if self.phase == 'refine' and not self.data.optimized_code:
            raise ValueError('Refined archives must contain code')
        return self

class ArchivedReviewPlan(ArchiveModel):
    step: int = Field(ge=0, le=4)
    version: int = Field(ge=0)
    due_at: datetime
    enrolled_at: datetime
    last_reviewed_at: datetime | None = None

class ArchivedReviewEvent(ArchiveModel):
    id: int = Field(ge=1)
    rating: Literal['again', 'hard', 'good', 'easy']
    note: str = Field(max_length=3000)
    reviewed_at: datetime
    next_due_at: datetime
    interval_minutes: int = Field(ge=10, le=43200)
    step: int = Field(ge=0, le=4)

class ArchivedReview(ArchiveModel):
    plan: ArchivedReviewPlan | None = None
    events: list[ArchivedReviewEvent] = Field(default_factory=list, max_length=20000)

    @model_validator(mode='after')
    def valid_dates(self):
        if len({event.id for event in self.events}) != len(self.events):
            raise ValueError('Duplicate review event identifiers')
        dates = []
        if self.plan:
            dates.extend([self.plan.due_at, self.plan.enrolled_at, self.plan.last_reviewed_at])
        for event in self.events:
            dates.extend([event.reviewed_at, event.next_due_at])
            if event.next_due_at.tzinfo is None or event.reviewed_at.tzinfo is None:
                raise ValueError('Review dates must include a timezone')
            if event.next_due_at - event.reviewed_at != timedelta(minutes=event.interval_minutes):
                raise ValueError('Review interval does not match its dates')
        if any(value is not None and value.tzinfo is None for value in dates):
            raise ValueError('Review dates must include a timezone')
        return self

class ArchivedSession(ArchiveModel):
    id: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=160)
    content: str = Field(min_length=15, max_length=20000)
    language: Literal['cpp', 'python']
    example_id: str | None = Field(default=None, max_length=40)
    difficulty: str = Field(max_length=20)
    tags: list[str] = Field(max_length=30)
    stage: int = Field(ge=0, le=5)
    status: Literal['learning', 'mastered']
    drafts: dict[Literal['cpp', 'python'], str]
    messages: list[ArchivedMessage] = Field(max_length=10000)
    notes: str = Field(max_length=10000)
    created_at: datetime
    updated_at: datetime
    optimizations: list[ArchivedReport] = Field(default_factory=list, max_length=1000)
    review: ArchivedReview | None = None

    @model_validator(mode='after')
    def check_record(self):
        if set(self.drafts) != {'cpp', 'python'} or any(len(code) > 50000 for code in self.drafts.values()):
            raise ValueError('Both bounded language drafts are required')
        if any(not tag.strip() or len(tag) > 80 for tag in self.tags):
            raise ValueError('Invalid tags')
        if self.example_id and (self.example_id not in EXAMPLES or self.content != EXAMPLES[self.example_id]['content']):
            raise ValueError('Example content does not match its identifier')
        if len({report.id for report in self.optimizations}) != len(self.optimizations):
            raise ValueError('Duplicate report identifiers')
        if self.created_at.tzinfo is None or self.updated_at.tzinfo is None or self.created_at > self.updated_at:
            raise ValueError('Invalid timestamps')
        if any(report.created_at.tzinfo is None for report in self.optimizations):
            raise ValueError('Invalid report timestamp')
        return self

class ArchivedProfile(ArchiveModel):
    language: Literal['cpp', 'python']
    level: Literal['beginner', 'intermediate']
    style: Literal['guided', 'example']

class ArchivePayload(ArchiveModel):
    format: Literal['zhixu.learning-backup'] = 'zhixu.learning-backup'
    version: Literal[1, 2] = 2
    exported_at: datetime
    profile: ArchivedProfile
    sessions: list[ArchivedSession] = Field(max_length=2000)

    @field_validator('version', mode='before')
    @classmethod
    def integer_version(cls, value):
        if type(value) is not int: raise ValueError('Version must be an integer')
        return value

    @model_validator(mode='after')
    def unique_ids(self):
        if len({item.id for item in self.sessions}) != len(self.sessions):
            raise ValueError('Duplicate session identifiers')
        if self.version == 1 and any(item.review is not None for item in self.sessions):
            raise ValueError('Review data requires archive version two')
        return self

class ArchiveEnvelope(ArchiveModel):
    payload: ArchivePayload
    checksum: str = Field(pattern=r'^[0-9a-f]{64}$')

class ImportInput(ArchiveModel):
    archive: ArchiveEnvelope
    source_ids: list[int] = Field(max_length=2000)
    preview_hash: str = Field(pattern=r'^[0-9a-f]{64}$')
    restore_profile: bool = False

    @model_validator(mode='after')
    def selection_exists(self):
        valid = {item.id for item in self.archive.payload.sessions}
        if len(set(self.source_ids)) != len(self.source_ids) or not set(self.source_ids) <= valid:
            raise ValueError('Invalid selection')
        if not self.source_ids and not self.restore_profile:
            raise ValueError('Choose records or preferences')
        return self

def digest(value):
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')
    return hashlib.sha256(encoded).hexdigest()

def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)

def record_fingerprint(record):
    value = record.model_dump(mode='json')
    for name in ['id', 'created_at', 'updated_at']: value.pop(name)
    for message in value['messages']:
        for name in ['kind', 'source']:
            if message[name] is None: message.pop(name)
    reports = value.pop('optimizations')
    normalized = []
    for report in reports:
        report.pop('id'); report.pop('created_at'); normalized.append(report)
    value['optimizations'] = sorted(normalized, key=digest)
    review = value.pop('review') or {'plan': None, 'events': []}
    for event in review['events']: event.pop('id')
    review['events'] = sorted(review['events'], key=digest)
    value['review'] = review
    return digest(value)

async def read_bounded(request, model):
    size = 0
    parts = []
    async for part in request.stream():
        size += len(part)
        if size > MAX_ARCHIVE_BYTES:
            raise HTTPException(413, '单次恢复文件不能超过 20 MB。原有记录没有改变。')
        parts.append(part)
    try:
        raw = b''.join(parts)
        value = json.loads(raw)
        envelope = value.get('archive') if model is ImportInput and isinstance(value, dict) else value
        # Verify original fields before schema defaults; v1 files remain valid
        # when v2 adds optional review data. Keep Pydantic in JSON mode so strict
        # datetime fields accept JSON timestamps without accepting arbitrary Python strings.
        if not isinstance(envelope, dict) or not isinstance(envelope.get('payload'), dict) or envelope.get('checksum') != digest(envelope['payload']):
            raise ValueError('Checksum mismatch')
        return model.model_validate_json(raw)
    except (ValidationError, ValueError, TypeError, KeyError):
        raise HTTPException(422, '备份文件格式、内容或完整性校验不通过，请使用知序导出的原始 JSON 文件。原有记录没有改变。')

def archive_router(db, LearningSession, OptimizationReport, Preference, preferences, ReviewPlan, ReviewEvent):
    router = APIRouter(prefix='/api/data', tags=['learning-data'])

    def records(session):
        grouped = {}
        plans = {plan.session_id: ArchivedReviewPlan(**{key: getattr(plan, key) for key in ['step', 'version']},
            due_at=utc(plan.due_at), enrolled_at=utc(plan.enrolled_at), last_reviewed_at=utc(plan.last_reviewed_at) if plan.last_reviewed_at else None)
            for plan in session.scalars(select(ReviewPlan))}
        review_events = {}
        for event in session.scalars(select(ReviewEvent).order_by(ReviewEvent.id)):
            review_events.setdefault(event.session_id, []).append(ArchivedReviewEvent(**{key: getattr(event, key) for key in ['id', 'rating', 'note', 'interval_minutes', 'step']},
                reviewed_at=utc(event.reviewed_at), next_due_at=utc(event.next_due_at)))
        for report in session.scalars(select(OptimizationReport).order_by(OptimizationReport.id)):
            grouped.setdefault(report.session_id, []).append(ArchivedReport(
                id=report.id, language=report.language, goal=report.goal, phase=report.phase,
                input_code=report.input_code, data=OptimizationPayload.model_validate(report.data), created_at=utc(report.created_at)))
        return [ArchivedSession(**{key: getattr(item, key) for key in ['id', 'title', 'content', 'language', 'example_id', 'difficulty', 'tags', 'stage', 'status', 'drafts', 'messages', 'notes']},
            created_at=utc(item.created_at), updated_at=utc(item.updated_at), optimizations=grouped.get(item.id, []),
            review=ArchivedReview(plan=plans.get(item.id), events=review_events.get(item.id, [])) if item.id in plans or item.id in review_events else None)
            for item in session.scalars(select(LearningSession).order_by(LearningSession.id))]

    def read_snapshot(session):
        if session.bind.dialect.name == 'sqlite': session.execute(text('BEGIN'))

    def preview(archive, session):
        current = records(session)
        existing = {record_fingerprint(item): item.id for item in reversed(current)}
        entries = []
        seen = set()
        for item in archive.payload.sessions:
            fingerprint = record_fingerprint(item)
            duplicate = existing.get(fingerprint)
            repeated = fingerprint in seen
            seen.add(fingerprint)
            entries.append({'source_id': item.id, 'title': item.title, 'language': item.language,
                'messages': len(item.messages), 'reports': len(item.optimizations), 'reviews': len(item.review.events) if item.review else 0, 'duplicate_id': duplicate, 'repeated_in_file': repeated})
        state = [[item.id, record_fingerprint(item)] for item in current]
        return {'entries': entries, 'profile': archive.payload.profile.model_dump(),
            'new_count': sum(item['duplicate_id'] is None and not item['repeated_in_file'] for item in entries),
            'duplicate_count': sum(item['duplicate_id'] is not None or item['repeated_in_file'] for item in entries),
            'preview_hash': digest({'archive': archive.checksum, 'state': state, 'profile': preferences(session)})}

    @router.get('/export')
    def export_data(session=Depends(db)):
        read_snapshot(session)
        try:
            payload = ArchivePayload(exported_at=datetime.now(timezone.utc), profile=ArchivedProfile(**preferences(session)), sessions=records(session))
        except ValidationError:
            raise HTTPException(422, '部分学习记录不符合备份格式，请先检查记录；数据库没有改变。')
        value = payload.model_dump(mode='json')
        content = json.dumps({'payload': value, 'checksum': digest(value)}, ensure_ascii=False, indent=2).encode('utf-8')
        if len(content) > MAX_ARCHIVE_BYTES:
            raise HTTPException(413, '学习数据超过此版本的 20 MB 备份范围。数据库没有改变。')
        filename = 'zhixu-learning-' + datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S') + '.json'
        return Response(content, media_type='application/json', headers={'Content-Disposition': f'attachment; filename="{filename}"', 'Cache-Control': 'no-store'})

    @router.post('/preview')
    async def preview_data(request: Request, session=Depends(db)):
        archive = await read_bounded(request, ArchiveEnvelope)
        read_snapshot(session)
        return preview(archive, session)

    @router.post('/import', status_code=201)
    async def import_data(request: Request, session=Depends(db)):
        body = await read_bounded(request, ImportInput)
        try:
            if session.bind.dialect.name == 'sqlite': session.execute(text('BEGIN IMMEDIATE'))
            plan = preview(body.archive, session)
            if plan['preview_hash'] != body.preview_hash:
                raise HTTPException(409, '预览后学习数据已改变，请重新预览，再确认导入。原有记录没有改变。')
            fingerprints = {record_fingerprint(item): item.id for item in records(session)}
            imported, skipped = [], []
            chosen = set(body.source_ids)
            for record in body.archive.payload.sessions:
                if record.id not in chosen: continue
                fingerprint = record_fingerprint(record)
                if fingerprint in fingerprints:
                    skipped.append({'source_id': record.id, 'existing_id': fingerprints[fingerprint]}); continue
                value = record.model_dump(exclude={'id', 'optimizations', 'review'}, mode='python')
                value['messages'] = [message.model_dump(exclude_none=True) for message in record.messages]
                value['created_at'] = utc(record.created_at); value['updated_at'] = utc(record.updated_at)
                item = LearningSession(**value)
                session.add(item); session.flush()
                for report in record.optimizations:
                    value = report.model_dump(exclude={'id'}, mode='python')
                    value['data'] = report.data.model_dump(); value['created_at'] = utc(report.created_at)
                    session.add(OptimizationReport(session_id=item.id, **value))
                if record.review:
                    if record.review.plan:
                        value = record.review.plan.model_dump()
                        for key in ['due_at', 'enrolled_at', 'last_reviewed_at']:
                            if value[key] is not None: value[key] = utc(value[key])
                        session.add(ReviewPlan(session_id=item.id, **value))
                    for event in record.review.events:
                        value = event.model_dump(exclude={'id'})
                        value['reviewed_at'] = utc(value['reviewed_at']); value['next_due_at'] = utc(value['next_due_at'])
                        session.add(ReviewEvent(session_id=item.id, **value))
                fingerprints[fingerprint] = item.id
                imported.append({'source_id': record.id, 'id': item.id, 'title': item.title})
            if body.restore_profile:
                pref = session.get(Preference, 1) or Preference(id=1)
                pref.data = body.archive.payload.profile.model_dump(); session.add(pref)
            session.commit()
            return {'imported': imported, 'skipped': skipped, 'profile_restored': body.restore_profile}
        except OperationalError:
            session.rollback()
            raise HTTPException(503, '数据库正在保存其他内容，请稍后重新预览。此次导入没有改变数据。')
        except Exception:
            session.rollback()
            raise

    return router
