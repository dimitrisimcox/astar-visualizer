// Checks search.js against small reference implementations written separately
// here, on a few hundred random grids. Run with `npm test` (Node 18 or newer).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../search.js');

const { OPEN, WALL, MUD, MUD_COST } = P;
const EPS = 1e-6;
const HEURISTIC_IDS = Object.keys(P.HEURISTICS);

// mulberry32, so the test grids are the same on every run.
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

function randomGrid(rand) {
  const rows = 3 + Math.floor(rand() * 16), cols = 3 + Math.floor(rand() * 16);
  const wallChance = rand() * 0.5, mudChance = rand() * 0.4;
  const terrain = new Uint8Array(rows * cols);
  for (let i = 0; i < terrain.length; i++) {
    const x = rand();
    terrain[i] = x < wallChance ? WALL : x < wallChance + mudChance ? MUD : OPEN;
  }
  const start = Math.floor(rand() * terrain.length), goal = Math.floor(rand() * terrain.length);
  terrain[start] = OPEN;
  terrain[goal] = rand() < 0.3 ? MUD : OPEN;
  return { rows, cols, terrain, start, goal };
}

const rand = makeRng(2020);
const GRIDS = Array.from({ length: 400 }, () => randomGrid(rand));

// The movement rules, restated: eight directions, no corner cutting, and a step
// costs 1 or √2, times MUD_COST when it enters mud.
function moves(grid, i, diagonal) {
  const { rows, cols, terrain } = grid;
  const r = Math.floor(i / cols), c = i % cols;
  const open = (rr, cc) => rr >= 0 && rr < rows && cc >= 0 && cc < cols && terrain[rr * cols + cc] !== WALL;
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const isDiagonal = dr !== 0 && dc !== 0;
      if ((dr === 0 && dc === 0) || (isDiagonal && !diagonal) || !open(r + dr, c + dc)) continue;
      if (isDiagonal && !(open(r + dr, c) && open(r, c + dc))) continue;
      const j = (r + dr) * cols + c + dc;
      out.push([j, (terrain[j] === MUD ? MUD_COST : 1) * (isDiagonal ? Math.SQRT2 : 1)]);
    }
  }
  return out;
}

// Plain O(n²) Dijkstra: the cheapest cost to the goal, or Infinity.
function cheapest(grid, diagonal) {
  const n = grid.rows * grid.cols;
  const dist = new Array(n).fill(Infinity), done = new Array(n).fill(false);
  dist[grid.start] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) return Infinity;
    if (u === grid.goal) return dist[u];
    done[u] = true;
    for (const [v, w] of moves(grid, u, diagonal)) dist[v] = Math.min(dist[v], dist[u] + w);
  }
}

// The fewest moves to the goal, whatever they cost, or Infinity.
function fewestMoves(grid, diagonal) {
  const depth = new Map([[grid.start, 0]]);
  const queue = [grid.start];
  for (let k = 0; k < queue.length; k++) {
    const u = queue[k];
    if (u === grid.goal) return depth.get(u);
    for (const [v] of moves(grid, u, diagonal)) {
      if (!depth.has(v)) {
        depth.set(v, depth.get(u) + 1);
        queue.push(v);
      }
    }
  }
  return Infinity;
}

// Whether every open cell can be reached from the start.
function allConnected(grid) {
  const seen = new Set([grid.start]);
  const queue = [grid.start];
  for (let k = 0; k < queue.length; k++) {
    for (const [v] of moves(grid, queue[k], false)) {
      if (!seen.has(v)) {
        seen.add(v);
        queue.push(v);
      }
    }
  }
  return seen.size === grid.terrain.filter((t) => t !== WALL).length;
}

// A route has to run from start to goal by legal moves and cost what the search reports.
function checkRoute(grid, res, diagonal) {
  assert.equal(res.path[0], grid.start);
  assert.equal(res.path.at(-1), grid.goal);
  assert.equal(res.moves, res.path.length - 1);
  let cost = 0;
  for (let k = 1; k < res.path.length; k++) {
    const move = moves(grid, res.path[k - 1], diagonal).find(([j]) => j === res.path[k]);
    assert.ok(move, `${res.algorithm}: illegal move ${res.path[k - 1]} -> ${res.path[k]}`);
    cost += move[1];
  }
  assert.ok(Math.abs(cost - res.cost) < EPS, `${res.algorithm}: route costs ${cost}, search reports ${res.cost}`);
}

// The record that playback replays: each cell expanded once, after it was reached.
function checkRecord(grid, res) {
  assert.equal(res.order[0], grid.start);
  assert.equal(new Set(res.order).size, res.order.length);
  res.order.forEach((cell, step) => {
    assert.equal(res.closedAt[cell], step);
    assert.ok(res.openedAt[cell] < step, `${res.algorithm}: cell ${cell} expanded before it was reached`);
  });
  if (res.found) assert.equal(res.order.at(-1), grid.goal);
  else assert.deepEqual([res.path, res.cost], [[], Infinity]);
}

test('the test grids include both solvable and walled-off cases', () => {
  const solvable = GRIDS.filter((grid) => cheapest(grid, true) < Infinity).length;
  assert.ok(solvable >= 150 && GRIDS.length - solvable >= 50, `${solvable} of ${GRIDS.length} solvable`);
});

test('Dijkstra, and A* with an admissible heuristic, find a cheapest route', () => {
  for (const grid of GRIDS) {
    for (const diagonal of [true, false]) {
      const best = cheapest(grid, diagonal);
      const runs = [P.search(grid, 'dijkstra', { diagonal })];
      for (const heuristic of HEURISTIC_IDS) {
        if (P.admissible(heuristic, diagonal)) runs.push(P.search(grid, 'astar', { heuristic, diagonal }));
      }
      for (const res of runs) {
        assert.equal(res.found, best < Infinity);
        if (res.found) {
          assert.ok(Math.abs(res.cost - best) < EPS, `${res.algorithm}: cost ${res.cost}, cheapest ${best}`);
          checkRoute(grid, res, diagonal);
        }
        checkRecord(grid, res);
      }
    }
  }
});

test('weighted A* stays within w times the cheapest cost', () => {
  for (const grid of GRIDS) {
    for (const diagonal of [true, false]) {
      const best = cheapest(grid, diagonal);
      if (best === Infinity) continue;
      for (const heuristic of HEURISTIC_IDS) {
        if (!P.admissible(heuristic, diagonal)) continue;
        for (const weight of [1.5, 2, 3]) {
          const res = P.search(grid, 'astar', { heuristic, weight, diagonal });
          assert.ok(res.found);
          assert.ok(res.cost <= weight * best + EPS, `w=${weight} ${heuristic}: cost ${res.cost}, cheapest ${best}`);
          checkRoute(grid, res, diagonal);
          checkRecord(grid, res);
        }
      }
    }
  }
});

test('breadth-first finds a route with the fewest moves', () => {
  for (const grid of GRIDS) {
    for (const diagonal of [true, false]) {
      const fewest = fewestMoves(grid, diagonal);
      const res = P.search(grid, 'bfs', { diagonal });
      assert.equal(res.found, fewest < Infinity);
      if (res.found) {
        assert.equal(res.moves, fewest);
        checkRoute(grid, res, diagonal);
      }
      checkRecord(grid, res);
    }
  }
});

test('greedy best-first and Manhattan A* with diagonals find a legal route, never a cheaper one', () => {
  for (const grid of GRIDS) {
    const best = cheapest(grid, true);
    const runs = [
      P.search(grid, 'greedy', { heuristic: 'octile', diagonal: true }),
      P.search(grid, 'astar', { heuristic: 'manhattan', diagonal: true }),
    ];
    for (const res of runs) {
      assert.equal(res.found, best < Infinity);
      if (res.found) {
        assert.ok(res.cost >= best - EPS);
        checkRoute(grid, res, true);
      }
      checkRecord(grid, res);
    }
  }
});

test('reachable() agrees with a search, with and without diagonal steps', () => {
  for (const grid of GRIDS) {
    assert.equal(P.reachable(grid), cheapest(grid, true) < Infinity);
    assert.equal(P.reachable(grid), cheapest(grid, false) < Infinity);
  }
});

const SIZES = [[25, 51], [25, 41], [25, 31], [27, 21], [24, 30]];

test('layouts are deterministic and keep both ends open', () => {
  for (const kind of P.LAYOUTS) {
    for (const [rows, cols] of SIZES) {
      for (let seed = 0; seed < 30; seed++) {
        const grid = { rows, cols }, again = { rows, cols };
        P.buildLayout(grid, kind, seed);
        P.buildLayout(again, kind, seed);
        assert.deepEqual(again, grid);
        assert.notEqual(grid.start, grid.goal);
        assert.notEqual(grid.terrain[grid.start], WALL);
        assert.notEqual(grid.terrain[grid.goal], WALL);
      }
    }
  }
});

test('both maze generators leave every open cell connected', () => {
  for (const kind of ['division', 'backtracker']) {
    for (const [rows, cols] of SIZES) {
      for (let seed = 0; seed < 30; seed++) {
        const grid = { rows, cols };
        P.buildLayout(grid, kind, seed);
        assert.ok(allConnected(grid), `${kind} ${rows}x${cols} seed ${seed}`);
      }
    }
  }
});

test('open layouts are solvable often enough for the page to retry into one', () => {
  // The page tries up to 25 seeds in a row; insist on far better than that.
  for (const kind of ['terrain', 'swamp']) {
    for (const [rows, cols] of SIZES) {
      let solvable = 0;
      for (let seed = 0; seed < 40; seed++) {
        const grid = { rows, cols };
        P.buildLayout(grid, kind, seed);
        if (P.reachable(grid)) solvable++;
      }
      assert.ok(solvable >= 20, `${kind} ${rows}x${cols}: ${solvable} of 40 solvable`);
    }
  }
});
