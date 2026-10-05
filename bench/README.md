# Benchmarks

Compares geometry-observer with the other ways to keep track of where elements are, in real browsers.

```bash
bun run bench            # Chromium, WebKit and Firefox; writes results.md
bun run bench --quick    # 100 targets, one run each, prints only
bun run bench --engine webkit
```

The latest full run is in [results.md](results.md).

## Approaches

- **geometry-observer**: this library.
- **raf-loop**: `getBoundingClientRect()` on every target in one shared `requestAnimationFrame` loop. The usual hand-rolled approach, and what Floating UI's `autoUpdate` does with `animationFrame: true`.
- **floating-ui**: Floating UI's `autoUpdate` with its defaults: a `ResizeObserver`, `scroll` and `resize` listeners on every overflow ancestor, and an `IntersectionObserver` rebuilt around the element after each move. One call per target.
- **resize-observer**: a single `ResizeObserver`. It sees size changes only, and is here to show what the others catch beyond that.

Every approach reports into the same consumer, which reads `getBoundingClientRect()` and keeps the rect if it changed. That read is part of each approach's cost, because a real consumer needs the rect.

## Main-thread cost

The targets are a column of small boxes inside a scroller. Each scenario changes something every frame:

| scenario               | what changes every frame                                                         |
| ---------------------- | -------------------------------------------------------------------------------- |
| idle                   | nothing, and no frames are requested                                             |
| unrelated reflow       | the width of an element outside the scroller, so layout runs but no target moves |
| all targets move       | the height of an element above the scroller, so every target moves               |
| one resize / 10 frames | one target's width, every tenth frame                                            |
| scroll                 | the scroller's `scrollTop`                                                       |
| ancestor transform     | a `transform` on the scroller's parent                                           |

Each cell is the main-thread time an approach adds per frame over the same page with nothing tracking it, from Chromium's own task accounting (`Performance.getMetrics`, `TaskDuration`). That covers script, style, layout, paint and event dispatch. Setup isn't counted: observing happens before the measured window. Each value is the median of three runs.

Only Chromium is measured for cost, because only Chromium exposes this accounting. Filling idle time with fixed work and counting what's left was tried for WebKit and was noisier, at around ±1.5ms per frame, than the differences it was meant to show.

**stale** marks targets whose last report was still wrong after the page settled: changes the approach missed rather than reported late.

## Coverage

One target, one change, then half a second to settle. Besides the obvious changes, a few cases start with the target off-screen, scrolled out of view inside its scroller, or partly clipped, because an `IntersectionObserver` sees a clipped element differently from a visible one. A cell says whether the last report matched the real rect, and how long after the change the first correct report arrived. Latency is the median of three runs, timed from the end of the change, so an animation's own duration doesn't count.

Run in every engine Playwright can launch. Firefox can't launch from Playwright on macOS 27 (see `vitest.config.ts`), so on a Mac its section says it was skipped. Run the benchmark on Linux to include it.

## What the latest run shows

From [results.md](results.md): Chromium 153 for cost, Chromium 153 and WebKit 26.6 for coverage. Values under 1ms vary by up to 2× between runs; the ordering doesn't.

- **geometry-observer is cheapest only when nothing changes.** It adds nothing then. While scrolling it beats Floating UI, which re-reads every target on each scroll event, but not a rAF loop. A rAF loop adds 0.2–0.9ms per frame with 10–1,000 targets, and keeps the page rendering every frame. Floating UI adds close to nothing as well.
- **Every reflow costs geometry-observer something, even one that moves nothing.** Each probe is an anchor-positioned box that Chromium lays out on every reflow: about 8ms per frame with 1,000 targets, against under 1ms for the others. This doesn't depend on which properties transition or on containment. A probe with no transition at all costs the same.
- **Constant motion is its worst case.** When every target moves every frame, each probe also starts a transition and fires events every frame: about 28ms per frame with 1,000 targets, against 0.7ms for a rAF loop and 4ms for Floating UI. `contain: strict` on the probes brought this down from about 35ms, by keeping Chromium to one layout per frame.
- **Coverage is where it matches a rAF loop.** Both catch every change in the table. Floating UI misses a target that moves while it's scrolled out of view inside its scroller. `ResizeObserver` sees only size changes.
- **In Chromium, reports often arrive a frame late.** Most layout changes were reported 16–19ms later, because the transition event is dispatched in the following frame. A rAF loop sees them in the same frame. WebKit reported within a few milliseconds, except after a transform animation.
