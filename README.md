# geometry-observer

An experiment: an observer for element position and size built on CSS anchor positioning. It reports when an element moves for any reason, including a sibling above it growing, and does no work at all while the page is idle.

It is not the cheapest way to track geometry once things start moving. Every observed element adds layout work to every reflow on the page, and constant motion costs far more than a `requestAnimationFrame` loop. [Performance](#performance) has the numbers, and when to use something else.

```bash
npm install geometry-observer
```

## Why

`ResizeObserver` reports size changes but not movement. `IntersectionObserver` can detect movement only if you rebuild it around the element's current rect after every callback, which is what Floating UI's `autoUpdate` does. The other common approach is a `requestAnimationFrame` loop that calls `getBoundingClientRect()` every frame, whether or not anything moved.

This library tries a third way: get the browser to send an event when layout moves an element.

1. Each observed element gets a hidden probe element that copies its box with `anchor()` and `anchor-size()`. Layout keeps the probe's `top`, `left`, `width` and `height` in sync with the target.
2. Those properties have a 1ms transition.
3. When the target moves or resizes, the probe's transition starts and fires `transitionstart`. The observer then reads the target's rect.

The probe takes no space in the layout and is never painted.

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

For a single element, `observeGeometry` returns a function that stops observing:

```ts
import { observeGeometry } from 'geometry-observer';

const stop = observeGeometry(element, ([entry]) => place(entry.rect));
```

### React

```tsx
import { useGeometryObserver } from 'geometry-observer/react';

function Tooltip() {
  const ref = useGeometryObserver(([entry]) => place(entry.rect));
  return <button ref={ref}>Hover me</button>;
}
```

The returned ref callback keeps its identity across renders and always calls the latest callback, so an inline function is fine. Changing `track`, `settle` or `batch` updates the existing observer. A new element or `anchorName` re-subscribes.

The hook needs React 19, because it releases the observer from the ref callback's cleanup. `react` is an optional peer dependency, and the main entry point doesn't import it.

To combine it with a ref of your own, return its cleanup and wrap the combined ref in `useCallback`. React calls a new ref callback on every render, so an inline one re-subscribes every time:

```tsx
const geometry = useGeometryObserver(onGeometry);
const ref = useCallback(
  (node: HTMLDivElement | null) => {
    mine.current = node;
    return geometry(node);
  },
  [geometry],
);
```

## What it reports

Measured in Chromium and WebKit by [bench/](bench/). Floating UI's `autoUpdate` combines a `ResizeObserver`, scroll listeners and a rebuilt `IntersectionObserver`.

| Change                                   | geometry-observer   | ResizeObserver | Floating UI `autoUpdate` | rAF loop |
| ---------------------------------------- | ------------------- | -------------- | ------------------------ | -------- |
| Element resized                          | yes                 | yes            | yes                      | yes      |
| Content changed its size                 | yes                 | yes            | yes                      | yes      |
| A sibling above it grew                  | yes                 | —              | yes                      | yes      |
| A node was inserted above it             | yes                 | —              | yes                      | yes      |
| An ancestor `transform` changed          | yes                 | —              | yes                      | yes      |
| Scrolled                                 | yes                 | —              | yes                      | yes      |
| Moved while off-screen or partly clipped | yes                 | —              | yes                      | yes      |
| Moved while scrolled out of its scroller | yes                 | —              | —                        | yes      |
| Hidden with `display: none`              | `state: 'hidden'`   | 0×0            | 0×0                      | 0×0      |
| Removed from the document                | `state: 'detached'` | 0×0            | 0×0                      | 0×0      |

## Performance

Main-thread time each approach adds per frame in Chromium 153, for 100 and 1,000 observed elements. From [bench/results.md](bench/results.md), which has more scenarios. Values under 1ms vary by up to 2× between runs; the ordering doesn't.

| Scenario                        | geometry-observer | rAF loop  | Floating UI `autoUpdate` |
| ------------------------------- | ----------------- | --------- | ------------------------ |
| Nothing changes                 | 0 / 0             | 0.2 / 0.9 | 0 / 0.2                  |
| A reflow that moves nothing     | 0.9 / 7.7         | 0.1 / 0.6 | 0.1 / 0.8                |
| Every element moves every frame | 3.4 / 28          | 0.1 / 0.7 | 0.7 / 4.2                |
| Scrolling                       | 0.6 / 4.0         | 0.1 / 0.7 | 1.0 / 5.6                |

It is cheapest only when nothing changes, and beats Floating UI (though not a rAF loop) while scrolling. Each probe is an anchor-positioned box, and Chromium lays out every one of them on every reflow, whether or not its target moved. That doesn't depend on which properties transition, or on containment: a probe with no transition at all costs the same. When a target moves, its probe also starts a transition and fires events, every frame the movement lasts.

So:

- **For one floating element** (a tooltip, a popover, a menu), use Floating UI. It is cheaper whenever layout changes, and catches everything here except a reference scrolled out of view inside its scroller.
- **For anything that moves every frame**, use a rAF loop.
- **geometry-observer fits** a page that is mostly still, where you want to hear about any movement with no idle cost, including elements scrolled out of view, and to tell hidden and removed elements apart.

## API

### `new GeometryObserver(callback, init?)`

| Option   | Default   | Meaning                                                                                                                                                                   |
| -------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `batch`  | `'frame'` | `'frame'` delivers once per animation frame, like `ResizeObserver`. `'sync'` delivers inside the transition event: a frame earlier, but possibly several times per frame. |
| `track`  | `'both'`  | `'position'` or `'size'` transitions two properties instead of four, which roughly halves the probe's cost. Entries still carry the full rect.                            |
| `settle` | `0`       | Report only after the geometry has been still for this many milliseconds.                                                                                                 |

Methods:

- `observe(target, { anchorName? })`. Pass `anchorName` if the target already has an `anchor-name` you want to reuse; the observer then never writes to the target's style.
- `unobserve(target)`
- `disconnect()`
- `takeRecords()` returns pending entries without calling the callback.
- `reconfigure({ track?, settle?, batch? })` changes options in place. It rewrites one inline `transition` per probe and doesn't re-attach anything.

The current options are readable as `observer.track`, `observer.settle` and `observer.batch`.

### Entries

```ts
interface GeometryEntry {
  target: Element;
  rect: DOMRectReadOnly; // from getBoundingClientRect(), so scroll and transforms are included
  previousRect: DOMRectReadOnly | null;
  moved: boolean;
  resized: boolean;
  state: 'rendered' | 'hidden' | 'detached';
}
```

An element sized 0×0, one hidden with `display: none` and one removed from the document all have the same rect, so `state` tells you which it is. A `detached` target is reported once and then unobserved.

### Debouncing with `settle`

```ts
new GeometryObserver(callback, { settle: 250 });
```

`settle` is the probe's `transition-delay`. Each change restarts the delay, so no JavaScript runs until the target has been still for `settle` milliseconds. A JavaScript debounce would have to run on every change to reset its timer. Scrolling and the sampling fallback have no transition behind them, so they use a timer.

Only the trailing edge is reported: a target that keeps moving never reports.

### `isSupported()`

Whether this browser can run the anchor-based mechanism. Where it can't, `GeometryObserver` falls back to one shared `requestAnimationFrame` loop with the same API, so you don't need to branch on it.

### `PROBE_GROUP_ATTRIBUTE`

The probes live in a single `<div data-geometry-probes>` appended to `<body>`. The attribute name is exported in case your own selectors need to skip it.

## Browser support

|                                        | Chromium 125+ | Safari 26+       | Firefox             |
| -------------------------------------- | ------------- | ---------------- | ------------------- |
| Mechanism                              | anchor probes | anchor probes    | sampling fallback   |
| Position, size and layout-driven moves | yes           | yes              | yes                 |
| Ancestor `transform`                   | yes           | yes              | yes                 |
| `detached` state                       | yes           | yes              | yes                 |
| `hidden` state                         | yes           | from DOM changes | yes                 |
| Work while the page is idle            | none          | none             | one check per frame |

**Safari** doesn't restyle a probe when its anchor is removed or hidden, so the probe keeps its last box and no transition runs. Any other style change on the probe makes it fall back correctly, so this looks like a missing invalidation in WebKit (seen in Safari 26.6 and 27.0). `isSupported()` measures this, and where it happens the observer also watches DOM mutations: a removal wakes every target that is no longer connected, and an attribute change (`style`, `class`, `hidden`, `open`, …) wakes the targets at or under the element that changed. Popovers and dialogs report through their `toggle` event. A target hidden by CSS alone, such as a `:hover` rule, a stylesheet edit or a container query, isn't reported until something else wakes it. The mutation observer costs about 0.2–0.5ms per frame on a page that changes 300 attributes every frame.

**Firefox** accepts all the CSS involved, but doesn't yet support [transitions on anchor-driven changes](https://caniuse.com/wf-anchor-positioning-animations). `isSupported()` checks this by measuring a real probe rather than trusting `CSS.supports()`, and the observer falls back to sampling.

## Caveats

- **The cost is per reflow, not per frame.** See [Performance](#performance). Against a rAF loop it breaks even at about five reflows per second in Chromium, and several times that in Safari.
- **Reports often arrive a frame late in Chromium.** The transition event is dispatched in the frame after the change, so most layout changes were reported 16–19ms later, where a rAF loop sees them in the same frame. WebKit reported within a few milliseconds.
- **In Safari, CSS-only hiding goes unreported.** A target hidden by a pseudo-class or a stylesheet change, with no DOM mutation behind it, keeps its last `rendered` entry. Removal is always reported.
- **Composited transform animations lag by about half a frame.** The rect is exact once the animation stops, but a few pixels behind while it runs.
- **CSS resets can't turn it off.** The probe's styles are inline and `!important`, so a reset like `* { transition: none !important }` doesn't affect it.

## License

MIT © [Gokhan Kurt](https://x.com/gkurttech)
