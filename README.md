# geometry-observer

Event-based element position and size observation. No polling, no `requestAnimationFrame` loop, no observer re-arming — and no main-thread work at all while nothing moves.

```bash
bun add geometry-observer
```

## Why

Every existing answer to "tell me when this element moved" is a sampler. `ResizeObserver` sees size but never position. `IntersectionObserver` has to be torn down and rebuilt around the element's current rect after every hit. Everything else is a rAF loop calling `getBoundingClientRect()` sixty times a second, mostly to learn that nothing happened.

This chains three shipped CSS features into a notification instead:

1. `anchor()` / `anchor-size()` resolve a target's box into computed lengths on a hidden probe element, kept in sync by layout.
2. Those are ordinary computed values, so they are transitionable.
3. A running transition dispatches `transitionstart`.

The probe never affects layout, never paints, and runs no JavaScript. The layout engine reports geometry changes on its own.

## Usage

```ts
import { GeometryObserver } from 'geometry-observer';

const observer = new GeometryObserver((entries) => {
  for (const { target, rect, state } of entries) {
    if (state === 'detached') continue;
    overlayFor(target).style.transform = `translate(${rect.x}px, ${rect.y}px)`;
  }
});

observer.observe(element);
```

One element, one teardown function:

```ts
import { observeGeometry } from 'geometry-observer';

const stop = observeGeometry(element, ([entry]) => place(entry.rect));
```

## What fires

| Change                            | geometry-observer        | ResizeObserver   | IntersectionObserver |
| --------------------------------- | ------------------------ | ---------------- | -------------------- |
| Element resized                   | event                    | event            | —                    |
| Content changed its size          | event                    | event            | —                    |
| **A sibling above it grew**       | **event**                | —                | re-arm only          |
| **A node was inserted above it**  | **event**                | —                | re-arm only          |
| **An ancestor's padding changed** | **event**                | —                | re-arm only          |
| An ancestor `transform` changed   | event                    | —                | —                    |
| Scrolled                          | routed `scroll` listener | —                | event                |
| Hidden with `display: none`       | `state: 'hidden'`        | `0×0`, ambiguous | —                    |
| Detached                          | `state: 'detached'`      | `0×0`, ambiguous | —                    |
| **Cost while nothing moves**      | **zero**                 | zero             | zero                 |

The middle rows are the point. "A sibling above me grew, so I moved" is the most common way an element changes position, and it is exactly what no observer reports.

## API

### `new GeometryObserver(callback, init?)`

| Option   | Default   | Meaning                                                                                                                                                                             |
| -------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `batch`  | `'frame'` | `'frame'` batches one callback per animation frame, like `ResizeObserver`. `'sync'` delivers inside the transition event — a frame earlier, possibly several times per frame.       |
| `track`  | `'both'`  | `'position'` or `'size'` transitions two properties instead of four, roughly halving the probe's cost. Narrowing stops an axis _raising_ events; entries still carry the full rect. |
| `settle` | `0`       | Report only once geometry has been still for this many milliseconds.                                                                                                                |

Methods: `observe(target, { anchorName? })`, `unobserve(target)`, `disconnect()`, `takeRecords()`, `reconfigure({ track?, settle?, batch? })`. Getters: `track`, `settle`, `batch`.

`reconfigure()` rewrites one inline declaration per probe — nothing is rebuilt, re-observed or re-measured.

### Entries

```ts
interface GeometryEntry {
  target: Element;
  rect: DOMRectReadOnly; // live viewport rect, scroll- and transform-adjusted
  previousRect: DOMRectReadOnly | null;
  moved: boolean;
  resized: boolean;
  state: 'rendered' | 'hidden' | 'detached';
}
```

`state` exists because `0×0` is three different facts: an element collapsed by its own content, one hidden with `display: none`, and one removed from the document all measure the same. `ResizeObserver` reports them identically.

### `settle` is `transition-delay`, not a timer

Each change cancels the pending transition and restarts its delay, so during churn **no event reaches the main thread at all** — something a JS debounce cannot do, because it has to run on every frame to reset its own timer. Trailing edge only: a target that never stops moving never reports.

```ts
new GeometryObserver(callback, { settle: 250 });
```

### `isSupported()`

Whether the native mechanism is available. Where it is not, the observer keeps the same API and falls back to a single shared sampling loop, so calling code never has to branch.

## Browser support

| Engine        | Mechanism | Notes                                                                       |
| ------------- | --------- | --------------------------------------------------------------------------- |
| Chromium 125+ | native    | Everything in the table above.                                              |
| Safari 26+    | native    | Anchor positioning ships; teardown (`hidden` / `detached`) is not reported. |
| Firefox       | fallback  | No anchor positioning yet; a shared sampling loop keeps the API identical.  |

## Caveats

- **Cost is per reflow, not per frame.** Each probe is a real box the engine lays out, so probes add time to every reflow — including ones in which nothing they watch moved. A sampler instead pays on every frame, moving or not. The two meet at a low single-digit number of reflows per second, so this is an idle-cost and coverage win rather than a throughput one. Under sustained layout churn, a shared sampler is cheaper.
- **Teardown is best-effort.** Unobserve from whatever already knows the element is going away; do not wait for a `detached` entry. WebKit never reports it: it drops the `anchor()` fallback that makes a lost anchor observable unless the probe is a direct child of `<body>`, which would mean one body child per observed element.
- **Composited transforms trail by about half a frame.** Exact at rest, a few pixels behind mid-flight.
- **Don't let a CSS reset kill it.** The probe's declarations are written with `!important` precisely because a blanket `* { transition: none !important }` would otherwise switch the whole thing off silently. Probes you hand-write in a stylesheet have no such protection.

## License

MIT © [Gokhan Kurt](https://x.com/gkurttech)
