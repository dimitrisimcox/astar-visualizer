---
title: "astar-visualizer project guide"
type: project-guide
owner: bennie — practices and coordination
last_verified: 2026-11-07
source_commit: e829f3c935c113ca8ab7baa6a9bce0f8753c31b0
upstream_commit: e829f3c935c113ca8ab7baa6a9bce0f8753c31b0
---

# astar-visualizer

## Purpose

A small browser demonstration for exploring A* and comparing graph-search behavior on an editable grid. It should stay easy to run, inspect and understand.

## Now and next

The README already explains walls/mud, start/goal controls, algorithms and tests. There is no committed larger product campaign to imply. Next: maintain the simple demo and its algorithm/interaction contracts; add a feature only for a clear reader need.

## Architecture

`search.js` owns the search logic; `app.js` owns grid/interaction/rendering; `index.html` and `app.css` supply the static page and styling. This file map is proportionate; no backend or distributed-system diagram is needed.

## Onboarding

Use the README Run/Controls/Tests sections and package scripts. The demo is local/static; no account, data export, provider or external service is required by the documented purpose.

## Walkthrough

Bounded first journey: use the README run route, draw a wall, move start/goal, run A*, then compare with another algorithm on the same grid. Expected: visible frontier/path or explicit no-path, not a fabricated route through walls. This guide was source-reviewed; a fresh browser walk is not claimed.

## History

The concise README/Git history and vault `projects/astar-visualizer/_index.md` are sufficient. No generated evolution page or additional notebook is needed just to match a larger project’s shape.

## Verification boundary

Source reviewed at `e829f3c935c113ca8ab7baa6a9bce0f8753c31b0`; cached `origin/main` was `e829f3c935c113ca8ab7baa6a9bce0f8753c31b0`. No fetch, install, publication, provider turn or runtime/UI claim is implied by this dated review. Relevant source paths: `search.js`, `app.js`, `index.html`, `app.css`, `README.md`.
