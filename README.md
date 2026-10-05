# geometry-observer

An observer for element position and size. It fires when an element moves for any reason, including a sibling above it growing, and runs no JavaScript while the page is idle.

```bash
npm install geometry-observer
```

## Why

`ResizeObserver` reports size changes but not movement. `IntersectionObserver` can detect movement only if you rebuild it around the element's current rect after every callback. The usual alternative is a `requestAnimationFrame` loop that calls `getBoundingClientRect()` every frame, whether or not anything moved.

geometry-observer gets the browser to send an event instead:

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

| Change                          | geometry-observer     | ResizeObserver | IntersectionObserver | rAF polling |
| ------------------------------- | --------------------- | -------------- | -------------------- | ----------- |
| Element resized                 | yes                   | yes            | —                    | yes         |
| Content changed its size        | yes                   | yes            | —                    | yes         |
| A sibling above it grew         | yes                   | —              | if rebuilt each time | yes         |
| A node was inserted above it    | yes                   | —              | if rebuilt each time | yes         |
| An ancestor's padding changed   | yes                   | —              | if rebuilt each time | yes         |
| An ancestor `transform` changed | yes                   | —              | —                    | yes         |
| Scrolled                        | yes, via one listener | —              | yes                  | yes         |
| Hidden with `display: none`     | `state: 'hidden'`     | 0×0            | —                    | 0×0         |
| Removed from the document       | `state: 'detached'`   | 0×0            | —                    | 0×0         |
| Work while the page is idle     | none                  | none           | none                 | every frame |

Most position changes come from something else in the layout: a sibling growing, content loading above, an ancestor's padding. `ResizeObserver` misses all of them.

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

|                                        | Chromium 125+ | Safari 26+    | Firefox             |
| -------------------------------------- | ------------- | ------------- | ------------------- |
| Mechanism                              | anchor probes | anchor probes | sampling fallback   |
| Position, size and layout-driven moves | yes           | yes           | yes                 |
| Ancestor `transform`                   | yes           | yes           | yes                 |
| `hidden` / `detached` state            | yes           | no            | yes                 |
| Work while the page is idle            | none          | none          | one check per frame |

**Safari** doesn't report `hidden` or `detached`. WebKit only applies the fallback value in `anchor()` when the probe is a direct child of `<body>`, and that fallback is what turns a lost anchor into an event. The library keeps all probes in one wrapper element rather than adding a `<body>` child per observed element, so in Safari you should unobserve elements when you remove them. This looks like a WebKit bug: the spec resolves anchors against the containing block, not the parent element.

**Firefox** accepts all the CSS involved, but anchor-driven changes never start a transition there. `isSupported()` checks this by measuring a real probe rather than trusting `CSS.supports()`, and the observer falls back to sampling.

## Caveats

- **The cost is per reflow, not per frame.** Each probe is a box the browser lays out, so it adds a little to every reflow on the page, including reflows that don't move its target. A rAF loop costs the same every frame instead. The two break even at a low single-digit number of reflows per second. geometry-observer wins on idle pages and on what it catches; under constant layout churn, one shared rAF loop is cheaper.
- **Don't wait for `detached`.** Safari never sends it. Unobserve elements from the code that removes them.
- **Composited transform animations lag by about half a frame.** The rect is exact once the animation stops, but a few pixels behind while it runs.
- **CSS resets can't turn it off.** The probe's styles are inline and `!important`, so a reset like `* { transition: none !important }` doesn't affect it.

## License

MIT © [Gokhan Kurt](https://x.com/gkurttech)
