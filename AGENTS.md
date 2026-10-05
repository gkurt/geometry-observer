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
bun run smoke      # Pack, install the tarball, use it as a consumer would
bun run bench      # Compare with other approaches in real engines (slow; --quick)
```

Prefer these scripts over ad-hoc commands. Do not prefix them with `bun run` when
a bare alias exists (`bun check`, `bun typecheck`). Before finishing, run
`bun run fix` then `bun run checks` — the linter, formatter and `tsc` own all
mechanical style rules. Fix the code; don't disable rules.

## Project Structure

- `src/types.ts` — the public type surface. No logic.
- `src/support.ts` — `isSupported()`, memoised.
- `src/probe.ts` — the hidden probe element: its style, the shared top-layer
  group, and the pool. The comments explain why each
  declaration is there; several matter in ways that aren't obvious.
- `src/observer.ts` — the class, plus the page-wide listener registry and the
  sampling fallback. One set of listeners serves every observer instance.
- `src/observe-geometry.ts` — one-target convenience wrapper.
- `src/react.ts` — the `geometry-observer/react` entry point. React is an optional
  peer dependency; nothing else in the package imports it.
- `test/` — Vitest browser tests. See CONTRIBUTING.md for the split.
- `scripts/smoke.mts` — packs the tarball, installs it into a throwaway project
  and uses it. The suite imports `#src/*`, so this is the only check on `files`,
  the `exports` map and `dist`.
- `bench/` — benchmarks against a rAF loop, Floating UI's `autoUpdate` and a
  `ResizeObserver`. `bench/README.md` explains the method; `bench/results.md` is
  the latest full run, so regenerate it when behaviour it measures changes.
- `site/index.html` — the homepage. It imports the built `dist`, so preview it
  with `bun run site` and a static server on `_site/`.

## Architecture

The mechanism is three CSS features chained into a DOM event:

1. `anchor()` / `anchor-size()` resolve a target's box into computed lengths on a
   probe element, kept in sync by layout.
2. Those are ordinary computed values, so they are transitionable.
3. A running transition dispatches `transitionstart`, which is the notification.

The probe only raises events; it is never measured. Entries always use
`target.getBoundingClientRect()`, because a probe that lost its anchor sits at its
fallback position and no longer describes anything.

Four details are easy to break without noticing. Each has a comment where it's
defined:

- **`position-anchor`**, rather than naming the anchor inside each `anchor()`
  call, is what makes the engine scroll-adjust the probe.
- **`popover="manual"`** on the probe group puts every probe in the top layer.
  Without it, a probe inside a transformed subtree moves with the target, its
  insets never change, and ancestor `transform` changes go unreported. It's on
  the group, not each probe: per-probe `showPopover()` made `observe()`
  quadratic in Chromium (1,000 targets took over 4s) and made each probe's
  share of a reflow up to twice as large. The group is re-raised whenever a
  popover, dialog or fullscreen element opens, since an anchor in a later
  top-layer element can't be resolved.
- **Length fallbacks** in `anchor(top, …)` make teardown observable. Without one,
  a lost anchor resolves to `auto`, and a length doesn't transition to `auto`.
- **`!important` on every probe declaration**. Otherwise a reset like
  `* { transition: none !important }` stops all reporting without any error.

Scrolling can't start a transition (the engine applies scroll offsets after
layout), so it's handled by one passive capture-phase listener that wakes the
targets inside the element that scrolled.

WebKit doesn't restyle a probe whose anchor is removed or hidden, so teardown
raises no transition there. `src/support.ts` measures this, and in engines that
need it the observer adds one `MutationObserver` on the document that wakes the
targets a removal or attribute change can affect.

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

The README, the homepage, the code comments and the tests state specific facts:
per-probe reflow cost, event counts under churn, which engines report teardown.
Each came from a measurement. If you change behaviour one depends on, measure
again and update it everywhere it appears. Don't add a performance or coverage
claim you haven't measured.

Engine differences are measured, not sniffed. `test/capabilities.ts` checks
whether the current browser reports a target hidden by CSS alone, so that test
starts running on an engine once it supports it.

## Documentation

When changing user-facing APIs, update all relevant docs in the same change:
README.md, AGENTS.md, the homepage in `site/`, and the TSDoc on the exported types.
Documentation must not go stale.
