"""Execute only our built-in teaching snippets, never user-submitted source."""
import json
import sys
from pathlib import Path

fixture = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
namespace = {}
for algorithm, snippet in fixture['python'].items():
    parameters = {'hash-two-sum': 'nums, target', 'two-pointers': 'nums, target', 'binary-search': 'nums, target', 'brackets': 's', 'stairs': 'n', 'sliding-window': 's', 'bfs': 'grid, start, goal'}[algorithm]
    source = f'def demo_{algorithm.replace("-", "_")}({parameters}):\n' + '\n'.join('    ' + line for line in snippet.splitlines())
    exec(compile(source, f'<built-in-{algorithm}>', 'exec'), namespace)
counts = {}
for case in fixture['cases']:
    name = case['algorithm']
    args = (case['values'], case['target']) if name in ['two-pointers', 'binary-search', 'hash-two-sum'] else (case['text'],) if name in ['brackets', 'sliding-window'] else (case['n'],) if name == 'stairs' else (case['grid'], tuple(case['start']), tuple(case['goal']))
    result = namespace[f'demo_{name.replace("-", "_")}'](*args)
    if name in ['two-pointers', 'hash-two-sum']:
        assert type(result) is list and len(result) in [0, 2]
        assert bool(result) == case['exists']
        if result:
            left, right = result
            assert type(left) is int and type(right) is int and 0 <= left < right < len(case['values'])
            assert case['values'][left] + case['values'][right] == case['target']
    elif name == 'binary-search':
        assert type(result) is int
        assert (result >= 0) == case['exists']
        if result >= 0: assert result < len(case['values']) and case['values'][result] == case['target']
    else:
        assert type(result) is (bool if name == 'brackets' else int)
        assert result == case['expected'], (name, case, result)
    counts[name] = counts.get(name, 0) + 1
print(json.dumps({'language': 'Python', 'total': len(fixture['cases']), 'cases': counts}, ensure_ascii=False))
