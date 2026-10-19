/* 知序 · 静态算法演示渲染层。
 * 自包含、零依赖：读取 esbuild 打包出的 window.ZhixuAlgos，
 * 用原生 SVG 把 buildTrace 产出的每一帧画出来，并提供播放控件。
 * 数据 / 逻辑与主应用完全同源，本文件只负责渲染，不复制算法逻辑。
 */
(function () {
  'use strict';

  var Z = window.ZhixuAlgos;
  var app = document.getElementById('app');
  var galleryEl = document.getElementById('gallery');
  var viewerEl = document.getElementById('viewer');

  if (!Z) {
    app.innerHTML = '<p class="boot-error">未找到 window.ZhixuAlgos。请先在项目根目录运行 <code>npm run build:demo</code> 生成 <code>demo/algos.js</code>。</p>';
    return;
  }

  var ALGORITHMS = Z.ALGORITHMS;
  var DEFAULT_INPUTS = Z.DEFAULT_INPUTS;
  var CATALOG = Z.ALGORITHM_CATALOG;
  var buildTrace = Z.buildTrace;
  var coreCode = Z.coreCode;

  var state = {
    algorithm: 'hash-two-sum',
    applied: {},
    draft: {},
    trace: null,
    frames: [],
    index: 0,
    playing: false,
    speed: 1,
    language: 'cpp',
    timer: 0,
    error: '',
  };

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cloneInput(input) {
    return Object.assign({}, input);
  }

  function last() {
    return Math.max(0, state.frames.length - 1);
  }

  function frame() {
    return state.frames[Math.min(state.index, last())] || {};
  }

  function on(id, event, handler) {
    var el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
  }

  /* ---------------- 目录（gallery） ---------------- */

  function renderGallery() {
    var groups = {};
    CATALOG.forEach(function (entry) {
      (groups[entry.category] = groups[entry.category] || []).push(entry);
    });

    var html = '<div class="gallery-intro"><h2>十种经典算法</h2><p>每张卡片都是一条确定性的教学轨迹：可以改输入、看指针 / 栈 / DP / 队列 / 区间，并对照 C++ / Python 核心代码。</p></div>';

    Object.keys(groups).forEach(function (category) {
      var cards = groups[category].map(function (entry) {
        var meta = ALGORITHMS[entry.id];
        var focus = entry.focus.map(function (tag) { return '<span class="tag">' + esc(tag) + '</span>'; }).join('');
        var practice = entry.practice.map(function (item) {
          return '<li><strong>' + esc(item.level) + '</strong> ' + esc(item.title) + ' · ' + esc(item.prompt) + '</li>';
        }).join('');
        return (
          '<article class="card" data-id="' + esc(entry.id) + '" tabindex="0" role="button" aria-label="打开演示：' + esc(entry.title) + '">' +
            '<h3>' + esc(entry.title) + '</h3>' +
            '<p class="card-desc">' + esc(entry.description) + '</p>' +
            '<div class="card-tags">' + focus + '</div>' +
            '<div class="card-meta"><span>时间 ' + esc(meta.time) + '</span><span>空间 ' + esc(meta.space) + '</span></div>' +
            '<ul class="card-practice">' + practice + '</ul>' +
            '<button class="card-open">进入演示 →</button>' +
          '</article>'
        );
      }).join('');
      html += '<section class="gallery-group"><h3 class="group-title">' + esc(category) + '</h3><div class="card-grid">' + cards + '</div></section>';
    });

    galleryEl.innerHTML = html;
    galleryEl.querySelectorAll('.card').forEach(function (card) {
      var open = function () { openAlgorithm(card.getAttribute('data-id')); };
      card.addEventListener('click', open);
      card.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
      });
    });
  }

  /* ---------------- 状态切换 ---------------- */

  function openAlgorithm(id) {
    if (!ALGORITHMS[id]) return;
    pause();
    state.algorithm = id;
    state.applied = cloneInput(DEFAULT_INPUTS[id]);
    state.draft = cloneInput(DEFAULT_INPUTS[id]);
    state.index = 0;
    state.error = '';
    build();
    galleryEl.hidden = true;
    viewerEl.hidden = false;
    renderViewer();
    window.scrollTo(0, 0);
  }

  function backToGallery() {
    pause();
    viewerEl.hidden = true;
    galleryEl.hidden = false;
    window.scrollTo(0, 0);
  }

  function build() {
    state.trace = buildTrace(state.algorithm, state.applied);
    state.frames = state.trace.frames;
    state.index = Math.max(0, Math.min(state.index, last()));
  }

  function applyDraft() {
    pause();
    try {
      var next = collectDraft();
      buildTrace(state.algorithm, next); // 非法输入抛出中文 Error
      state.applied = next;
      state.draft = cloneInput(next);
      state.error = '';
      state.index = 0;
      build();
      renderViewer();
    } catch (error) {
      state.error = (error && error.message) ? error.message : String(error);
      var errEl = document.getElementById('inputError');
      if (errEl) { errEl.textContent = state.error; errEl.hidden = false; }
    }
  }

  function cancelDraft() {
    pause();
    state.draft = cloneInput(state.applied);
    state.error = '';
    renderViewer();
  }

  /* ---------------- 播放控制 ---------------- */

  function play() {
    if (state.playing) return;
    if (state.index >= last()) state.index = 0;
    state.playing = true;
    updateFrame();
    state.timer = setTimeout(tick, 1700 / state.speed);
  }

  function pause() {
    state.playing = false;
    clearTimeout(state.timer);
  }

  function togglePlay() {
    if (state.playing) { pause(); updateFrame(); }
    else play();
  }

  function tick() {
    if (!state.playing) return;
    if (state.index >= last()) { pause(); updateFrame(); return; }
    state.index += 1;
    updateFrame();
    state.timer = setTimeout(tick, 1700 / state.speed);
  }

  function seek(next) {
    pause();
    state.index = Math.max(0, Math.min(last(), next));
    updateFrame();
  }

  function setSpeed(value) {
    state.speed = value;
    if (state.playing) {
      clearTimeout(state.timer);
      state.timer = setTimeout(tick, 1700 / state.speed);
    }
  }

  function setLanguage(language) {
    state.language = language;
    renderCode();
  }

  /* ---------------- 输入表单 ---------------- */

  function inputFieldsHTML() {
    var algorithm = state.algorithm;
    var draft = state.draft;
    var fields = '';

    function textField(key, label, placeholder, maxLength, numeric) {
      return (
        '<label>' + esc(label) +
        '<input id="draft-' + key + '" value="' + esc(draft[key] || '') + '" maxlength="' + maxLength + '"' +
        (numeric ? ' inputmode="numeric"' : '') + ' placeholder="' + esc(placeholder) + '" />' +
        '</label>'
      );
    }

    if (['two-pointers', 'binary-search', 'hash-two-sum', 'merge-sort', 'quick-sort'].indexOf(algorithm) >= 0) {
      var valueLabel = algorithm === 'hash-two-sum' ? '原始数组（可无序）'
        : (algorithm === 'two-pointers' || algorithm === 'binary-search') ? '升序数组'
        : '待排序数组';
      fields += textField('values', valueLabel, '如 1, 2, 4, 7；空数组可填 []', 120, false);
      if (['two-pointers', 'binary-search', 'hash-two-sum'].indexOf(algorithm) >= 0) {
        fields += textField('target', '目标值', '整数', 8, true);
      }
    } else if (algorithm === 'brackets') {
      fields += textField('brackets', '括号串', '如 ([{}])；也可以留空', 17, false);
    } else if (algorithm === 'sliding-window') {
      fields += textField('window', '字符串', '如 abcaabcbb；也可以留空', 13, false);
    } else if (algorithm === 'stairs') {
      fields += textField('stairs', '台阶数', '0～20', 4, true);
    } else if (algorithm === 'interval-greedy') {
      fields += textField('intervals', '区间列表', '如 1-3, 2-4, 3-5', 120, false);
    } else if (algorithm === 'bfs') {
      fields += '<label>网格（每行一排）<textarea id="draft-grid" rows="5" maxlength="80" spellcheck="false" placeholder="S..&#10;.#.&#10;..E">' + esc(draft.grid || '') + '</textarea></label>';
    }

    return fields;
  }

  function collectDraft() {
    var draft = cloneInput(state.draft);
    var keys = ['values', 'target', 'brackets', 'stairs', 'window', 'intervals'];
    keys.forEach(function (key) {
      var el = document.getElementById('draft-' + key);
      if (el) draft[key] = el.value;
    });
    var gridEl = document.getElementById('draft-grid');
    if (gridEl) draft.grid = gridEl.value;
    return draft;
  }

  function inputSummary() {
    var trace = state.trace;
    if (state.algorithm === 'brackets' || state.algorithm === 'sliding-window') return trace.text || '空串';
    if (state.algorithm === 'bfs') return (trace.grid ? trace.grid.height + ' 行 × ' + trace.grid.width + ' 列' : '空网格');
    if (state.algorithm === 'stairs') return trace.n + ' 层台阶';
    if (state.algorithm === 'interval-greedy') return (state.frames[0] && state.frames[0].intervals ? state.frames[0].intervals.length : 0) + ' 个区间';
    return trace.values.length + ' 个数';
  }

  /* ---------------- 变量面板 ---------------- */

  function variableItems() {
    var trace = state.trace;
    var f = frame();
    if (state.algorithm === 'brackets') {
      return [
        ['读取位置', f.cursor !== undefined && f.cursor < (trace.text || '').length ? String(f.cursor) : '已读完'],
        ['栈（底 → 顶）', (f.stack || []).map(function (entry) { return entry.char; }).join(' ') || '空'],
        ['栈大小', String((f.stack || []).length)],
      ];
    }
    if (state.algorithm === 'hash-two-sum') {
      return [
        ['当前下标 i', (f.cursor !== undefined && f.cursor >= 0) ? String(f.cursor) : '未开始'],
        ['需要补数 need', f.needed === undefined ? '未计算' : String(f.needed)],
        ['表中元素数', String((f.hashEntries || []).length)],
        ['目标 target', String(trace.target)],
      ];
    }
    if (state.algorithm === 'sliding-window') {
      var left = f.left !== undefined ? f.left : 0;
      var end = f.windowEnd !== undefined ? f.windowEnd : -1;
      return [
        ['当前有效窗口', left <= end ? '[' + left + ', ' + end + ']' : '空'],
        ['窗口长度', String(Math.max(0, end - left + 1))],
        ['最长长度', String(f.bestLength || 0)],
        ['最优窗口示例', (f.bestLength || 0) ? (trace.text || '').slice(f.bestStart, (f.bestEnd !== undefined ? f.bestEnd : -1) + 1) : '空'],
      ];
    }
    if (state.algorithm === 'bfs') {
      var grid = trace.grid;
      return [
        ['当前格子（行,列）', f.current === undefined ? '无' : '(' + Math.floor(f.current / grid.width) + ', ' + (f.current % grid.width) + ')'],
        ['当前最少步数', f.current === undefined ? '—' : String((f.distances || [])[f.current] !== undefined ? f.distances[f.current] : '未访问')],
        ['队列大小', String((f.queue || []).length)],
        ['正在检查邻居', f.neighbor ? '(' + f.neighbor.row + ', ' + f.neighbor.col + ')' : '无'],
      ];
    }
    if (state.algorithm === 'interval-greedy') {
      return [
        ['当前区间', f.intervalCursor === undefined || f.intervalCursor < 0 ? '未开始' : String(f.intervalCursor + 1)],
        ['已选数量', String((f.selected || []).length)],
        ['已选原始下标', (f.selected || []).join(', ') || '无'],
        ['按结束时间排序', (f.intervals || []).map(function (item) { return item.start + '-' + item.end; }).join(' · ') || '空'],
      ];
    }
    if (state.algorithm === 'merge-sort' || state.algorithm === 'quick-sort') {
      return [
        ['当前区间', f.left === undefined ? '未开始' : '[' + f.left + ', ' + f.right + ']'],
        ['比较下标', (f.compareIndices || []).join(', ') || '无'],
        ['当前数组', (f.array || trace.values).join(', ') || '空'],
        ['已定位基准', f.active === undefined ? '无' : String(f.active)],
      ];
    }
    if (state.algorithm === 'stairs') {
      return [
        ['当前层 i', f.active === undefined ? '尚未开始' : String(f.active)],
        ['当前 dp[i]', f.active === undefined ? '?' : String((f.dp || [])[f.active] !== null && (f.dp || [])[f.active] !== undefined ? f.dp[f.active] : '?')],
        ['目标层 n', String(trace.n)],
      ];
    }
    // two-pointers / binary-search
    return [
      ['left', String(f.left)],
      ['right', String(f.right)],
      [state.algorithm === 'binary-search' ? 'mid' : '当前比较的和', String((state.algorithm === 'binary-search' ? f.mid : f.sum) !== undefined ? (state.algorithm === 'binary-search' ? f.mid : f.sum) : '尚未计算')],
      ['target', String(trace.target)],
    ];
  }

  /* ---------------- SVG 场景 ---------------- */

  function pos(index) {
    return 40 + index * 56;
  }

  function arrayCell(value, index, kind) {
    return (
      '<g class="cell ' + kind + '" transform="translate(' + pos(index) + ',80)">' +
      '<rect x="-23" y="0" width="46" height="42" rx="5"></rect>' +
      '<text class="cell-value" y="26" text-anchor="middle">' + esc(value) + '</text>' +
      '<text class="cell-index" y="62" text-anchor="middle">' + index + '</text>' +
      '</g>'
    );
  }

  function charCell(char, index, kind, y) {
    return (
      '<g class="cell ' + kind + '" transform="translate(' + pos(index) + ',' + (y || 70) + ')">' +
      '<rect x="-23" y="0" width="46" height="42" rx="5"></rect>' +
      '<text class="cell-value" y="26" text-anchor="middle">' + esc(char) + '</text>' +
      '<text class="cell-index" y="56" text-anchor="middle">' + index + '</text>' +
      '</g>'
    );
  }

  function pointer(label, index, y, kind) {
    if (index === undefined || index === null || index < 0) return '';
    var arrow = kind === 'right'
      ? '<path d="M0 -17V-32m-4 4 4-4 4 4"></path>'
      : '<path d="M0 15V' + (76 - y) + 'm-4 -4 4 4 4 -4"></path>';
    return (
      '<g class="pointer pointer-' + kind + '" transform="translate(' + pos(index) + ',' + y + ')">' +
      '<rect x="-17" y="-12" width="34" height="23" rx="5"></rect>' +
      '<text y="4" text-anchor="middle">' + esc(label) + '</text>' + arrow +
      '</g>'
    );
  }

  function arrayLegend(algorithm) {
    if (algorithm === 'binary-search') {
      return '<div class="legend"><span><i class="legend-left"></i>L 左端</span><span><i class="legend-right"></i>R 右端</span><span><i class="legend-mid"></i>mid 中点</span><span><i class="legend-excluded"></i>已排除</span></div>';
    }
    if (algorithm === 'two-pointers') {
      return '<div class="legend"><span><i class="legend-left"></i>L 左端</span><span><i class="legend-right"></i>R 右端</span><span><i class="legend-excluded"></i>已排除</span></div>';
    }
    return '<div class="legend"><span><i class="legend-mid"></i>比较 / 写入</span><span><i class="legend-excluded"></i>区间外</span></div>';
  }

  function arrayScene() {
    var trace = state.trace;
    var f = frame();
    var values = f.array || trace.values || [];
    var isSort = state.algorithm === 'merge-sort' || state.algorithm === 'quick-sort';
    var width = Math.max(360, values.length * 56 + 40);
    var cells = '';
    var pointers = '';

    values.forEach(function (value, index) {
      var kind = 'candidate';
      if (!isSort) {
        var left = f.left !== undefined ? f.left : 0;
        var right = f.right !== undefined ? f.right : values.length - 1;
        var found = f.phase === 'found' && (Array.isArray(f.result) ? f.result.indexOf(index) >= 0 : f.result === index);
        var compared = (f.compareIndices || []).indexOf(index) >= 0;
        if (found) kind = 'found';
        else if (compared) kind = 'mid';
        else if (index < left || index > right) kind = 'excluded';
        else if (index === f.mid) kind = 'mid';
        else if (index === f.left) kind = 'left';
        else if (index === f.right) kind = 'right';
      } else {
        var inRange = f.left === undefined || (index >= f.left && index <= f.right);
        var compared2 = (f.compareIndices || []).indexOf(index) >= 0;
        var isPivot = state.algorithm === 'quick-sort' && f.mid === index;
        if (compared2) kind = 'mid';
        else if (isPivot) kind = 'pivot';
        else if (f.active === index) kind = 'active';
        else if (!inRange) kind = 'muted';
      }
      cells += arrayCell(value, index, kind);
    });

    if (!isSort) {
      if (state.algorithm === 'two-pointers') {
        pointers += pointer('L', f.left, 23, 'left') + pointer('R', f.right, 182, 'right');
      } else if (state.algorithm === 'binary-search') {
        pointers += pointer('L', f.left, 23, 'left') + pointer('mid', f.mid, 57, 'mid') + pointer('R', f.right, 182, 'right');
      }
    }

    var empty = values.length ? '' : '<text class="empty-text" x="' + (width / 2) + '" y="100" text-anchor="middle">空数组</text>';
    return (
      '<div class="array-viewport"><svg class="array-svg" width="' + width + '" height="200" viewBox="0 0 ' + width + ' 200">' +
      cells + pointers + empty +
      '</svg></div>' + arrayLegend(state.algorithm)
    );
  }

  function hashScene() {
    var trace = state.trace;
    var f = frame();
    var values = trace.values || [];
    var cursor = f.cursor !== undefined ? f.cursor : -1;
    var entries = f.hashEntries || [];
    var width = Math.max(360, values.length * 56 + 40);
    var cells = '';

    values.forEach(function (value, index) {
      var found = f.phase === 'found' && Array.isArray(f.result) && f.result.indexOf(index) >= 0;
      var kind = found ? 'found' : (index === cursor ? 'mid' : (index < cursor ? 'left' : 'candidate'));
      cells += arrayCell(value, index, kind);
    });

    var iPointer = cursor >= 0 && cursor < values.length
      ? '<g class="pointer pointer-mid" transform="translate(' + pos(cursor) + ',24)"><rect x="-16" y="-11" width="32" height="23" rx="5"></rect><text y="4" text-anchor="middle">i</text><path d="M0 15V42m-4 -4 4 4 4 -4"></path></g>'
      : '';

    var empty = values.length ? '' : '<text class="empty-text" x="' + (width / 2) + '" y="90" text-anchor="middle">空数组 · 没有数对</text>';

    var tableRows = entries.length
      ? entries.map(function (entry) {
          var isMatch = f.matching !== undefined && entry.index === f.matching;
          return '<div class="hash-row' + (isMatch ? ' is-matching' : '') + '"><strong>' + esc(entry.value) + '</strong><span>→</span><small>' + entry.index + '</small></div>';
        }).join('')
      : '<p class="muted">空表 · 当前元素还没有入表</p>';

    return (
      '<div class="hash-scene">' +
      '<div class="array-viewport"><svg class="array-svg" width="' + width + '" height="153" viewBox="0 0 ' + width + ' 153">' + cells + iPointer + empty + '</svg></div>' +
      '<div class="hash-needed"><span>当前需要的补数</span><strong>' + (f.needed !== undefined ? f.needed : '尚未计算') + '</strong><small>target − 当前值</small></div>' +
      '<div class="hash-heading">已经见过的元素 · 数值 → 原始下标</div><div class="hash-table">' + tableRows + '</div>' +
      '<p class="note">先查询，后保存。表不是排序后的数组，保存的是原始位置。</p>' +
      '</div>'
    );
  }

  function windowScene() {
    var trace = state.trace;
    var f = frame();
    var text = trace.text || '';
    var entries = f.seen || [];
    var width = Math.max(360, text.length * 56 + 40);
    var cells = '';

    Array.prototype.forEach.call(text, function (char, index) {
      var inside = index >= (f.left !== undefined ? f.left : 0) && index <= (f.windowEnd !== undefined ? f.windowEnd : -1);
      var candidate = index === f.cursor && index > (f.windowEnd !== undefined ? f.windowEnd : -1);
      var kind = candidate ? 'mid' : (inside ? 'left' : (index === f.matching ? 'matching' : 'candidate'));
      cells += charCell(char, index, kind, 70);
    });

    var band = '';
    if (f.left !== undefined && f.windowEnd !== undefined && f.left <= f.windowEnd) {
      band = '<rect class="window-band" x="' + (pos(f.left) - 23) + '" y="135" height="5" width="' + ((f.windowEnd - f.left) * 56 + 46) + '" rx="2"></rect>';
    }
    var bestBand = '';
    if ((f.bestLength || 0) > 0) {
      bestBand = '<rect class="window-best-band" x="' + (pos(f.bestStart || 0) - 23) + '" y="146" height="4" width="' + (((f.bestEnd || 0) - (f.bestStart || 0)) * 56 + 46) + '" rx="2"></rect>';
    }

    var leftPtr = f.left !== undefined && f.left >= 0 && f.left < text.length
      ? pointer('L', f.left, 24, 'left') : '';
    var rightPtr = f.right !== undefined && f.right >= 0 && f.right < text.length
      ? pointer('R', f.right, 179, 'right') : '';

    var empty = text ? '' : '<text class="empty-text" x="' + (width / 2) + '" y="98" text-anchor="middle">空串 · 长度 0</text>';

    var tableValues = entries.length
      ? entries.map(function (entry) {
          return '<span class="seen-token' + (entry.index === f.matching ? ' is-duplicate' : '') + '"><strong>' + esc(entry.char) + '</strong><small>下标 ' + entry.index + '</small></span>';
        }).join('')
      : '<small class="muted">空 · 全部为 false</small>';

    return (
      '<div class="window-scene">' +
      '<div class="array-viewport"><svg class="array-svg window-array" width="' + width + '" height="196" viewBox="0 0 ' + width + ' 196">' +
      cells + band + bestBand + leftPtr + rightPtr + empty +
      '</svg></div>' +
      '<div class="legend"><span><i class="legend-left"></i>当前有效窗口</span><span><i class="legend-right"></i>最优窗口</span><span><i class="legend-mid"></i>候选字符</span></div>' +
      '<div class="window-table"><span>字符表中为 true 的项</span><div>' + tableValues + '</div></div>' +
      '<p class="note">L 是窗口左端；R 是正尝试加入的右端。表中只展示 true 的项。</p>' +
      '</div>'
    );
  }

  function stackScene() {
    var trace = state.trace;
    var f = frame();
    var text = trace.text || '';
    var stack = f.stack || [];
    var paired = f.paired || [];
    var width = Math.max(360, text.length * 56 + 40);
    var cells = '';

    Array.prototype.forEach.call(text, function (char, index) {
      var kind = 'candidate';
      if (index === f.cursor) kind = 'mid';
      if (paired.indexOf(index) >= 0) kind = 'paired';
      if (index === f.matching) kind = 'matching';
      cells += charCell(char, index, kind, 50);
    });

    var emptyText = text ? '' : '<text class="empty-text" x="' + (width / 2) + '" y="40" text-anchor="middle">空字符串</text>';

    var tokens = stack.map(function (entry, index) {
      var y = 210 - index * 40;
      var top = index === stack.length - 1;
      return (
        '<g class="stack-token' + (entry.index === f.matching ? ' is-matching' : '') + '" transform="translate(' + (width / 2) + ',' + y + ')">' +
        '<rect x="-34" y="-18" width="68" height="34" rx="5"></rect>' +
        '<text y="0" text-anchor="middle">' + esc(entry.char) + '</text>' +
        '<text class="cell-index" y="13" text-anchor="middle">下标 ' + entry.index + '</text>' +
        (top ? '<text class="stack-top" x="40" y="0">← 栈顶</text>' : '') +
        '</g>'
      );
    }).join('');

    var stackEmpty = stack.length ? '' : '<text class="empty-text" x="' + (width / 2) + '" y="210" text-anchor="middle">空栈</text>';

    var pair = '';
    if (f.phase === 'match' || f.phase === 'pop') {
      pair = '<div class="pair-note">配对下标 ' + f.matching + ' → ' + f.cursor + '</div>';
    }

    return (
      '<div class="stack-scene">' +
      '<svg class="array-svg" width="' + width + '" height="260" viewBox="0 0 ' + width + ' 260">' + cells + emptyText + tokens + stackEmpty + '</svg>' +
      pair +
      '<div class="legend"><span><i class="legend-mid"></i>当前读取</span><span><i class="legend-left"></i>已配对</span><span><i class="legend-excluded"></i>正在匹配</span></div>' +
      '</div>'
    );
  }

  function dpScene() {
    var f = frame();
    var dp = f.dp || [];
    var active = f.active !== undefined ? f.active : 0;
    var width = Math.max(360, dp.length * 56 + 40);
    var cells = '';
    var arrows = '';

    dp.forEach(function (value, index) {
      var kind = 'candidate';
      if (index === active) kind = 'active';
      if ((f.dependencies || []).indexOf(index) >= 0) kind = 'dependency';
      cells += (
        '<g class="cell ' + kind + '" transform="translate(' + pos(index) + ',120)">' +
        '<rect x="-23" y="0" width="46" height="42" rx="5"></rect>' +
        '<text class="cell-value" y="26" text-anchor="middle">' + (value === null || value === undefined ? '?' : value) + '</text>' +
        '<text class="cell-index" y="62" text-anchor="middle">' + index + '</text>' +
        '</g>'
      );
    });

    if (active >= 2 && f.dependencies) {
      var xA = pos(active - 2), xB = pos(active - 1), xC = pos(active);
      arrows =
        '<path class="dp-arrow" d="M' + xA + ' 96 C ' + xA + ' 60, ' + xC + ' 60, ' + xC + ' 96"></path>' +
        '<path class="dp-arrow" d="M' + xB + ' 96 C ' + xB + ' 60, ' + xC + ' 60, ' + xC + ' 96"></path>';
    }

    return (
      '<div class="dp-scene">' +
      '<svg class="array-svg" width="' + width + '" height="170" viewBox="0 0 ' + width + ' 170">' + arrows + cells + '</svg>' +
      '<div class="legend"><span><i class="legend-mid"></i>当前状态</span><span><i class="legend-left"></i>已知依赖</span><span>？ 尚未计算</span></div>' +
      '</div>'
    );
  }

  function bfsScene() {
    var trace = state.trace;
    var f = frame();
    var grid = trace.grid;
    if (!grid) return '<p class="empty-text">无网格</p>';
    var distances = f.distances || [];
    var queue = f.queue || [];
    var cell = 46, pad = 26;
    var width = grid.width * cell + pad, height = grid.height * cell + pad;
    var coord = function (index) { return '(' + Math.floor(index / grid.width) + ', ' + (index % grid.width) + ')'; };
    var center = function (index) { return { x: 36 + (index % grid.width) * cell, y: 36 + Math.floor(index / grid.width) * cell }; };

    var cells = '';
    for (var index = 0; index < grid.width * grid.height; index++) {
      var p = center(index);
      var char = grid.rows[Math.floor(index / grid.width)][index % grid.width];
      var stateName = char === '#' ? 'wall' : 'unknown';
      if (char !== '#') {
        if (f.path && f.path.indexOf(index) >= 0) stateName = 'path';
        else if (index === f.current) stateName = 'current';
        else if (queue.indexOf(index) >= 0) stateName = 'queued';
        else if (distances[index] >= 0) stateName = 'seen';
      }
      var label = char === '#' ? '×' : (distances[index] >= 0 ? distances[index] : '·');
      var marker = (char !== '.' && char !== '#') ? '<text class="bfs-marker" x="-14" y="-9">' + esc(char) + '</text>' : '';
      cells += (
        '<g class="bfs-cell bfs-' + stateName + '" transform="translate(' + p.x + ',' + p.y + ')">' +
        '<rect x="-19" y="-19" width="38" height="38" rx="5"></rect>' +
        '<text class="bfs-label" y="5" text-anchor="middle">' + label + '</text>' + marker +
        '</g>'
      );
    }

    var pathLine = '';
    if (f.path && f.path.length) {
      var pts = f.path.map(function (i) { var c = center(i); return c.x + ',' + c.y; }).join(' ');
      pathLine = '<polyline class="bfs-path-line" points="' + pts + '"></polyline>';
    }

    var queueHtml = queue.length
      ? queue.map(function (i) { return '<span class="queue-token"><strong>' + coord(i) + '</strong><small>距离 ' + distances[i] + '</small></span>'; }).join('')
      : '<span class="queue-empty">空队列</span>';

    return (
      '<div class="bfs-scene">' +
      '<svg class="bfs-grid" viewBox="0 0 ' + width + ' ' + height + '">' + cells + pathLine + '</svg>' +
      '<div class="legend"><span><i class="legend-mid"></i>当前 / 检查邻居</span><span><i class="legend-left"></i>入队 / 路径</span><span>数字＝最少步数 · × 障碍</span></div>' +
      '<div class="queue-heading">先进先出队列 · ' + queue.length + ' 格</div><div class="queue">' + queueHtml + '</div>' +
      '<p class="note">入队时就写距离。金色连接展示当前检查；绿色折线是找到的最短路径。</p>' +
      '</div>'
    );
  }

  function intervalScene() {
    var f = frame();
    var intervals = f.intervals || [];
    var selected = f.selected || [];
    if (!intervals.length) return '<p class="empty-text">没有区间</p>';

    var min = Math.min.apply(null, intervals.map(function (v) { return v.start; }));
    var max = Math.max.apply(null, intervals.map(function (v) { return v.end; }));
    var span = Math.max(1, max - min);
    var scale = function (x) { return 70 + ((x - min) / span) * 540; };
    var width = 680, rowH = 46;
    var rows = '';

    intervals.forEach(function (item, idx) {
      var kind = selected.indexOf(item.index) >= 0 ? 'selected' : (idx === f.intervalCursor ? 'current' : 'candidate');
      var x = scale(item.start);
      var w = Math.max(12, scale(item.end) - scale(item.start));
      rows += (
        '<g class="interval-row ' + kind + '" transform="translate(0,' + (44 + idx * rowH) + ')">' +
        '<text class="interval-label" x="8" y="0">' + item.start + '-' + item.end + '</text>' +
        '<rect x="' + x + '" y="-14" width="' + w + '" height="28" rx="5"></rect>' +
        '<text class="interval-index" x="' + (x + w / 2) + '" y="0" text-anchor="middle">原下标 ' + item.index + '</text>' +
        '</g>'
      );
    });

    return (
      '<div class="interval-scene">' +
      '<svg class="interval-svg" viewBox="0 0 ' + width + ' ' + (44 + intervals.length * rowH + 20) + '">' + rows + '</svg>' +
      '<div class="legend"><span><i class="legend-left"></i>已选择</span><span><i class="legend-mid"></i>当前检查</span><span>按结束时间排序</span></div>' +
      '</div>'
    );
  }

  function sceneHTML() {
    switch (state.algorithm) {
      case 'hash-two-sum': return hashScene();
      case 'sliding-window': return windowScene();
      case 'bfs': return bfsScene();
      case 'interval-greedy': return intervalScene();
      case 'brackets': return stackScene();
      case 'stairs': return dpScene();
      default: return arrayScene();
    }
  }

  /* ---------------- 渲染 ---------------- */

  function resultText(f) {
    var r = f.result;
    if (r === undefined) return null;
    if (r === null) return '没有数对';
    if (r === false) return 'false';
    if (r === true) return 'true';
    if (Array.isArray(r)) return '[' + r.join(', ') + ']';
    return String(r);
  }

  function renderViewer() {
    var meta = ALGORITHMS[state.algorithm];
    var options = Object.keys(ALGORITHMS).map(function (id) {
      return '<option value="' + id + '"' + (id === state.algorithm ? ' selected' : '') + '>' + esc(ALGORITHMS[id].name) + '</option>';
    }).join('');

    viewerEl.innerHTML =
      '<div class="viewer">' +
      '<header class="viewer-top">' +
        '<button id="backBtn" class="btn" type="button">← 返回目录</button>' +
        '<label class="inline-label">算法<select id="algoSelect">' + options + '</select></label>' +
        '<label class="inline-label">语言<select id="langSelect">' +
          '<option value="cpp"' + (state.language === 'cpp' ? ' selected' : '') + '>C++</option>' +
          '<option value="python"' + (state.language === 'python' ? ' selected' : '') + '>Python</option>' +
        '</select></label>' +
      '</header>' +

      '<section class="meta">' +
        '<h2 id="algoTitle">' + esc(meta.name) + '</h2>' +
        '<p id="algoCondition">' + esc(meta.condition) + '</p>' +
      '</section>' +

      '<details class="input-panel" id="inputPanel">' +
        '<summary>修改输入 <span id="inputSummary">' + esc(inputSummary()) + '</span></summary>' +
        '<form id="inputForm">' + inputFieldsHTML() +
          '<div class="input-actions"><button class="btn primary" type="submit">应用输入</button><button class="btn" id="cancelBtn" type="button">取消修改</button></div>' +
        '</form>' +
        '<p id="inputError" class="error" role="alert" hidden></p>' +
      '</details>' +

      '<div class="viewer-columns">' +
        '<div class="visual"><div class="scene" id="scene" data-phase="' + esc(frame().phase || '') + '">' + sceneHTML() + '</div><div class="expression" id="expression"></div></div>' +
        '<aside class="explanation" id="explanation"></aside>' +
        '<aside class="inspector">' +
          '<div class="variables" id="variables"></div>' +
          '<details class="code-panel" open><summary>对照 <span id="codeLangLabel">' + (state.language === 'cpp' ? 'C++' : 'Python') + '</span> 核心代码</summary><pre id="codeBlock"></pre></details>' +
          '<div class="principle"><strong>记住这一个规则</strong><p id="principleText">' + esc(meta.principle) + '</p><div class="complexity"><span>时间 ' + esc(meta.time) + '</span><span>辅助空间 ' + esc(meta.space) + '</span></div><small>这是算法本身的复杂度；演示另外保存了每一步的状态快照。</small></div>' +
        '</aside>' +
      '</div>' +

      '<footer class="player">' +
        '<div class="progress"><span id="progressText"></span><span id="stateText"></span></div>' +
        '<input class="timeline" id="timeline" type="range" min="0" max="' + last() + '" value="' + state.index + '" aria-label="演示时间轴" />' +
        '<div class="buttons">' +
          '<button class="btn icon" id="btnFirst" type="button" aria-label="回到开头">⏮</button>' +
          '<button class="btn icon" id="btnPrev" type="button" aria-label="上一步">◀</button>' +
          '<button class="btn primary play" id="btnPlay" type="button">▶ 播放</button>' +
          '<button class="btn icon" id="btnNext" type="button" aria-label="下一步">▶</button>' +
          '<button class="btn icon" id="btnLast" type="button" aria-label="跳到结尾">⏭</button>' +
        '</div>' +
        '<div class="options"><label>速度<select id="speedSelect">' +
          '<option value="0.5"' + (state.speed === 0.5 ? ' selected' : '') + '>0.5× 慢速</option>' +
          '<option value="1"' + (state.speed === 1 ? ' selected' : '') + '>1×</option>' +
          '<option value="2"' + (state.speed === 2 ? ' selected' : '') + '>2×</option>' +
        '</select></label></div>' +
      '</footer>' +
      '</div>';

    on('backBtn', 'click', backToGallery);
    on('algoSelect', 'change', function (event) { openAlgorithm(event.target.value); });
    on('langSelect', 'change', function (event) { setLanguage(event.target.value); });
    on('inputForm', 'submit', function (event) { event.preventDefault(); applyDraft(); });
    on('cancelBtn', 'click', cancelDraft);
    on('btnFirst', 'click', function () { seek(0); });
    on('btnPrev', 'click', function () { seek(state.index - 1); });
    on('btnNext', 'click', function () { seek(state.index + 1); });
    on('btnLast', 'click', function () { seek(last()); });
    on('btnPlay', 'click', togglePlay);
    on('timeline', 'input', function (event) { seek(Number(event.target.value)); });
    on('speedSelect', 'change', function (event) { setSpeed(Number(event.target.value)); });
    on('inputPanel', 'toggle', function () { if (document.getElementById('inputPanel').open) pause(); });

    renderCode();
    updateFrame();
  }

  function renderCode() {
    var block = document.getElementById('codeBlock');
    var label = document.getElementById('codeLangLabel');
    if (!block) return;
    if (label) label.textContent = state.language === 'cpp' ? 'C++' : 'Python';
    var lines = coreCode(state.algorithm, state.language);
    block.innerHTML = lines.map(function (line) {
      return '<code class="code-line" data-id="' + esc(line.id) + '">' + esc(line.text) + '</code>';
    }).join('');
    highlightCode();
  }

  function highlightCode() {
    var block = document.getElementById('codeBlock');
    if (!block) return;
    var activeId = frame().line;
    block.querySelectorAll('.code-line').forEach(function (node) {
      node.classList.toggle('is-active', node.getAttribute('data-id') === activeId);
    });
  }

  function updateFrame() {
    if (viewerEl.hidden) return;
    var f = frame();
    var scene = document.getElementById('scene');
    var explanation = document.getElementById('explanation');
    var variables = document.getElementById('variables');
    var expression = document.getElementById('expression');
    var progress = document.getElementById('progressText');
    var stateText = document.getElementById('stateText');
    var timeline = document.getElementById('timeline');
    var playBtn = document.getElementById('btnPlay');

    if (scene) { scene.setAttribute('data-phase', f.phase || ''); scene.innerHTML = sceneHTML(); }
    if (expression) expression.textContent = f.expression || '';

    if (explanation) {
      var result = resultText(f);
      explanation.innerHTML =
        '<div class="step-head"><span>' + String(state.index + 1).padStart(2, '0') + '</span><h3>' + esc(f.title || '') + '</h3></div>' +
        '<p>' + esc(f.detail || '') + '</p>' +
        (result !== null ? '<div class="result">结果 <strong>' + esc(result) + '</strong></div>' : '');
    }

    if (variables) {
      variables.innerHTML = variableItems().map(function (item) {
        return '<div class="var"><dt>' + esc(item[0]) + '</dt><dd>' + esc(item[1]) + '</dd></div>';
      }).join('');
    }

    if (progress) progress.textContent = '步骤 ' + (state.index + 1) + ' / ' + (last() + 1);
    if (stateText) stateText.textContent = state.playing ? '播放中' : (state.index === last() ? '已结束' : '已暂停');
    if (timeline) { timeline.max = String(last()); timeline.value = String(state.index); }
    if (playBtn) playBtn.innerHTML = state.playing ? '⏸ 暂停' : (state.index === last() ? '↺ 重播' : '▶ 播放');

    var btnFirst = document.getElementById('btnFirst'), btnPrev = document.getElementById('btnPrev');
    var btnNext = document.getElementById('btnNext'), btnLast = document.getElementById('btnLast');
    if (btnFirst) btnFirst.disabled = state.index === 0;
    if (btnPrev) btnPrev.disabled = state.index === 0;
    if (btnNext) btnNext.disabled = state.index === last();
    if (btnLast) btnLast.disabled = state.index === last();

    highlightCode();
  }

  renderGallery();
})();
