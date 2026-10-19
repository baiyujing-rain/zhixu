"""Local, runnable verification for built-in example problems (Python only).

The result is a one-shot check of the problem's explicit sample cases. It is
never persisted and never written back to the session status — that keeps it an
honest "does this run the sample?" signal rather than a durable "I passed"
claim.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from backend.examples import EXAMPLES, starter

HARNESS_PATH = Path(__file__).resolve().parent / 'judge_harness.py'
TIMEOUT_SECONDS = 4.0

VERIFICATION = '本地沙箱运行了内置示例用例，正常情况下不连接网络、不写入文件；这是本地缓解措施而非安全沙箱，不代表力扣判题结果。'


class JudgeInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    language: str = Field(min_length=1, max_length=20)
    expected_code: str = Field(min_length=1, max_length=50000)


def run_case(code, method, cases, timeout=TIMEOUT_SECONDS):
    """Run one payload in an isolated child process and return its verdict dict.

    The submitted code travels through stdin (never written to disk), and the
    harness replies with a single JSON object on stdout. ``timeout`` is the
    cross-platform main defence against infinite loops; on Windows the child is
    terminated via ``TerminateProcess``, on POSIX via SIGKILL.
    """
    payload = json.dumps({'code': code, 'method': method, 'cases': cases}, ensure_ascii=False)
    try:
        completed = subprocess.run(
            [sys.executable, '-I', '-X', 'utf8', str(HARNESS_PATH)],
            input=payload,
            capture_output=True,
            timeout=timeout,
            cwd=tempfile.gettempdir(),
            text=True,
            encoding='utf-8',
        )
    except subprocess.TimeoutExpired:
        return {'verdict': 'error', 'passed': 0, 'total': len(cases), 'cases': [],
                'error': '运行超过 4 秒已中止，可能是死循环或过于耗时的算法。'}
    except OSError as error:
        return {'verdict': 'error', 'passed': 0, 'total': len(cases), 'cases': [],
                'error': f'无法启动本地运行沙箱：{error}'}

    # Per-case stdout is already capped inside the harness; parse the whole
    # reply so a few loud cases never slice a valid JSON document in half.
    stdout = completed.stdout or ''
    if completed.returncode != 0 or not stdout.strip():
        stderr = (completed.stderr or '').strip()[:500]
        detail = f' 细节：{stderr}' if stderr else ''
        return {'verdict': 'error', 'passed': 0, 'total': len(cases), 'cases': [],
                'error': f'本地运行沙箱异常退出。{detail}'.strip()}
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError:
        return {'verdict': 'error', 'passed': 0, 'total': len(cases), 'cases': [],
                'error': '本地运行沙箱没有返回有效结果。'}
    if not isinstance(data, dict) or 'verdict' not in data:
        return {'verdict': 'error', 'passed': 0, 'total': len(cases), 'cases': [],
                'error': '本地运行沙箱返回了无法识别的内容。'}
    return data


def judge_router(db, LearningSession, get_session):
    router = APIRouter(tags=['judge'])

    @router.post('/api/sessions/{id}/judge')
    def judge(id: int, body: JudgeInput, session=Depends(db)):
        item = get_session(id, session)
        if body.language != item.language:
            raise HTTPException(409, '其他窗口已切换题目语言，请刷新后重试。')
        if body.expected_code != item.drafts.get(item.language, ''):
            raise HTTPException(409, '当前代码与服务器草稿不同，请先保存你要运行的版本。')
        if not item.example_id:
            raise HTTPException(422, '仅内置示例题支持本地运行样例；粘贴题请用静态审阅或力扣验证。')
        example = EXAMPLES.get(item.example_id)
        if not example or not example.get('cases'):
            raise HTTPException(422, '这道示例题暂未配置可运行的用例。')
        if item.language != 'python':
            raise HTTPException(422, '本地运行样例当前仅支持 Python；C++ 请使用静态审阅或到力扣验证。')
        code = item.drafts.get('python', '').strip()
        if not code or code == starter('python', item.example_id).strip():
            raise HTTPException(422, '请先在编辑器中写入完整解法。')

        result = run_case(item.drafts['python'], example['method'], example['cases'])
        response = {
            'session_id': id,
            'example_id': item.example_id,
            'language': 'python',
            'status': 'done',
            'verdict': result['verdict'],
            'passed': result.get('passed', 0),
            'total': result.get('total', 0),
            'cases': result.get('cases', []),
            'verification': VERIFICATION,
        }
        if result.get('error'):
            response['error'] = result['error']
        return response

    return router
