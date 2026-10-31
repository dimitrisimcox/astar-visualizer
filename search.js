/* Grid path-finding core: terrain, movement rules, the four searches and the
 * layout generators. Nothing here touches the page, so Node can test it too
 * (npm test). A grid is { rows, cols, terrain, start, goal }: terrain is a
 * Uint8Array with one entry per cell, numbered row by row, and start and goal
 * are cell numbers. */
const Pathfinding = (() => {
  'use strict';

  const OPEN = 0, WALL = 1, MUD = 2;
  const MUD_COST = 5;
  const NEVER = 0x7fffffff;
  const ORTHO = [[-1, 0], [0, 1], [1, 0], [0, -1]];
  const DIAG = [[-1, 1], [1, 1], [1, -1], [-1, -1]];

  // Estimates of the cost left, from the row and column distances to the goal.
  const HEURISTICS = {
    octile: (dx, dy) => dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy),
    manhattan: (dx, dy) => dx + dy,
    euclidean: (dx, dy) => Math.hypot(dx, dy),
    chebyshev: (dx, dy) => Math.max(dx, dy),
  };
  const LAYOUTS = ['terrain', 'division', 'backtracker', 'swamp'];

  // Only Manhattan distance can overestimate, and only once diagonal steps are allowed.
  const admissible = (heuristic, diagonal) => !(heuristic === 'manhattan' && diagonal);

  /* ---------- search ---------- */

  // Binary min-heap ordered by priority, then tiebreak, then insertion order.
  class Heap {
    constructor() { this.items = []; }

    get size() { return this.items.length; }

    push(priority, tiebreak, seq, node) {
      const a = this.items;
      a.push([priority, tiebreak, seq, node]);
      let i = a.length - 1;
      while (i > 0) {
        const up = (i - 1) >> 1;
        if (!before(a[i], a[up])) break;
        [a[i], a[up]] = [a[up], a[i]];
        i = up;
      }
    }

    pop() {
      const a = this.items, top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < a.length && before(a[l], a[m])) m = l;
          if (r < a.length && before(a[r], a[m])) m = r;
          if (m === i) break;
          [a[i], a[m]] = [a[m], a[i]];
          i = m;
        }
      }
      return top[3];
    }
  }

  function before(x, y) {
    if (Math.abs(x[0] - y[0]) > 1e-9) return x[0] < y[0];
    if (Math.abs(x[1] - y[1]) > 1e-9) return x[1] < y[1];
    return x[2] < y[2];
  }

  function passable(grid, r, c) {
    return r >= 0 && r < grid.rows && c >= 0 && c < grid.cols && grid.terrain[r * grid.cols + c] !== WALL;
  }

  const enterCost = (grid, i) => (grid.terrain[i] === MUD ? MUD_COST : 1);

  // Fills `out` with [cell, cost, cell, cost, ...] for every legal step from cell i.
  function neighbors(grid, i, diagonal, out) {
    const cols = grid.cols, r = Math.floor(i / cols), c = i % cols;
    out.length = 0;
    for (const [dr, dc] of ORTHO) {
      if (passable(grid, r + dr, c + dc)) {
        const j = (r + dr) * cols + c + dc;
        out.push(j, enterCost(grid, j));
      }
    }
    if (!diagonal) return out;
    for (const [dr, dc] of DIAG) {
      // A diagonal step may not cut a corner: both cells beside it must be open.
      if (passable(grid, r + dr, c + dc) && passable(grid, r + dr, c) && passable(grid, r, c + dc)) {
        const j = (r + dr) * cols + c + dc;
        out.push(j, enterCost(grid, j) * Math.SQRT2);
      }
    }
    return out;
  }

  // Runs one search to completion and records the order it expanded cells in.
  // openedAt[i] and closedAt[i] are the expansion steps that first reached and
  // expanded cell i (NEVER if they didn't happen), so any moment can be replayed.
  function search(grid, algorithm, { heuristic = 'octile', weight = 1, diagonal = true } = {}) {
    const { rows, cols, start, goal } = grid;
    const n = rows * cols;
    const estimate = HEURISTICS[heuristic];
    const goalR = Math.floor(goal / cols), goalC = goal % cols;
    const h = new Float64Array(n);
    for (let i = 0; i < n; i++) h[i] = estimate(Math.abs(Math.floor(i / cols) - goalR), Math.abs((i % cols) - goalC));
    const g = new Float64Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const openedAt = new Int32Array(n).fill(NEVER);
    const closedAt = new Int32Array(n).fill(NEVER);
    const order = [];
    const began = performance.now();

    // Greedy and breadth-first keep the first route they find to a cell; A* and Dijkstra relax it.
    const firstOnly = algorithm === 'greedy' || algorithm === 'bfs';
    const priority = algorithm === 'astar' ? (m) => g[m] + weight * h[m]
      : algorithm === 'dijkstra' ? (m) => g[m]
      : (m) => h[m];
    const heap = new Heap(), queue = [];
    let head = 0, seq = 0;
    const push = algorithm === 'bfs'
      ? (m) => { queue.push(m); }
      : (m) => { heap.push(priority(m), algorithm === 'astar' ? h[m] : 0, seq++, m); };
    const pop = algorithm === 'bfs'
      ? () => (head < queue.length ? queue[head++] : -1)
      : () => (heap.size ? heap.pop() : -1);

    g[start] = 0;
    openedAt[start] = -1; // reached before the first expansion
    push(start);
    let frontier = 1, frontierPeak = 1, found = false;
    const next = [];
    for (let node = pop(); node !== -1; node = pop()) {
      if (closedAt[node] !== NEVER) continue; // a stale heap entry
      const step = order.length;
      closedAt[node] = step;
      order.push(node);
      frontier--;
      if (node === goal) { found = true; break; }
      neighbors(grid, node, diagonal, next);
      for (let k = 0; k < next.length; k += 2) {
        const m = next[k];
        if (closedAt[m] !== NEVER) continue;
        const fresh = openedAt[m] === NEVER;
        const ng = g[node] + next[k + 1];
        if (firstOnly ? !fresh : ng >= g[m] - 1e-9) continue;
        g[m] = ng;
        parent[m] = node;
        if (fresh) { openedAt[m] = step; frontier++; }
        push(m);
      }
      if (frontier > frontierPeak) frontierPeak = frontier;
    }

    const path = [];
    if (found) {
      for (let v = goal; v !== -1; v = parent[v]) path.push(v);
      path.reverse();
    }
    return {
      algorithm, order, g, h, openedAt, closedAt, path, found, frontierPeak,
      expanded: order.length,
      cost: found ? g[goal] : Infinity,
      moves: found ? path.length - 1 : 0,
      ms: performance.now() - began,
    };
  }

  // With no corner cutting, any diagonal step can also be made as two straight
  // steps, so straight-step reachability answers for both kinds of movement.
  const reachable = (grid) => search(grid, 'bfs', { diagonal: false }).found;

  /* ---------- layouts ---------- */

  // mulberry32: a small seeded generator, so a layout can be rebuilt from its seed.
  function makeRng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const randInt = (rng, n) => Math.floor(rng() * n);

  function wallSegment(grid, rng, length) {
    const { rows, cols, terrain } = grid;
    let r = randInt(rng, rows), c = randInt(rng, cols);
    const [dr, dc] = ORTHO[randInt(rng, 4)];
    for (let k = 0; k < length && r >= 0 && r < rows && c >= 0 && c < cols; k++) {
      terrain[r * cols + c] = WALL;
      r += dr;
      c += dc;
    }
  }

  // Random walks that turn open ground into mud.
  function sprinkleMud(grid, rng, blobs, size) {
    const { rows, cols, terrain } = grid;
    for (let b = 0; b < blobs; b++) {
      let r = randInt(rng, rows), c = randInt(rng, cols);
      for (let k = 0; k < size; k++) {
        const i = r * cols + c;
        if (terrain[i] === OPEN) terrain[i] = MUD;
        const [dr, dc] = ORTHO[randInt(rng, 4)];
        r = Math.min(rows - 1, Math.max(0, r + dr));
        c = Math.min(cols - 1, Math.max(0, c + dc));
      }
    }
  }

  // Recursive division: walls go on odd rows and columns and gaps on even ones,
  // so a later wall can never close an earlier gap.
  function divide(grid, rng, r0, c0, r1, c1) {
    const height = r1 - r0 + 1, width = c1 - c0 + 1;
    if (height < 3 || width < 3) return;
    const { cols, terrain } = grid;
    const horizontal = height > width || (height === width && rng() < 0.5);
    if (horizontal) {
      const wr = r0 + 1 + 2 * randInt(rng, (height - 1) >> 1);
      const gap = c0 + 2 * randInt(rng, (width + 1) >> 1);
      for (let c = c0; c <= c1; c++) if (c !== gap) terrain[wr * cols + c] = WALL;
      divide(grid, rng, r0, c0, wr - 1, c1);
      divide(grid, rng, wr + 1, c0, r1, c1);
    } else {
      const wc = c0 + 1 + 2 * randInt(rng, (width - 1) >> 1);
      const gap = r0 + 2 * randInt(rng, (height + 1) >> 1);
      for (let r = r0; r <= r1; r++) if (r !== gap) terrain[r * cols + wc] = WALL;
      divide(grid, rng, r0, c0, r1, wc - 1);
      divide(grid, rng, r0, wc + 1, r1, c1);
    }
  }

  // A perfect maze has one route, so every search would agree. Knock out some
  // walls between two open cells to give the searches real choices.
  function openLoops(grid, rng, chance) {
    const { rows, cols, terrain } = grid;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (terrain[i] !== WALL || rng() >= chance) continue;
        const across = c > 0 && c < cols - 1 && terrain[i - 1] !== WALL && terrain[i + 1] !== WALL;
        const down = r > 0 && r < rows - 1 && terrain[i - cols] !== WALL && terrain[i + cols] !== WALL;
        if (across || down) terrain[i] = OPEN;
      }
    }
  }

  // Depth-first backtracking: rooms sit on even rows and columns, and carving
  // into a room opens the wall cell between.
  function carveBacktracker(grid, rng) {
    const { rows, cols, terrain } = grid;
    terrain.fill(WALL);
    terrain[0] = OPEN;
    const stack = [[0, 0]];
    while (stack.length) {
      const [r, c] = stack[stack.length - 1];
      const choices = ORTHO
        .map(([dr, dc]) => [r + 2 * dr, c + 2 * dc, r + dr, c + dc])
        .filter(([rr, cc]) => rr >= 0 && rr < rows && cc >= 0 && cc < cols && terrain[rr * cols + cc] === WALL);
      if (!choices.length) { stack.pop(); continue; }
      const [rr, cc, wr, wc] = choices[randInt(rng, choices.length)];
      terrain[wr * cols + wc] = OPEN;
      terrain[rr * cols + cc] = OPEN;
      stack.push([rr, cc]);
    }
  }

  // Fills grid.terrain, grid.start and grid.goal for the grid's current size.
  // The same kind, size and seed always give the same layout.
  function buildLayout(grid, kind, seed) {
    const { rows, cols } = grid;
    const rng = makeRng(seed);
    grid.terrain = new Uint8Array(rows * cols);
    const at = (r, c) => r * cols + c;
    const area = rows * cols;
    if (kind === 'backtracker' || kind === 'division') {
      if (kind === 'backtracker') carveBacktracker(grid, rng);
      else divide(grid, rng, 0, 0, rows - 1, cols - 1);
      openLoops(grid, rng, kind === 'backtracker' ? 0.1 : 0.06);
      sprinkleMud(grid, rng, Math.round(area / 160), 10);
      // Corner to corner; maze rooms sit on even rows and columns.
      grid.start = at(0, 0);
      grid.goal = at((rows - 1) & ~1, (cols - 1) & ~1);
    } else {
      if (kind === 'swamp') {
        sprinkleMud(grid, rng, Math.round(area / 45), 26);
        for (let k = 0; k < Math.round(cols / 6); k++) wallSegment(grid, rng, 4 + randInt(rng, 6));
      } else {
        for (let k = 0; k < Math.round(area / 28); k++) wallSegment(grid, rng, 3 + randInt(rng, 7));
        sprinkleMud(grid, rng, Math.round(area / 90), 18);
      }
      const mid = Math.floor(rows / 2);
      grid.start = at(mid, Math.min(2, cols - 1));
      grid.goal = at(mid, Math.max(0, cols - 3));
      // Clear the ground around both ends.
      for (const end of [grid.start, grid.goal]) {
        for (const [dr, dc] of [[0, 0], ...ORTHO, ...DIAG]) {
          const r = Math.floor(end / cols) + dr, c = (end % cols) + dc;
          if (r >= 0 && r < rows && c >= 0 && c < cols) grid.terrain[at(r, c)] = OPEN;
        }
      }
    }
    grid.terrain[grid.start] = OPEN;
    grid.terrain[grid.goal] = OPEN;
  }

  return { OPEN, WALL, MUD, MUD_COST, NEVER, HEURISTICS, LAYOUTS, admissible, neighbors, search, reachable, buildLayout };
})();

if (typeof module === 'object' && module.exports) module.exports = Pathfinding;
