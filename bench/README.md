# Benchmarks

Compares geometry-observer with the other ways to keep track of where elements are, in real browsers.

```bash
bun run bench            # Chromium, WebKit and Firefox; writes results.md
bun run bench --quick    # 100 targets, one run each, prints only
bun run bench --engine webkit
bun run bench --cost       # or --coverage: one section only
bun run bench --approaches geometry-observer,raf-loop
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

## Results

From the latest full run, [results.md](results.md), on Chromium 153.0.8010.12 and WebKit 26.6. Values under 1ms vary by up to 2× between runs; the ordering doesn't.

### Main-thread cost (Chromium)

Milliseconds added per frame. **stale** counts targets whose last report was still wrong once the page settled.

| scenario               | targets | geometry-observer | raf-loop | floating-ui |   resize-observer |
| ---------------------- | ------: | ----------------: | -------: | ----------: | ----------------: |
| idle                   |      10 |              0.00 |     0.17 |        0.00 |              0.00 |
| idle                   |     100 |              0.00 |     0.27 |        0.00 |              0.00 |
| idle                   |    1000 |              0.00 |     1.04 |        0.21 |              0.00 |
| unrelated reflow       |      10 |              0.15 |     0.12 |        0.12 |              0.00 |
| unrelated reflow       |     100 |              0.73 |     0.11 |        0.25 |              0.07 |
| unrelated reflow       |    1000 |              6.30 |     0.63 |        0.65 |              0.00 |
| all targets move       |      10 |              0.28 |     0.04 |        0.13 |   0.00 (10 stale) |
| all targets move       |     100 |              1.16 |     0.13 |        0.66 |  0.00 (100 stale) |
| all targets move       |    1000 |              8.98 |     1.05 |        4.48 | 0.19 (1000 stale) |
| one resize / 10 frames |      10 |              0.02 |     0.00 |        0.02 |              0.00 |
| one resize / 10 frames |     100 |              0.27 |     0.08 |        0.21 |              0.05 |
| one resize / 10 frames |    1000 |              2.13 |     0.73 |        0.59 |              0.03 |
| scroll                 |      10 |              0.08 |     0.01 |        0.13 |   0.04 (10 stale) |
| scroll                 |     100 |              0.41 |     0.09 |        0.65 |  0.00 (100 stale) |
| scroll                 |    1000 |              4.48 |     0.66 |        5.40 | 0.10 (1000 stale) |
| ancestor transform     |      10 |              0.13 |     0.00 |        0.00 |   0.00 (10 stale) |
| ancestor transform     |     100 |              1.11 |     0.09 |        0.82 |  0.00 (100 stale) |
| ancestor transform     |    1000 |              9.35 |     0.70 |        4.27 | 0.00 (1000 stale) |

### Coverage (Chromium)

| change                                   | geometry-observer | raf-loop | floating-ui | resize-observer |
| ---------------------------------------- | :---------------: | :------: | :---------: | :-------------: |
| sibling above grows                      |     yes, 0ms      | yes, 3ms |  yes, 0ms   |       no        |
| sibling inserted before it               |     yes, 1ms      | yes, 2ms |  yes, 1ms   |       no        |
| own size (style)                         |     yes, 1ms      | yes, 3ms |  yes, 0ms   |    yes, 0ms     |
| own size (content)                       |     yes, 5ms      | yes, 2ms |  yes, 5ms   |    yes, 3ms     |
| ancestor transform                       |     yes, 0ms      | yes, 3ms |  yes, 1ms   |       no        |
| ancestor transform animation             |     yes, 0ms      | yes, 0ms |  yes, 0ms   |       no        |
| nested scroll                            |     yes, 0ms      | yes, 2ms |  yes, 0ms   |       no        |
| page scroll                              |     yes, 0ms      | yes, 0ms |  yes, 0ms   |       no        |
| moves while off-screen                   |     yes, 1ms      | yes, 5ms |  yes, 1ms   |       no        |
| moves while scrolled out of its scroller |     yes, 1ms      | yes, 3ms |     no      |       no        |
| moves while partly clipped               |     yes, 1ms      | yes, 2ms |  yes, 1ms   |       no        |
| display: none                            |     yes, 1ms      | yes, 2ms |  yes, 0ms   |    yes, 0ms     |
| removed                                  |     yes, 1ms      | yes, 2ms |  yes, 0ms   |    yes, 0ms     |

### Coverage (WebKit)

| change                                   | geometry-observer | raf-loop  | floating-ui | resize-observer |
| ---------------------------------------- | :---------------: | :-------: | :---------: | :-------------: |
| sibling above grows                      |     yes, 0ms      | yes, 3ms  |  yes, 1ms   |       no        |
| sibling inserted before it               |     yes, 1ms      | yes, 3ms  |  yes, 0ms   |       no        |
| own size (style)                         |     yes, 1ms      | yes, 3ms  |  yes, 1ms   |    yes, 1ms     |
| own size (content)                       |     yes, 1ms      | yes, 1ms  |  yes, 2ms   |    yes, 1ms     |
| ancestor transform                       |     yes, 1ms      | yes, 3ms  |  yes, 1ms   |       no        |
| ancestor transform animation             |     yes, 1ms      | yes, 0ms  |  yes, 0ms   |       no        |
| nested scroll                            |     yes, 1ms      | yes, 3ms  |  yes, 0ms   |       no        |
| page scroll                              |     yes, 1ms      | yes, 10ms |  yes, 0ms   |       no        |
| moves while off-screen                   |     yes, 1ms      | yes, 14ms |  yes, 1ms   |       no        |
| moves while scrolled out of its scroller |     yes, 0ms      | yes, 11ms |     no      |       no        |
| moves while partly clipped               |     yes, 1ms      | yes, 11ms |  yes, 1ms   |       no        |
| display: none                            |     yes, 1ms      | yes, 1ms  |  yes, 1ms   |    yes, 0ms     |
| removed                                  |     yes, 1ms      | yes, 14ms |  yes, 0ms   |    yes, 0ms     |

### Before: probes with transitions

The first design copied the target's box onto the probe with `anchor()` and `anchor-size()`, and signalled through a 1ms transition and `transitionstart`. It was never published. With 1,000 targets in Chromium, from the last run of that design:

| scenario           | transitions | `ResizeObserver` |
| ------------------ | ----------: | ---------------: |
| idle               |        0.00 |             0.00 |
| unrelated reflow   |        7.72 |             6.30 |
| all targets move   |       27.87 |             8.98 |
| ancestor transform |       24.36 |             9.35 |
| scroll             |        3.96 |             4.48 |

The transition design also reported a frame late in Chromium (16–19ms), and Firefox never started transitions from anchor changes, so it fell back to checking every frame there.

## What the results show

- **geometry-observer is cheapest only when nothing changes.** It adds nothing then. A rAF loop adds 0.2–1ms per frame with 10–1,000 targets, and keeps the page rendering every frame. Floating UI adds close to nothing as well.
- **Every reflow costs geometry-observer something, even one that moves nothing.** Each probe is an anchor-positioned box that Chromium lays out on every reflow: about 6ms per frame with 1,000 targets, against under 1ms for the others. This doesn't depend on the probe's styles, containment or transitions.
- **Under constant motion it costs about twice Floating UI and several times a rAF loop.** With 1,000 targets moving every frame: 9ms, against 4.5ms and 1ms.
- **While scrolling it beats Floating UI**, which re-reads every target on each scroll event, but not a rAF loop.
- **Coverage matches a rAF loop.** Both catch every change in the tables. Floating UI misses a target that moves while it's scrolled out of view inside its scroller: it re-checks a fully clipped element once a second. `ResizeObserver` sees only size changes.
- **Reports arrive in the frame of the change**, mostly within 1ms.

## Ideas that didn't help

- **Cheaper probes.** Tracking fewer properties, `contain: strict`, `content-visibility` and dropping the transition all left the per-reflow cost unchanged. It comes from the box existing.
- **Several targets per probe.** Four targets per probe cut the per-reflow cost about 2.5×, but only the four inset properties accept `anchor()`, so one probe can fully track at most two targets: about 30% saved.
- **An `IntersectionObserver` with `scrollMargin`**, to see through nested scrollers like the probes do. Chromium and WebKit apply the margin to the viewport too, which defeats the shrunk-root trick, so it detected almost nothing.
