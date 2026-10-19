"""Personal problem collection and explicit, snapshot-based online judging."""
import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import String, DateTime, JSON, Text, Integer, select, delete
from sqlalchemy.orm import Mapped, mapped_column

from backend import leetcode as platform
from backend.examples import starter


def library_models(Base):
    class LibraryProblem(Base):
        __tablename__ = 'library_problems'
        id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
        identity: Mapped[str] = mapped_column(String(180), unique=True, index=True)
        data: Mapped[dict] = mapped_column(JSON)
        pasted_content: Mapped[str] = mapped_column(Text, default='')
        created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
        updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
        accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    class LibraryLink(Base):
        __tablename__ = 'library_links'
        session_id: Mapped[int] = mapped_column(Integer, primary_key=True)
        problem_id: Mapped[str] = mapped_column(String(36), index=True)
    class JudgeJob(Base):
        __tablename__ = 'leetcode_judge_jobs'
        id: Mapped[str] = mapped_column(String(36), primary_key=True)
        session_id: Mapped[int] = mapped_column(Integer, index=True)
        session_origin: Mapped[datetime] = mapped_column(DateTime)
        problem_id: Mapped[str] = mapped_column(String(36), index=True)
        mode: Mapped[str] = mapped_column(String(12))
        language: Mapped[str] = mapped_column(String(12))
        code: Mapped[str] = mapped_column(Text)
        input_data: Mapped[str] = mapped_column(Text, default='')
        problem: Mapped[dict] = mapped_column(JSON)
        status: Mapped[str] = mapped_column(String(16), default='preparing')
        remote_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
        result: Mapped[dict] = mapped_column(JSON, default=dict)
        error: Mapped[str] = mapped_column(Text, default='')
        created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
        finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    return LibraryProblem, LibraryLink, JudgeJob


class LookupInput(BaseModel):
    text: str = Field(min_length=1, max_length=20000)
    site: Literal['cn', 'com'] = 'cn'


class ImportProblem(BaseModel):
    mode: Literal['official', 'manual'] = 'official'
    site: Literal['cn', 'com'] = 'cn'
    slug: str | None = Field(default=None, max_length=120)
    content: str = Field(default='', max_length=20000)
    title: str | None = Field(default=None, max_length=160)


class PracticeInput(BaseModel):
    language: Literal['cpp', 'python'] = 'cpp'
    fresh: bool = False


class LinkInput(BaseModel):
    site: Literal['cn', 'com'] = 'cn'


class JudgeInput(BaseModel):
    request_id: uuid.UUID
    session_id: int = Field(ge=1)
    language: Literal['cpp', 'python']
    expected_code: str = Field(min_length=1, max_length=50000)
    input_data: str = Field(default='', max_length=50000)
    confirmed_submit: bool = False


def problem_identity(data):
    if data['site'] != 'manual': return data['site'] + ':' + data['slug']
    return 'manual:' + hashlib.sha256((data['title'] + '\n' + data['content']).encode()).hexdigest()


def problem_view(problem, sessions=None):
    return {'id': problem.id, **problem.data, 'pasted_content': problem.pasted_content, 'created_at': problem.created_at,
        'updated_at': problem.updated_at, 'accepted_at': problem.accepted_at, 'practice_count': sessions or 0}


def job_view(job):
    return {key: getattr(job, key) for key in ['id', 'session_id', 'mode', 'language', 'code', 'input_data', 'problem', 'status', 'remote_id', 'result', 'error', 'created_at', 'finished_at']}


RESULT_FIELDS = {'state', 'status_code', 'status_msg', 'run_success', 'correct_answer', 'compare_result', 'total_correct', 'total_testcases',
    'code_answer', 'expected_code_answer', 'std_output_list', 'compile_error', 'runtime_error', 'full_compile_error', 'full_runtime_error',
    'last_testcase', 'expected_output', 'code_output', 'status_runtime', 'status_memory', 'runtime_percentile', 'memory_percentile', 'task_finish_time', 'elapsed_time'}


def safe_result(value):
    result = {}
    for key in RESULT_FIELDS:
        if key not in value: continue
        item = value[key]
        encoded = json.dumps(item, ensure_ascii=False)
        if len(encoded) > 50000:
            result[key] = encoded[:50000]; result['truncated'] = True
        else: result[key] = item
    return result


def library_router(db, LearningSession, LibraryProblem, LibraryLink, JudgeJob, get_session, write_session, serialize):
    router = APIRouter(prefix='/api', tags=['problem-library'])

    def find_problem(id, session):
        item = session.get(LibraryProblem, id)
        if not item: raise HTTPException(404, '这道题不在你的题库中，请刷新列表。')
        return item

    @router.get('/leetcode/connection')
    def connection_status(site: Literal['cn', 'com'] = 'cn'):
        return platform.leetcode.status(site)

    @router.post('/leetcode/connection')
    async def connect(request: Request):
        size, chunks = 0, []
        async for part in request.stream():
            size += len(part)
            if size > 20000: raise HTTPException(413, 'Cookie 内容过长，请只粘贴 Cookie 请求头。')
            chunks.append(part)
        try:
            body = json.loads(b''.join(chunks))
            if not isinstance(body, dict): raise ValueError()
        except ValueError: raise HTTPException(422, '连接信息格式不完整。') from None
        # Parse manually so validation errors cannot echo the credential value.
        return await platform.leetcode.connect(body.get('site', 'cn'), body.get('cookie'))

    @router.post('/leetcode/connection/verify')
    async def verify_connection(site: Literal['cn', 'com'] = 'cn'):
        stored = platform.leetcode.saved(site)
        if not stored: raise HTTPException(401, '请先填写本人的力扣 Cookie。')
        username = await platform.leetcode.verify(site, stored['cookies'])
        data = platform.leetcode.store.load(); item = data.setdefault('sites', {}).setdefault(site, {})
        item['username'] = username; item['verified_at'] = datetime.now(timezone.utc).isoformat(); platform.leetcode.store.save(data)
        return {'verified': True, **platform.leetcode.status(site)}

    @router.delete('/leetcode/connection')
    def disconnect(site: Literal['cn', 'com'] = 'cn'):
        return platform.leetcode.disconnect(site)

    @router.post('/library/lookup')
    async def lookup(body: LookupInput):
        return await platform.leetcode.search(body.text, body.site)

    @router.get('/library')
    def list_library(session=Depends(db)):
        counts = {}
        for link in session.scalars(select(LibraryLink)):
            if session.get(LearningSession, link.session_id): counts[link.problem_id] = counts.get(link.problem_id, 0) + 1
        return [problem_view(item, counts.get(item.id)) for item in session.scalars(select(LibraryProblem).order_by(LibraryProblem.created_at.desc()))]

    @router.post('/library', status_code=201)
    async def import_problem(body: ImportProblem, session=Depends(db)):
        if body.mode == 'official':
            if not body.slug: raise HTTPException(422, '请先预览并选择官方题目。')
            data = await platform.leetcode.problem(body.site, body.slug)
        else:
            content = body.content.strip()
            if len(content) < 15: raise HTTPException(422, '本地题目至少需要 15 字符，请包含描述和约束。')
            fallback_title = next((line.strip() for line in content.splitlines() if line.strip()), '本地题目')
            data = {'site': 'manual', 'slug': None, 'question_id': None, 'frontend_id': None, 'title': (body.title or fallback_title).strip()[:160] or '本地题目',
                'content': content, 'difficulty': '未分类', 'tags': [], 'code_snippets': {}, 'example_testcases': '', 'sample_test_case': '', 'metadata': {}, 'run_enabled': False, 'source_url': None, 'paid_only': False}
        identity = problem_identity(data)
        existing = session.scalar(select(LibraryProblem).where(LibraryProblem.identity == identity))
        if existing: return {'problem': problem_view(existing), 'duplicate': True}
        item = LibraryProblem(identity=identity, data=data, pasted_content=body.content if body.mode == 'official' else '')
        session.add(item)
        from sqlalchemy.exc import IntegrityError
        try: session.commit()
        except IntegrityError:
            session.rollback(); existing = session.scalar(select(LibraryProblem).where(LibraryProblem.identity == identity))
            if not existing: raise
            return {'problem': problem_view(existing), 'duplicate': True}
        return {'problem': problem_view(item), 'duplicate': False}

    @router.get('/library/{id}')
    def library_detail(id: str, session=Depends(db)):
        return problem_view(find_problem(id, session))

    @router.delete('/library/{id}', status_code=204)
    def delete_problem(id: str, session=Depends(db)):
        find_problem(id, session)
        if session.scalar(select(JudgeJob).where(JudgeJob.problem_id == id, JudgeJob.status.in_(['preparing', 'pending']))):
            raise HTTPException(409, '这道题有正在进行的力扣评测，请先查看结果再移除。')
        session.execute(delete(LibraryLink).where(LibraryLink.problem_id == id)); session.execute(delete(LibraryProblem).where(LibraryProblem.id == id)); session.commit()

    @router.post('/library/{id}/practice')
    def practice(id: str, body: PracticeInput, session=Depends(db)):
        problem = find_problem(id, session)
        if not body.fresh:
            links = list(session.scalars(select(LibraryLink).where(LibraryLink.problem_id == id)))
            records = [session.get(LearningSession, link.session_id) for link in links]
            records = [item for item in records if item]
            if records: return serialize(max(records, key=lambda item: item.updated_at))
        data = problem.data
        drafts = {language: data['code_snippets'].get('cpp' if language == 'cpp' else 'python3') or starter(language, None) for language in ['cpp', 'python']}
        item = LearningSession(title=data['title'], content=data['content'], language=body.language, difficulty=data['difficulty'], tags=data['tags'],
            drafts=drafts, messages=[{'role': 'assistant', 'content': '题目已经保存。先观察示例和数据范围，写下你的思路；需要帮助时再向教练提问。', 'kind': 'welcome'}],
            leetcode=platform.snapshot(data) if data['site'] != 'manual' else None)
        session.add(item); session.flush(); session.add(LibraryLink(session_id=item.id, problem_id=id)); session.commit()
        return serialize(item)

    @router.post('/sessions/{id}/leetcode/link')
    async def link_session_leetcode(id: int, body: LinkInput, session=Depends(db)):
        item = get_session(id, session)
        value = item.content or item.title
        try:
            result = await platform.leetcode.search(value, body.site)
            problem = result.get('problem')
            snapshot = platform.snapshot(problem) if problem else platform.detect(value, body.site)
        except HTTPException:
            # Online resolution is a non-fatal enhancement; fall back to the
            # offline detection so a transient LeetCode outage never blocks the record.
            snapshot = platform.detect(value, body.site)
        write_session(item, {'leetcode': snapshot}, session)
        session.commit()
        return serialize(item)

    @router.get('/sessions/{id}/leetcode')
    def session_judging(id: int, session=Depends(db)):
        item = get_session(id, session)
        link = session.get(LibraryLink, id)
        problem = session.get(LibraryProblem, link.problem_id) if link else None
        jobs = session.scalars(select(JudgeJob).where(JudgeJob.session_id == id, JudgeJob.session_origin == item.created_at).order_by(JudgeJob.created_at.desc()).limit(20))
        return {'problem': problem_view(problem) if problem else None, 'jobs': [job_view(job) for job in jobs]}

    @router.post('/leetcode/{mode}')
    async def start_judge(mode: Literal['run', 'submit'], body: JudgeInput, session=Depends(db)):
        if mode == 'submit' and not body.confirmed_submit: raise HTTPException(422, '提交判题需要本人明确确认，自动保存不会提交。')
        item = get_session(body.session_id, session)
        job_id = str(body.request_id)
        existing = session.get(JudgeJob, job_id)
        if existing:
            if existing.session_id != item.id or existing.session_origin != item.created_at or existing.mode != mode or existing.code != body.expected_code or existing.language != body.language or existing.input_data != body.input_data:
                raise HTTPException(409, '这个请求编号已用于另一份代码或用例，请重新确认操作。')
            return job_view(existing)
        if item.language != body.language or item.drafts.get(body.language) != body.expected_code:
            raise HTTPException(409, '正在查看的代码或语言已改变，本次没有调用力扣。请先保存当前版本。')
        link = session.get(LibraryLink, item.id)
        problem = session.get(LibraryProblem, link.problem_id) if link else None
        if not problem or problem.data['site'] == 'manual' or not problem.data.get('run_enabled'):
            raise HTTPException(422, '请从题库打开支持 C++ / Python 的力扣题目，再运行当前代码。')
        if not platform.leetcode.saved(problem.data['site']): raise HTTPException(401, '请先在设置中连接本人的力扣账号。')
        if mode == 'run' and not body.input_data.strip(): raise HTTPException(422, '请填写官方示例或自定义输入，每个参数占一行。')
        if session.scalar(select(JudgeJob).where(JudgeJob.session_id == item.id, JudgeJob.status.in_(['preparing', 'pending']))):
            raise HTTPException(409, '这道题已有评测正在进行，请先查看结果。')
        write_session(item, {}, session)
        snapshot = {key: problem.data.get(key) for key in ['site', 'slug', 'question_id', 'frontend_id', 'title', 'source_url']}
        job = JudgeJob(id=job_id, session_id=item.id, session_origin=item.created_at, problem_id=problem.id, mode=mode,
            language=body.language, code=body.expected_code, input_data=body.input_data, problem=snapshot, result={})
        session.add(job); session.commit()
        try:
            # Refresh the official identity immediately before a remote request;
            # archived/imported metadata is display data, never authority for judging.
            canonical = await platform.leetcode.problem(snapshot['site'], snapshot['slug'])
            remote_id = await platform.leetcode.judge(snapshot['site'], snapshot['slug'], canonical['question_id'], body.language, body.expected_code, mode, body.input_data)
        except HTTPException as error:
            session.expire_all(); saved = session.get(JudgeJob, job_id)
            if saved:
                saved.status = 'unknown' if error.status_code == 502 else 'error'; saved.error = error.detail; session.commit()
                return job_view(saved)
            raise HTTPException(409, '题目已删除，无法保留本次评测状态。请在力扣页面核对。') from None
        session.expire_all(); saved = session.get(JudgeJob, job_id)
        if not saved: raise HTTPException(409, '题目在请求期间已删除，力扣可能已受理。请在官方页面查看。')
        saved.remote_id = remote_id; saved.status = 'pending'; session.commit()
        return job_view(saved)

    @router.get('/leetcode/jobs/{id}')
    async def judge_result(id: str, session=Depends(db)):
        job = session.get(JudgeJob, id)
        if not job: raise HTTPException(404, '这份评测记录不存在，请刷新题目。')
        get_session(job.session_id, session)
        if job.status != 'pending' or not job.remote_id: return job_view(job)
        raw = await platform.leetcode.check(job.problem['site'], job.remote_id)
        session.expire_all(); job = session.get(JudgeJob, id)
        if not job: raise HTTPException(404, '题目已经删除，评测结果没有写入其他题目。')
        job.result = safe_result(raw)
        if raw.get('state') == 'SUCCESS':
            job.status = 'done'; job.finished_at = datetime.now(timezone.utc)
            if job.mode == 'submit' and raw.get('status_code') == 10:
                problem = session.get(LibraryProblem, job.problem_id)
                if problem: problem.accepted_at = job.finished_at
        elif raw.get('state') in ('FAILED', 'ERROR'):
            job.status = 'error'; job.error = '力扣评测没有完成，请到官方页面查看。'
        session.commit()
        return job_view(job)

    return router
