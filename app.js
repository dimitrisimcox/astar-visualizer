/* A* Pathfinding Visualizer
 *
 * Each search runs to completion first and records the order in which it
 * expanded cells. Playback, stepping and the timeline replay that record, so
 * any moment of a search can be revisited exactly. All four searches rerun on
 * every change, which is what fills the comparison table. The searches and
 * the layout generators live in search.js; this file is the page. */
(() => {
  'use strict';

  const { OPEN, WALL, MUD, MUD_COST } = Pathfinding;
  const MAX_CELL = 28; // px
  const MUD_DOTS = [[0.28, 0.3], [0.7, 0.44], [0.42, 0.74]];

  const ALGORITHMS = [
    { id: 'astar', label: 'A*', short: 'A*' },
    { id: 'dijkstra', label: 'Dijkstra', short: 'Dijkstra' },
    { id: 'greedy', label: 'Greedy best-first', short: 'Greedy' },
    { id: 'bfs', label: 'Breadth-first', short: 'Breadth-first' },
  ];
  const HEURISTIC_LABELS = {
    octile: 'Octile',
    manhattan: 'Manhattan',
    euclidean: 'Euclidean',
    chebyshev: 'Chebyshev',
  };
  const LAYOUTS = {
    terrain: 'Walls and mud',
    division: 'Recursive division',
    backtracker: 'Backtracking maze',
    swamp: 'Open field, heavy mud',
  };
  // Cells expanded per second at each speed setting; the last setting jumps to the end.
  const SPEEDS = [4, 8, 15, 30, 60, 120, 240, 480, 960, Infinity];

  const grid = { rows: 0, cols: 0, terrain: new Uint8Array(0), start: 0, goal: 0 };
  const state = {
    algorithm: 'astar',
    heuristic: 'octile',
    weight: 1,
    diagonal: true,
    speed: 6,
    brush: 'wall',
    layout: 'terrain',
    seed: 0, // seed of the generated layout
    edited: false, // whether the grid has changed since it was generated
    results: null, // one finished search per algorithm, for the current grid and settings
    step: 0, // how many expansions of the current search are on screen
    playing: false,
  };
  const current = () => state.results[state.algorithm];

  /* ---------- page ---------- */

  const options = (pairs) => pairs.map(([value, text]) => `<option value="${value}">${text}</option>`).join('');

  const app = document.getElementById('app');
  app.classList.add('app');
  app.innerHTML = `
    <header class="masthead">
      <h1>A* Pathfinding Visualizer</h1>
      <p class="lede">Draw walls and mud, drag the start and goal, and watch a search grow its frontier. A* always expands the open cell with the lowest <span class="formula">f = g + w·h</span>: the cost so far plus a weighted estimate of the cost left.</p>
    </header>

    <section class="controls" aria-label="Search settings">
      <div class="field">
        <label for="algo">Search</label>
        <select id="algo">${options(ALGORITHMS.map((a) => [a.id, a.label]))}</select>
      </div>
      <div class="field">
        <label for="heur">Heuristic h</label>
        <select id="heur">${options(Object.entries(HEURISTIC_LABELS))}</select>
      </div>
      <div class="field">
        <label for="weight">Weight w <output id="weightOut" for="weight">1.0</output></label>
        <input type="range" id="weight" min="1" max="3" step="0.1" value="1">
      </div>
      <div class="field">
        <span class="label" id="movesLabel">Moves</span>
        <label class="toggle"><input type="checkbox" id="diag" checked aria-describedby="movesLabel"> Diagonal steps</label>
      </div>
      <div class="field">
        <label for="speed">Speed <output id="speedOut" for="speed"></output></label>
        <input type="range" id="speed" min="1" max="10" step="1" value="6">
      </div>
    </section>

    <section class="toolbar" aria-label="Playback and drawing">
      <div class="group" role="group" aria-label="Playback">
        <button type="button" id="run" class="primary">Run</button>
        <button type="button" id="stepBtn">Step</button>
        <button type="button" id="clearSearch">Clear search</button>
      </div>
      <div class="group" role="group" aria-labelledby="brushLabel">
        <span class="label" id="brushLabel">Brush</span>
        <button type="button" class="brush" data-brush="wall" aria-pressed="true">Wall</button>
        <button type="button" class="brush" data-brush="mud" aria-pressed="false">Mud ×${MUD_COST}</button>
        <button type="button" class="brush" data-brush="erase" aria-pressed="false">Erase</button>
      </div>
      <div class="group">
        <label class="label" for="layout">Layout</label>
        <select id="layout">${options(Object.entries(LAYOUTS))}</select>
        <button type="button" id="newLayout">New</button>
        <button type="button" id="clearGrid">Clear grid</button>
      </div>
    </section>

    <div class="stage">
      <div class="board" id="board">
        <canvas id="grid" role="img" aria-label="Search grid. Drag across it to draw, or drag the start and goal to move them."></canvas>
        <div class="timeline">
          <label class="label" for="timeline">Timeline</label>
          <input type="range" id="timeline" min="0" max="0" value="0">
          <span class="mono" id="stepOut"></span>
        </div>
        <p class="readout" id="readout"></p>
      </div>

      <aside class="rail">
        <section class="card">
          <h2>This search</h2>
          <p class="status" id="status" aria-live="polite"></p>
          <dl class="stats">
            <dt>Cells expanded</dt><dd id="sExpanded"></dd>
            <dt>Frontier peak</dt><dd id="sPeak"></dd>
            <dt>Route length</dt><dd id="sSteps"></dd>
            <dt>Route cost</dt><dd id="sCost"></dd>
            <dt>Search time</dt><dd id="sTime"></dd>
          </dl>
          <p class="note" id="note"></p>
        </section>

        <section class="card">
          <h2>All four on this grid</h2>
          <div class="table-wrap">
            <table class="compare">
              <thead><tr><th scope="col">Search</th><th scope="col">Expanded</th><th scope="col">Cost</th><th scope="col">vs cheapest</th></tr></thead>
              <tbody id="compareBody"></tbody>
            </table>
          </div>
        </section>

        <section>
          <h2>Legend</h2>
          <ul class="legend">
            <li><span class="swatch sw-start"></span>Start</li>
            <li><span class="swatch sw-goal"></span>Goal</li>
            <li><span class="swatch sw-wall"></span>Wall</li>
            <li><span class="swatch sw-mud"></span>Mud, costs ${MUD_COST}</li>
            <li><span class="swatch sw-frontier"></span>Frontier (open)</li>
            <li><span class="swatch sw-closed"></span>Expanded (closed)</li>
            <li><span class="swatch sw-route"></span>Route</li>
          </ul>
        </section>

        <p class="keys"><kbd>Space</kbd> run or pause · <kbd>←</kbd> <kbd>→</kbd> step · <kbd>C</kbd> clear search · <kbd>M</kbd> new layout · <kbd>1</kbd>–<kbd>4</kbd> pick a search · <kbd>D</kbd> diagonal steps</p>
      </aside>
    </div>

    <footer class="footer">A straight step costs 1 and a diagonal step √2, times ${MUD_COST} when it enters mud. Diagonal steps can't cut corners. Rebuilt in 2026 from a 2020 pygame experiment.</footer>
  `;

  const $ = (id) => document.getElementById(id);
  const canvas = $('grid'), ctx = canvas.getContext('2d'), board = $('board');
  const algoSel = $('algo'), heurSel = $('heur'), weightIn = $('weight'), diagIn = $('diag');
  const speedIn = $('speed'), layoutSel = $('layout'), timeline = $('timeline');
  const runBtn = $('run'), readout = $('readout'), statusEl = $('status'), compareBody = $('compareBody');

  // Rows are built once and updated in place, so a focused row button keeps its focus.
  compareBody.innerHTML = ALGORITHMS.map(({ id, short }) => `<tr data-algo="${id}">
      <th scope="row"><button type="button" class="pick">${short}</button></th>
      <td class="mono"></td><td class="mono"></td><td class="mono"></td>
    </tr>`).join('');

  const fmt = (x) => x.toFixed(1);
  const fmt2 = (x) => x.toFixed(2);
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const speedLabel = (v) => (SPEEDS[v - 1] === Infinity ? 'instant' : `${SPEEDS[v - 1]}/s`);

  /* ---------- drawing ---------- */

  let cell = 20, dpr = 1, fittedWidth = -1;

  function fitCanvas() {
    const width = board.clientWidth;
    const ratio = window.devicePixelRatio || 1;
    if (width === fittedWidth && ratio === dpr) return;
    fittedWidth = width;
    dpr = ratio;
    // Until someone edits the grid, a change of width can also pick a better-sized grid.
    const [rows, cols] = pickDims(width);
    const regrid = !state.edited && (rows !== grid.rows || cols !== grid.cols);
    if (regrid) {
      [grid.rows, grid.cols] = [rows, cols];
      hoverCell = -1;
    }
    cell = Math.max(6, Math.min(MAX_CELL, Math.floor(width / grid.cols)));
    const w = cell * grid.cols, h = cell * grid.rows;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!state.results) return;
    if (regrid) newLayout(state.seed);
    else draw();
  }

  function palette() {
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    return {
      cell: v('--cell'), grid: v('--grid'), wall: v('--wall'), mud: v('--mud'), mudDot: v('--mud-dot'),
      closed: v('--closed'), frontier: v('--frontier'), now: v('--now'), route: v('--route'),
      casing: v('--route-casing'), start: v('--start'), goal: v('--goal'),
    };
  }

  function draw() {
    const C = palette();
    const { rows, cols, terrain } = grid;
    const s = cell, res = current(), k = state.step;
    const W = cols * s, H = rows * s;
    const dotR = Math.max(1, s * 0.07), frontierR = Math.max(2, s * 0.2);

    ctx.fillStyle = C.cell;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < rows * cols; i++) {
      const x = (i % cols) * s, y = Math.floor(i / cols) * s, t = terrain[i];
      if (t === WALL) {
        ctx.fillStyle = C.wall;
        ctx.fillRect(x, y, s, s);
        continue;
      }
      if (t === MUD) {
        ctx.fillStyle = C.mud;
        ctx.fillRect(x, y, s, s);
      }
      const closed = res.closedAt[i] < k;
      if (closed) {
        ctx.globalAlpha = t === MUD ? 0.55 : 1;
        ctx.fillStyle = C.closed;
        ctx.fillRect(x, y, s, s);
        ctx.globalAlpha = 1;
      }
      if (t === MUD) {
        ctx.fillStyle = C.mudDot;
        ctx.beginPath();
        for (const [px, py] of MUD_DOTS) {
          ctx.moveTo(x + px * s + dotR, y + py * s);
          ctx.arc(x + px * s, y + py * s, dotR, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      if (!closed && res.openedAt[i] < k && i !== grid.start) {
        ctx.fillStyle = C.frontier;
        ctx.beginPath();
        ctx.arc(x + s / 2, y + s / 2, frontierR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const hair = 1 / dpr;
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = hair;
    ctx.beginPath();
    for (let c = 1; c < cols; c++) { ctx.moveTo(c * s + hair / 2, 0); ctx.lineTo(c * s + hair / 2, H); }
    for (let r = 1; r < rows; r++) { ctx.moveTo(0, r * s + hair / 2); ctx.lineTo(W, r * s + hair / 2); }
    ctx.stroke();

    // The cell expanded most recently, while a search is part-way through.
    if (k > 0 && k < res.expanded) {
      const i = res.order[k - 1];
      ctx.strokeStyle = C.now;
      ctx.lineWidth = Math.max(1.5, s * 0.1);
      ctx.strokeRect((i % cols) * s + 1, Math.floor(i / cols) * s + 1, s - 2, s - 2);
    }

    if (res.found && k >= res.expanded && res.path.length > 1) {
      const tracePath = () => {
        ctx.beginPath();
        res.path.forEach((i, n) => {
          const x = (i % cols) * s + s / 2, y = Math.floor(i / cols) * s + s / 2;
          if (n) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        });
      };
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      tracePath();
      ctx.strokeStyle = C.casing;
      ctx.lineWidth = Math.max(4, s * 0.46);
      ctx.stroke();
      tracePath();
      ctx.strokeStyle = C.route;
      ctx.lineWidth = Math.max(2, s * 0.28);
      ctx.stroke();
    }

    drawEnd(grid.start, true, C);
    drawEnd(grid.goal, false, C);
  }

  // Start is a filled disc; goal is a ring around a dot, so the two differ by shape as well as colour.
  function drawEnd(i, isStart, C) {
    const s = cell, x = (i % grid.cols) * s + s / 2, y = Math.floor(i / grid.cols) * s + s / 2, r = s * 0.38;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (isStart) {
      ctx.fillStyle = C.start;
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, s * 0.1);
      ctx.strokeStyle = C.cell;
      ctx.stroke();
    } else {
      ctx.fillStyle = C.cell;
      ctx.fill();
      ctx.lineWidth = Math.max(2, s * 0.16);
      ctx.strokeStyle = C.goal;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = C.goal;
      ctx.fill();
    }
  }

  /* ---------- panels ---------- */

  function explain(res, best) {
    const parts = [];
    const { algorithm, heuristic, weight, diagonal } = state;
    if (algorithm === 'astar') {
      if (!Pathfinding.admissible(heuristic, diagonal)) {
        parts.push('Manhattan distance overestimates diagonal steps, so A* can miss the cheapest route.');
      } else if (weight > 1) {
        parts.push(`With w = ${weight.toFixed(1)}, A* trusts the estimate more. It usually expands fewer cells, and its route costs at most ${weight.toFixed(1)}× the cheapest.`);
      } else {
        parts.push(`${HEURISTIC_LABELS[heuristic]} distance never overestimates here, so A* is guaranteed a cheapest route.`);
      }
    } else if (algorithm === 'dijkstra') {
      parts.push('Dijkstra ignores where the goal is and grows evenly by cost. It always finds a cheapest route.');
    } else if (algorithm === 'greedy') {
      parts.push('Greedy best-first looks only at the estimate h. It is quick, but its route is often far from the cheapest.');
    } else {
      parts.push('Breadth-first counts steps and ignores mud, so its route has the fewest steps, not the lowest cost.');
    }
    if (res.found && best.found && algorithm !== 'dijkstra') {
      const extra = res.cost / best.cost - 1;
      parts.push(extra < 1e-9
        ? 'On this grid it matched the cheapest route.'
        : `On this grid it cost ${pct(extra)} more than the cheapest route (${fmt(best.cost)}).`);
    }
    return parts.join(' ');
  }

  function renderPanel() {
    const res = current(), best = state.results.dijkstra;
    $('sExpanded').textContent = res.expanded.toLocaleString();
    $('sPeak').textContent = res.frontierPeak.toLocaleString();
    $('sSteps').textContent = res.found ? `${res.moves} steps` : '—';
    $('sCost').textContent = res.found ? fmt(res.cost) : '—';
    $('sTime').textContent = `${res.ms < 1 ? res.ms.toFixed(2) : res.ms.toFixed(1)} ms`;
    const status = res.found
      ? `Route found: ${res.moves} steps, cost ${fmt(res.cost)}.`
      : 'No route: the goal is walled off.';
    if (statusEl.textContent !== status) statusEl.textContent = status;
    $('note').textContent = explain(res, best);

    for (const row of compareBody.rows) {
      const id = row.dataset.algo, r = state.results[id];
      const [, expanded, cost, versus] = row.cells;
      const extra = r.cost / best.cost - 1;
      expanded.textContent = r.expanded.toLocaleString();
      cost.textContent = r.found ? fmt(r.cost) : 'no route';
      versus.textContent = !(r.found && best.found) ? '—' : extra < 1e-9 ? 'cheapest' : `+${pct(extra)}`;
      row.classList.toggle('current', id === state.algorithm);
      row.querySelector('.pick').setAttribute('aria-pressed', String(id === state.algorithm));
    }
  }

  function renderTimeline() {
    const res = current();
    timeline.max = String(res.expanded);
    timeline.value = String(state.step);
    $('stepOut').textContent = `${state.step} / ${res.expanded}`;
    runBtn.textContent = state.playing ? 'Pause' : state.step > 0 && state.step < res.expanded ? 'Resume' : 'Run';
  }

  let hoverCell = -1;

  function renderReadout() {
    if (hoverCell < 0) {
      readout.textContent = 'Hover a cell to read its g, h and f.';
      return;
    }
    const res = current(), i = hoverCell;
    const where = `Row ${Math.floor(i / grid.cols) + 1}, col ${(i % grid.cols) + 1}`;
    const t = grid.terrain[i];
    if (t === WALL) {
      readout.textContent = `${where} · wall`;
      return;
    }
    const kind = i === grid.start ? 'start' : i === grid.goal ? 'goal' : t === MUD ? `mud, costs ${MUD_COST} to enter` : 'open ground';
    if (res.openedAt[i] >= state.step) {
      readout.textContent = `${where} · ${kind} · not reached yet`;
      return;
    }
    const g = res.g[i], h = res.h[i];
    const f = state.algorithm === 'astar' ? g + state.weight * h
      : state.algorithm === 'dijkstra' ? g
      : state.algorithm === 'greedy' ? h
      : null;
    const phase = res.closedAt[i] < state.step ? `expanded at step ${res.closedAt[i] + 1}` : 'on the frontier';
    readout.textContent = `${where} · ${kind} · g ${fmt2(g)} · h ${fmt2(h)}${f === null ? '' : ` · f ${fmt2(f)}`} · ${phase}`;
  }

  function render() {
    draw();
    renderPanel();
    renderTimeline();
    renderReadout();
  }

  function syncControls() {
    algoSel.value = state.algorithm;
    heurSel.value = state.heuristic;
    heurSel.disabled = !(state.algorithm === 'astar' || state.algorithm === 'greedy');
    weightIn.disabled = state.algorithm !== 'astar';
    $('weightOut').textContent = state.weight.toFixed(1);
    $('speedOut').textContent = speedLabel(state.speed);
    for (const b of document.querySelectorAll('.brush')) b.setAttribute('aria-pressed', String(b.dataset.brush === state.brush));
  }

  /* ---------- state changes ---------- */

  let raf = 0, lastTick = 0, carry = 0;

  function stopPlayback() {
    state.playing = false;
    cancelAnimationFrame(raf);
  }

  function recompute() {
    stopPlayback();
    const settings = { heuristic: state.heuristic, weight: state.weight, diagonal: state.diagonal };
    state.results = {};
    for (const { id } of ALGORITHMS) state.results[id] = Pathfinding.search(grid, id, settings);
    state.step = current().expanded; // show the finished search
    render();
  }

  let pending = 0;
  function requestRecompute() {
    if (!pending) pending = requestAnimationFrame(() => { pending = 0; recompute(); });
  }

  function newLayout(seed = Math.floor(Math.random() * 2 ** 32)) {
    // Layouts with walls can seal the goal off; try the next seed until it can be reached.
    for (let attempt = 0; attempt < 25; attempt++) {
      Pathfinding.buildLayout(grid, state.layout, seed + attempt);
      if (Pathfinding.reachable(grid)) break;
    }
    state.seed = seed;
    state.edited = false;
    recompute();
  }

  function setAlgorithm(id) {
    stopPlayback();
    state.algorithm = id;
    syncControls();
    state.step = current().expanded;
    render();
  }

  function play() {
    const res = current();
    if (state.step >= res.expanded) state.step = 0;
    if (SPEEDS[state.speed - 1] === Infinity) {
      state.step = res.expanded;
      render();
      return;
    }
    state.playing = true;
    lastTick = performance.now();
    carry = 0;
    raf = requestAnimationFrame(tick);
    draw();
    renderTimeline();
  }

  function tick(now) {
    const res = current();
    carry += ((now - lastTick) / 1000) * SPEEDS[state.speed - 1];
    lastTick = now;
    const advance = Math.floor(carry);
    if (advance > 0) {
      carry -= advance;
      state.step = Math.min(res.expanded, state.step + advance);
      draw();
      renderReadout();
    }
    if (state.step >= res.expanded) {
      state.playing = false;
      renderTimeline();
      return;
    }
    renderTimeline();
    raf = requestAnimationFrame(tick);
  }

  function toggleRun() {
    if (state.playing) {
      stopPlayback();
      renderTimeline();
    } else {
      play();
    }
  }

  function stepBy(delta) {
    stopPlayback();
    const total = current().expanded;
    if (delta > 0 && state.step >= total) state.step = 0;
    state.step = Math.max(0, Math.min(total, state.step + delta));
    draw();
    renderTimeline();
    renderReadout();
  }

  function clearSearch() {
    stopPlayback();
    state.step = 0;
    draw();
    renderTimeline();
    renderReadout();
  }

  /* ---------- input ---------- */

  function cellAt(e) {
    // Measured against the canvas's rendered box, in case CSS has scaled it.
    const rect = canvas.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * grid.cols);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * grid.rows);
    return r >= 0 && r < grid.rows && c >= 0 && c < grid.cols ? r * grid.cols + c : -1;
  }

  // Bresenham's line between two cells, so a fast drag leaves no gaps.
  function cellsBetween(a, b) {
    const cols = grid.cols;
    let r = Math.floor(a / cols), c = a % cols;
    const r1 = Math.floor(b / cols), c1 = b % cols;
    const dr = Math.abs(r1 - r), dc = Math.abs(c1 - c), sr = r < r1 ? 1 : -1, sc = c < c1 ? 1 : -1;
    let err = dc - dr;
    const out = [];
    for (;;) {
      out.push(r * cols + c);
      if (r === r1 && c === c1) break;
      const e2 = 2 * err;
      if (e2 > -dr) { err -= dr; c += sc; }
      if (e2 < dc) { err += dc; r += sr; }
    }
    return out;
  }

  function paint(i, terrain) {
    if (i === grid.start || i === grid.goal) return;
    grid.terrain[i] = terrain;
    state.edited = true;
  }

  let drag = null;

  canvas.addEventListener('pointerdown', (e) => {
    const i = cellAt(e);
    if (i < 0) return;
    canvas.setPointerCapture(e.pointerId);
    stopPlayback();
    renderTimeline();
    if (i === grid.start || i === grid.goal) {
      drag = { kind: i === grid.start ? 'start' : 'goal' };
      canvas.style.cursor = 'grabbing';
      return;
    }
    const t = grid.terrain[i];
    // Starting a stroke on the brush's own terrain erases instead, like a toggle.
    const terrain = state.brush === 'erase' ? OPEN
      : state.brush === 'mud' ? (t === MUD ? OPEN : MUD)
      : (t === WALL ? OPEN : WALL);
    drag = { kind: 'paint', terrain, last: i };
    paint(i, terrain);
    requestRecompute();
  });

  canvas.addEventListener('pointermove', (e) => {
    const i = cellAt(e);
    if (i !== hoverCell) {
      hoverCell = i;
      renderReadout();
    }
    if (!drag) {
      canvas.style.cursor = i === grid.start || i === grid.goal ? 'grab' : 'crosshair';
      return;
    }
    if (i < 0) return;
    if (drag.kind === 'paint') {
      if (i === drag.last) return;
      for (const j of cellsBetween(drag.last, i)) paint(j, drag.terrain);
      drag.last = i;
      requestRecompute();
    } else {
      const other = drag.kind === 'start' ? grid.goal : grid.start;
      if (i !== other && i !== grid[drag.kind] && grid.terrain[i] !== WALL) {
        grid[drag.kind] = i;
        state.edited = true;
        requestRecompute();
      }
    }
  });

  const endDrag = () => {
    drag = null;
    canvas.style.cursor = 'crosshair';
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => {
    hoverCell = -1;
    renderReadout();
  });

  algoSel.addEventListener('change', () => setAlgorithm(algoSel.value));
  heurSel.addEventListener('change', () => { state.heuristic = heurSel.value; recompute(); });
  weightIn.addEventListener('input', () => {
    state.weight = Number(weightIn.value);
    syncControls();
    recompute();
  });
  diagIn.addEventListener('change', () => { state.diagonal = diagIn.checked; recompute(); });
  speedIn.addEventListener('input', () => { state.speed = Number(speedIn.value); syncControls(); });
  layoutSel.addEventListener('change', () => { state.layout = layoutSel.value; newLayout(); });
  $('newLayout').addEventListener('click', () => newLayout());
  $('clearGrid').addEventListener('click', () => {
    grid.terrain.fill(OPEN);
    state.edited = true;
    recompute();
  });
  runBtn.addEventListener('click', toggleRun);
  $('stepBtn').addEventListener('click', () => stepBy(1));
  $('clearSearch').addEventListener('click', clearSearch);
  timeline.addEventListener('input', () => {
    stopPlayback();
    state.step = Number(timeline.value);
    draw();
    renderTimeline();
    renderReadout();
  });
  for (const b of document.querySelectorAll('.brush')) {
    b.addEventListener('click', () => { state.brush = b.dataset.brush; syncControls(); });
  }
  // The whole row is clickable; the button in its first cell is the keyboard route.
  compareBody.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-algo]');
    if (row) setAlgorithm(row.dataset.algo);
  });

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const key = e.key.toLowerCase();
    if (key === ' ') {
      if (tag === 'BUTTON') return; // the button handles its own Space
      e.preventDefault();
      toggleRun();
    } else if (key === 'arrowright') {
      e.preventDefault();
      stepBy(1);
    } else if (key === 'arrowleft') {
      e.preventDefault();
      stepBy(-1);
    } else if (key === 'c') {
      clearSearch();
    } else if (key === 'm') {
      newLayout();
    } else if (key === 'd') {
      diagIn.checked = !diagIn.checked;
      state.diagonal = diagIn.checked;
      recompute();
    } else if (key.length === 1 && key >= '1' && key <= '4') {
      setAlgorithm(ALGORITHMS[Number(key) - 1].id);
    }
  });

  // Redraw when the viewer's theme changes, since the canvas reads colours from the CSS tokens.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => state.results && draw());
  new MutationObserver(() => state.results && draw()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  /* ---------- start ---------- */

  // Odd sizes keep both maze generators' corridors aligned with the grid edges.
  function pickDims(width) {
    if (width >= 1000) return [25, 51];
    if (width >= 700) return [25, 41];
    if (width >= 480) return [25, 31];
    return [27, 21];
  }

  speedIn.value = String(state.speed);
  layoutSel.value = state.layout;
  syncControls();
  fitCanvas(); // picks the grid size for this width
  newLayout(20200716);
  // Refit on the next frame: resizing the canvas inside the callback would resize the board it watches.
  new ResizeObserver(() => requestAnimationFrame(fitCanvas)).observe(board);
})();
