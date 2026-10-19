"""Child-process harness for local, non-persistent judging of example problems.

This module is intentionally standard-library only so it can run under
``python -I`` (isolated mode). It never writes the submitted code to disk: the
parent injects the payload through stdin and reads a single JSON verdict from
stdout.

Threat model: a single-user local application bound to 127.0.0.1 with no
accounts and no multi-tenancy. The goal is to protect the learner from
*accidentally* harmful code (infinite loops, memory exhaustion, runaway
printing, accidental file writes). These are mitigations, not a sandbox
boundary — a determined attacker can escape through CPython internals such as
``object.__subclasses__()``. Both the UI and the API state this honestly.
"""
import builtins
import contextlib
import io
import json
import sys

ALLOWED_MODULES = frozenset({
    'typing', 'collections', 'math', 'functools', 'itertools',
    'heapq', 'bisect', 're', 'string', 'dataclasses', 'copy', 'operator', 'random',
})
STDOUT_LIMIT = 64 * 1024
RECURSION_LIMIT = 1000

_REAL_IMPORT = builtins.__import__


def _denied(*args, **kwargs):
    raise PermissionError('本地运行不允许使用这个内建函数，仅支持纯算法代码。')


def _guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
    """Allow the pure-algorithm stdlib subset and refuse everything else."""
    top = name.split('.')[0]
    if top not in ALLOWED_MODULES:
        raise PermissionError(
            f'本地运行不允许导入 {top} 模块，仅支持纯算法标准库'
            '（typing/collections/math/functools/itertools/heapq/bisect/'
            're/string/dataclasses/copy/operator/random）。'
        )
    return _REAL_IMPORT(name, globals, locals, fromlist, level)


def _restricted_builtins():
    """Copy the real builtins and replace the dangerous entry points.

    ``__import__`` is routed through the allow-list (rather than being removed
    entirely) so normal algorithm imports such as ``from typing import List``
    keep working. ``print`` stays intact for user debugging output.
    """
    namespace = dict(builtins.__dict__)
    namespace['__import__'] = _guarded_import
    for name in ('open', 'eval', 'exec', 'compile', 'input', 'breakpoint', 'exit', 'quit'):
        namespace[name] = _denied
    return namespace


def _jsonable(value):
    """Return ``value`` if it survives JSON encoding, otherwise its repr."""
    try:
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        return repr(value)


def _describe(error):
    return f'{type(error).__name__}: {error}'


def run(payload):
    """Execute the submitted code against every case and return a verdict dict."""
    code = payload['code']
    method = payload['method']
    cases = payload['cases']
    sys.setrecursionlimit(RECURSION_LIMIT)

    namespace = {'__name__': 'solution', '__builtins__': _restricted_builtins()}
    try:
        exec(compile(code, '<solution>', 'exec'), namespace)
        solution = namespace.get('Solution')
        if solution is None:
            raise RuntimeError('未找到 class Solution，请保持类名与题解模板一致。')
        instance = solution()
        if not hasattr(instance, method):
            raise RuntimeError(f'未找到方法 {method}，请检查方法名与参数。')
        runner = getattr(instance, method)
    except BaseException as error:  # noqa: BLE001 - report user errors back verbatim
        return {'verdict': 'setup_error', 'passed': 0, 'total': len(cases),
                'cases': [], 'error': _describe(error)}

    results = []
    passed_total = 0
    for index, case in enumerate(cases):
        expected = case['output']
        buffer = io.StringIO()
        try:
            with contextlib.redirect_stdout(buffer):
                actual = runner(**case['input'])
            stdout_text = buffer.getvalue()[:STDOUT_LIMIT]
            # Strict type + value equality so True never equals 1 and int never equals float.
            ok = (type(actual) is type(expected)) and (actual == expected)
            error = None
        except BaseException as exc:  # noqa: BLE001
            actual = None
            stdout_text = buffer.getvalue()[:STDOUT_LIMIT]
            ok = False
            # ``except ... as exc`` deletes ``exc`` after the block, so keep the
            # rendered message in an ordinary local that survives for the result.
            error = _describe(exc)
        if ok:
            passed_total += 1
        results.append({
            'index': index,
            'input': _jsonable(case['input']),
            'expected': _jsonable(expected),
            'actual': _jsonable(actual),
            'passed': ok,
            'stdout': stdout_text,
            'error': error,
        })

    return {
        'verdict': 'accepted' if passed_total == len(cases) else 'wrong_answer',
        'passed': passed_total,
        'total': len(cases),
        'cases': results,
    }


def main():
    payload = json.loads(sys.stdin.read())
    result = run(payload)
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
