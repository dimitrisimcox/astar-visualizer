# A* Pathfinding Visualizer

An interactive grid path-finding visualizer that runs in the browser. Draw walls and mud, drag the start and goal, and watch A* grow its frontier one expansion at a time. Then compare it with Dijkstra, greedy best-first and breadth-first search on the same grid.

**Live demo:** <https://dimitrisimcox.github.io/astar-visualizer/>

## What it shows

- **Four searches on one grid.** A*, Dijkstra, greedy best-first and breadth-first all rerun on every change. A table compares how many cells each one expanded and what its route cost.
- **Terrain that costs something.** Mud costs 5 to enter, so the cheapest route and the shortest one differ. Breadth-first counts steps and walks straight through mud; A* and Dijkstra go around it when that's cheaper.
- **Heuristics and weights.** Octile, Euclidean, Chebyshev and Manhattan distance, and a weight *w* in f = g + w·h. The side panel says when A* is guaranteed a cheapest route and when it isn't: Manhattan distance overestimates diagonal steps, and w > 1 trades route cost for speed, within w × the cheapest.
- **A timeline.** Each search is recorded, so you can play it, pause it, step through it or scrub to any expansion. Hover a cell to read its g, h and f at that moment.
- **Generated layouts.** Recursive division, a backtracking maze with a few loops knocked through, scattered walls and mud, or an open swamp. Layouts are seeded and always solvable.

## Run it

There's no build step and there are no dependencies. Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

## Controls

| Key | Action |
|---|---|
| Space | Run or pause |
| ← / → | Step back or forward one expansion |
| C | Clear the search |
| M | New layout |
| D | Toggle diagonal steps |
| 1–4 | A*, Dijkstra, greedy best-first, breadth-first |

Drag on the grid to paint with the current brush. A stroke that starts on the brush's own terrain erases it instead. Drag the start or goal to move it.

## How it works

- **Movement.** A straight step costs 1 and a diagonal step √2, multiplied by 5 when the step enters mud. Diagonal steps can't cut a wall's corner.
- **Recorded searches.** Every search runs to completion first and records the order in which it expanded cells and when it first reached each one. Playback replays that record, so the timeline is exact and scrubbing costs nothing.
- **Priority queue.** A* and Dijkstra use a binary heap. Ties in f go to the cell with the lower h, the one further along, which cuts the number of equal-f cells A* expands on open ground.
- **No reopening.** Octile, Euclidean and Chebyshev distance are consistent for these costs, and so is Manhattan without diagonals. So A* never has to reopen a closed cell, and weighted A* stays within w × the cheapest cost without reopening.

## Code

Plain HTML, CSS and JavaScript:

- `search.js`: the movement rules, the four searches and the layout generators. It never touches the page, so Node can load it too.
- `app.js`: the page, covering drawing, playback, the panels and input.
- `index.html` and `app.css`: the markup and styles.
- `test/search.test.js`: the tests.

## Tests

```bash
npm test
```

The tests use Node's built-in test runner, so there's nothing to install (Node 18 or newer). They check `search.js` against small reference implementations, written separately in the test file, on 400 random grids:

- Dijkstra, and A* with every admissible heuristic, find a route as cheap as the reference Dijkstra's.
- Weighted A* stays within w × the cheapest cost.
- Breadth-first finds the fewest moves.
- Every route is legal (no wall crossings, no cut corners) and costs what the search reports.
- Each recorded timeline expands every cell once, after it was reached.
- Layouts are deterministic, both maze generators leave every open cell connected, and the open layouts are solvable often enough for the page's retry loop.

## History

The first version, in 2020, was a pygame script I wrote while working through a tutorial. This is a from-scratch rewrite for the browser, made in 2026, with weighted terrain, more searches, a timeline and maze generators.

## License

MIT. See [LICENSE](LICENSE).
