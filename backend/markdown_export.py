"""Human-readable Markdown export for a single learning session."""
import re
from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy import select

GOAL_NAMES = {'balanced': '平衡效率与可读性', 'time': '优先降低时间复杂度', 'space': '优先降低额外空间', 'readability': '优先精炼且易读的代码'}
ASSESSMENT_NAMES = {'correct': '正确', 'needs_fix': '需修复', 'uncertain': '不确定'}


def fence(code, language=''):
    """Wrap code in a backtick fence one run longer than any inside the code."""
    longest = max([2, *[len(run) for run in re.findall(r'`+', code)]])
    marker = '`' * (longest + 1)
    return f'{marker}{language}\n{code}\n{marker}'


def sanitize_filename(value):
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', value).strip()
    return cleaned[:60] or '学习记录'


def leetcode_meta(value):
    if not isinstance(value, dict):
        return None
    slug = value.get('slug')
    frontend_id = value.get('frontend_id')
    title = value.get('title') or ''
    url = value.get('source_url')
    label = f'{frontend_id}. {title}' if frontend_id else (title or slug or '')
    if url:
        return f'> - 力扣：[{label}]({url})'
    if label:
        return f'> - 力扣：{label}'
    return None


def bullet(title, items):
    if not items:
        return []
    lines = [f'- {title}：']
    lines.extend(f'  - {item}' for item in items)
    return lines


def render_report(report):
    data = report.data or {}
    lines = [f'### 复杂度分析 #{report.id}（{GOAL_NAMES.get(report.goal, report.goal)}）', '']
    lines.append(f"- 评估：{ASSESSMENT_NAMES.get(data.get('assessment'), str(data.get('assessment', '')))}")
    lines.append(f"- 总结：{data.get('summary', '')}")
    lines.append(f"- 关键变量：{'、'.join(data.get('variables') or [])}")
    current = data.get('current') or {}
    target = data.get('target') or {}
    lines.append(f"- 当前复杂度：时间 {current.get('time', '')} · 空间 {current.get('space', '')}")
    lines.append(f"  - 时间依据：{current.get('time_reason', '')}")
    lines.append(f"  - 空间依据：{current.get('space_reason', '')}")
    lines.append(f"- 目标复杂度：时间 {target.get('time', '')} · 空间 {target.get('space', '')}")
    lines.append(f"  - 时间依据：{target.get('time_reason', '')}")
    lines.append(f"  - 空间依据：{target.get('space_reason', '')}")
    lines.extend(bullet('瓶颈', data.get('bottlenecks')))
    lines.extend(bullet('优化步骤', data.get('steps')))
    lines.extend(bullet('精炼改动', data.get('changes')))
    lines.extend(bullet('取舍', data.get('tradeoffs')))
    lines.extend(bullet('自检清单', data.get('checks')))
    lines.append(f"- 正确性依据：{data.get('proof', '')}")
    if report.phase == 'refine' and data.get('optimized_code'):
        lines.append('')
        lines.append(fence(data['optimized_code'], 'cpp' if report.language == 'cpp' else 'python'))
    lines.append('')
    return lines


def build_markdown(item, reports):
    language = 'C++' if item.language == 'cpp' else 'Python'
    status = '已掌握' if item.status == 'mastered' else '学习中'
    lines = [f'# {item.title}', '']
    meta = [
        f'> - 难度：{item.difficulty}',
        f'> - 语言：{language}',
        f'> - 状态：{status}',
        f"> - 标签：{' / '.join(item.tags) or '未分类'}",
    ]
    linked = leetcode_meta(item.leetcode)
    if linked:
        meta.append(linked)
    meta.append(f"> - 导出时间：{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')}")
    lines.extend(meta)
    lines.append('')
    lines.append('## 题目')
    lines.append('')
    lines.append(item.content)
    lines.append('')
    lines.append('## 我的代码')
    lines.append('')
    lines.append('### C++')
    lines.append('')
    lines.append(fence(item.drafts.get('cpp') or '（尚未编写 C++ 代码）', 'cpp'))
    lines.append('')
    lines.append('### Python')
    lines.append('')
    lines.append(fence(item.drafts.get('python') or '（尚未编写 Python 代码）', 'python'))
    lines.append('')
    lines.append('## 思路过程（与教练的对话）')
    lines.append('')
    for message in item.messages:
        role = '你' if message.get('role') == 'user' else '教练'
        lines.append(f'**{role}**：{message.get("content") or ""}')
        lines.append('')
    lines.append('## 复杂度分析')
    lines.append('')
    if reports:
        for report in reports:
            lines.extend(render_report(report))
    else:
        lines.append('尚未生成复杂度分析。')
    lines.append('')
    lines.append('## 复盘笔记')
    lines.append('')
    lines.append(item.notes or '尚未填写复盘笔记。')
    return '\n'.join(lines)


def markdown_router(db, LearningSession, OptimizationReport, get_session):
    router = APIRouter(prefix='/api', tags=['markdown-export'])

    @router.get('/sessions/{id}/export.md')
    def export_markdown(id: int, session=Depends(db)):
        item = get_session(id, session)
        reports = list(session.scalars(select(OptimizationReport).where(
            OptimizationReport.session_id == id).order_by(OptimizationReport.created_at, OptimizationReport.id)))
        content = build_markdown(item, reports)
        safe = sanitize_filename(item.title)
        filename = safe + '.md'
        ascii_name = re.sub(r'[^\x00-\x7f]+', '', safe) or 'zhixu-note'
        disposition = f"attachment; filename=\"{ascii_name}.md\"; filename*=UTF-8''{quote(filename)}"
        return Response(content, media_type='text/markdown; charset=utf-8',
            headers={'Content-Disposition': disposition, 'Cache-Control': 'no-store'})

    return router
