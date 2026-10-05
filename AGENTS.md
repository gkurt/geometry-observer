# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Commands

```bash
bun run test       # Vitest browser mode (chromium + webkit; firefox on CI)
bun typecheck      # Type check (TypeScript 7, native tsc)
bun run lint       # Lint
bun run format     # Format
bun run fix        # Lint + format + autofix
bun run build      # Build dist with tsdown
bun run checks     # Everything: check + typecheck + test + build
```

Prefer these scripts over ad-hoc commands. Do not prefix them with `bun run` when
a bare alias exists (`bun check`, `bun typecheck`). Before finishing, run
`bun run fix` then `bun run checks` — the linter, formatter and `tsc` own all
mechanical style rules. Fix the code; don't disable rules.

## Project Structure

- `src/types.ts` — the public type surface. No logic.
- `src/support.ts` — `isSupported()`, memoised.
- `src/probe.ts` — everything about the hidden probe element: its style, the
  shared `display: contents` group, and the pool. The comments here record _why_
  each declaration is what it is; several are load-bearing in non-obvious ways.
- `src/observer.ts` — the class, plus the page-wide listener registry and the
  sampling fallback. One set of listeners serves every observer instance.
- `src/observe-geometry.ts` — one-target convenience wrapper.
- `src/react.ts` — the `geometry-observer/react` entry point. React is an optional
  peer dependency; nothing else in the package imports it.
- `test/` — Vitest browser tests. See CONTRIBUTING.md for the split.

## Architecture

The mechanism is three CSS features chained into a DOM event:

1. `anchor()` / `anchor-size()` resolve a target's box into computed lengths on a
   probe element, kept in sync by layout.
2. Those are ordinary computed values, so they are transitionable.
3. A running transition dispatches `transitionstart`, which is the notification.

The probe raises events; it is never measured. Entries always carry
`target.getBoundingClientRect()`, because once a probe's anchor is invalid the
probe is parked on its fallback and describes nothing.

Four details are load-bearing and each has a comment at its definition:

- **`position-anchor`**, rather than naming the anchor inside each `anchor()`
  call, is what makes the engine scroll-adjust the probe.
- **`popover="manual"`** puts the probe in the top layer, which is what makes
  ancestor `transform` changes observable at all — a probe inside the transformed
  subtree moves with it, so the insets never change.
- **Length fallbacks** in `anchor(top, …)` are what make teardown observable: an
  invalid anchor otherwise resolves to `auto`, and a length does not interpolate
  to `auto`.
- **`!important` on every probe declaration**, because a blanket author reset
  (`* { transition: none !important }`) would otherwise switch the observer off
  silently — still tracking, never reporting.

Scrolling cannot raise a transition (the engine adjusts for it after layout,
which is the same reason the rect stays correct for free), so it is handled by one
passive capture-phase listener, routed by `scroller.contains(target)`.

## Coding Conventions

- Prefer colocation.
- Avoid verbose code comments; write self-explanatory code. Comments are acceptable for:
  - Explaining complex logic, workarounds, or decisions
  - Documenting public APIs (functions, classes, modules)
  - TODO/FIXME notes
  - When the user specifically asks for comments
- Prefer early returns and guard clauses over nested conditionals.
- Check for existing utilities/hooks/components before creating new ones. Avoid duplication.
- Remove dead and commented-out code; don't preserve old APIs unless asked.
- When moving or relocating code, don't leave a re-export behind for backwards
  compatibility. Update every importer and delete the old definition.

## Measured claims

The README, the code comments and the tests state specific numbers — per-probe
reflow cost, event counts under churn, which engines report teardown. Every one of
them came from a measurement, not an estimate. If you change behaviour one rests
on, re-measure and update it everywhere it appears. Do not add a new performance
or coverage claim you have not measured.

Engine differences are measured too, never sniffed: `test/capabilities.ts` probes
whether this browser reports teardown, so the suite starts covering an engine by
itself when that engine starts supporting it.

## Documentation

When changing user-facing APIs, update all relevant docs in the same change:
README.md, AGENTS.md, the homepage in `site/`, and the TSDoc on the exported types.
Documentation must not go stale.
