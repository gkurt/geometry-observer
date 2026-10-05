# geometry-observer

An experiment: an observer for element position and size built on CSS anchor positioning. It reports when an element moves for any reason, including a sibling above it growing, and does no work at all while the page is idle.

It is not the cheapest way to track geometry once things start moving. Every observed element adds layout work to every reflow on the page, and constant motion costs far more than a `requestAnimationFrame` loop. [Performance](#performance) has the numbers, and when to use something else.

```bash
npm install geometry-observer
```

## Why

`ResizeObserver` reports size changes but not movement. `IntersectionObserver` can detect movement only if you rebuild it around the element's current rect after every callback, which is what Floating UI's `autoUpdate` does. The other common approach is a `requestAnimationFrame` loop that calls `getBoundingClientRect()` every frame, whether or not anything moved.

This library tries a third way: get the browser to send an event when layout moves an element.

1. Each observed element gets a hidden probe that stretches, with `anchor()`, from the element's top-left corner to far past the viewport. Its size therefore encodes the element's position.
2. When layout moves the element, the probe resizes, and a `ResizeObserver` on the probe reports it in the same frame. The same `ResizeObserver` watches the element's own size.
3. The observer then reads the element's rect. Scrolling moves elements without a layout, so one scroll listener covers it.

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

Measured in Chromium and WebKit by [bench/](bench/); Firefox differences are under [Browser support](#browser-support). Floating UI's `autoUpdate` combines a `ResizeObserver`, scroll listeners and a rebuilt `IntersectionObserver`.

| Change                                   | geometry-observer   | ResizeObserver | Floating UI `autoUpdate` | rAF loop |
| ---------------------------------------- | ------------------- | -------------- | ------------------------ | -------- |
| Element resized                          | yes                 | yes            | yes                      | yes      |
| Content changed its size                 | yes                 | yes            | yes                      | yes      |
| A sibling above it grew                  | yes                 | —              | yes                      | yes      |
| A node was inserted above it             | yes                 | —              | yes                      | yes      |
| An ancestor `transform` changed          | yes, except Firefox | —              | yes                      | yes      |
| Scrolled                                 | yes                 | —              | yes                      | yes      |
| Moved while off-screen or partly clipped | yes                 | —              | yes                      | yes      |
| Moved while scrolled out of its scroller | yes                 | —              | —                        | yes      |
| Hidden with `display: none`              | `state: 'hidden'`   | 0×0            | 0×0                      | 0×0      |
| Removed from the document                | `state: 'detached'` | 0×0            | 0×0                      | 0×0      |

## Performance

Main-thread time each approach adds per frame in Chromium 153, for 100 and 1,000 observed elements. From [bench/results.md](bench/results.md), which has more scenarios. Values under 1ms vary by up to 2× between runs; the ordering doesn't. In each column, 🟢 is the cheapest, 🟡 in between, 🔴 the most expensive, with costs within 0.1ms tied.

| Scenario                        | geometry-observer | rAF loop        | Floating UI `autoUpdate` |
| ------------------------------- | ----------------- | --------------- | ------------------------ |
| Nothing changes                 | 🟢 0 / 🟢 0       | 🔴 0.3 / 🔴 1.0 | 🟢 0 / 🟡 0.2            |
| A reflow that moves nothing     | 🔴 0.7 / 🔴 6.3   | 🟢 0.1 / 🟢 0.6 | 🟡 0.3 / 🟢 0.7          |
| Every element moves every frame | 🔴 1.2 / 🔴 9.0   | 🟢 0.1 / 🟢 1.1 | 🟡 0.7 / 🟡 4.5          |
| Scrolling                       | 🟡 0.4 / 🟡 4.5   | 🟢 0.1 / 🟢 0.7 | 🔴 0.7 / 🔴 5.4          |

It is cheapest only when nothing changes, and beats Floating UI (though not a rAF loop) while scrolling. Each probe is an anchor-positioned box, and Chromium lays out every one of them on every reflow, whether or not its target moved. That cost doesn't depend on the probe's styles or containment. Under constant motion it costs about twice Floating UI, and several times a rAF loop.

So:

- **For one floating element** (a tooltip, a popover, a menu), use Floating UI. It is cheaper whenever layout changes, and catches everything here except a reference scrolled out of view inside its scroller.
- **For anything that moves every frame**, use a rAF loop.
- **geometry-observer fits** a page that is mostly still, where you want to hear about any movement with no idle cost, including elements scrolled out of view, and to tell hidden and removed elements apart.

## API

### `new GeometryObserver(callback, init?)`

| Option   | Default   | Meaning                                                                                                                                                                                      |
| -------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `batch`  | `'frame'` | Layout changes always arrive in the frame they happen. For scrolls, viewport resizes and toggles, `'frame'` batches into the next animation frame and `'sync'` delivers in the event itself. |
| `track`  | `'both'`  | `'position'` watches only the probe. `'size'` watches only the element's own size and needs no probe, so it adds nothing to each reflow. Entries still carry the full rect.                  |
| `settle` | `0`       | Report only after the geometry has been still for this many milliseconds.                                                                                                                    |

Methods:

- `observe(target, { anchorName? })`. Pass `anchorName` if the target already has an `anchor-name` you want to reuse; the observer then never writes to the target's style.
- `unobserve(target)`
- `disconnect()`
- `takeRecords()` returns pending entries without calling the callback.
- `reconfigure({ track?, settle?, batch? })` changes options in place. A new `track` adds or removes probes; nothing is re-attached.

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

Each change restarts a timer, and the callback runs once the target has been still for `settle` milliseconds.

Only the trailing edge is reported: a target that keeps moving never reports.

### `isSupported()`

Whether this browser can run the anchor-based mechanism. Where it can't, `GeometryObserver` falls back to one shared `requestAnimationFrame` loop with the same API, so you don't need to branch on it.

### `PROBE_GROUP_ATTRIBUTE`

The probes live in a single `<div data-geometry-probes>` appended to `<body>`. The attribute name is exported in case your own selectors need to skip it.

## Browser support

|                                        | Chromium 125+ | Safari 26+                   | Firefox (tested on 155) |
| -------------------------------------- | ------------- | ---------------------------- | ----------------------- |
| Mechanism                              | anchor probes | anchor probes                | anchor probes           |
| Position, size and layout-driven moves | yes           | yes                          | yes                     |
| Ancestor `transform`                   | yes           | yes                          | no                      |
| `detached` state                       | yes           | yes                          | yes                     |
| `hidden` state                         | yes           | yes, except 0×0 by CSS alone | yes                     |
| Work while the page is idle            | none          | none                         | none                    |

Browsers without anchor positioning or `ResizeObserver` fall back to one shared `requestAnimationFrame` loop, which catches everything but checks every frame.

WebKit on Linux (the WebKit Playwright runs there) delivers no `ResizeObserver` notifications at all while an element is fullscreen, so layout changes go unreported until fullscreen ends. Safari on macOS keeps delivering them.

**Safari** doesn't restyle a probe when its anchor is removed or hidden, so the probe keeps its last box and doesn't resize. Any other style change on the probe makes it fall back correctly, so this looks like a missing invalidation in WebKit (seen in Safari 26.6 and 27.0). An element with a size still shrinks to 0×0 when hidden or removed, and its own `ResizeObserver` reports that. For a 0×0 element, or with `track: 'position'`, the observer also watches DOM mutations in engines where `isSupported()` measured the problem: a removal wakes every element that is no longer connected, and an attribute change (`style`, `class`, `hidden`, `open`, …) wakes the elements at or under the one that changed. Such an element hidden by CSS alone, like a `:hover` rule or a stylesheet edit, isn't reported until something else wakes it.

**Firefox** resolves `anchor()` against an element's untransformed box, so a change to an ancestor's `transform` doesn't resize the probe and isn't reported. Everything else works as in the other engines.

## Caveats

- **The cost is per reflow, not per frame.** See [Performance](#performance). Against a rAF loop, which costs the same every frame, it breaks even at roughly 10–20 reflows per second in Chromium, from the numbers there.
- **In Safari, a 0×0 element hidden by CSS alone goes unreported.** See [Browser support](#browser-support). Removal is always reported.
- **Composited transform animations lag by about half a frame.** The rect is exact once the animation stops, but a few pixels behind while it runs.
- **Page styles can't turn it off.** The probe's styles are inline and `!important`, and nothing depends on transitions or animations, so resets like `* { transition: none !important }` don't affect it.

## License

MIT © [Gokhan Kurt](https://x.com/gkurttech)
