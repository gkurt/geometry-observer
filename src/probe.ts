import type { Track } from './types.ts';

/** Marks the group element in the DOM, so it is identifiable in devtools and in tests. */
export const PROBE_GROUP_ATTRIBUTE = 'data-geometry-probes';

/**
 * Where the probe parks when it loses its anchor. Any length works; it only has
 * to be a length rather than `auto` — see {@link PROBE_STYLE}.
 */
const LOST = '-99999px';

/**
 * Every declaration is written with `!important`.
 *
 * The transition is not decoration here, it is the entire mechanism, and a blanket
 * author reset — `* { transition: none !important }`, which plenty of reduced-motion
 * and test setups ship — otherwise switches the observer off silently: the probe
 * goes on tracking the target perfectly and simply stops reporting. An important
 * declaration in a style attribute outranks an important one in a stylesheet, so
 * this is the only placement that cannot be overridden from CSS.
 *
 * The fallback arguments to `anchor()` and `anchor-size()` are what make teardown
 * observable. Without them, losing the anchor leaves these properties invalid at
 * computed-value time, so they resolve to `auto` — and a length does not
 * interpolate to `auto`, so no transition runs and the target's disappearance is
 * never announced. With a fallback the value stays a length, the transition runs,
 * and the probe announces its own orphaning by parking off-screen.
 *
 * `content-visibility: hidden` costs the probe nothing — it has no contents to
 * skip — and takes a sizeable bite out of its share of every reflow.
 */
export const PROBE_STYLE: Readonly<Record<string, string>> = {
  position: 'fixed',
  margin: '0',
  border: '0',
  padding: '0',
  background: 'none',
  visibility: 'hidden',
  'pointer-events': 'none',
  'content-visibility': 'hidden',
  top: `anchor(top, ${LOST})`,
  left: `anchor(left, ${LOST})`,
  width: 'anchor-size(width, 0px)',
  height: 'anchor-size(height, 0px)',
};

const TRACKED: Readonly<Record<Track, readonly string[]>> = {
  both: ['top', 'left', 'width', 'height'],
  position: ['top', 'left'],
  size: ['width', 'height'],
};

/**
 * 1ms of duration is all the mechanism needs; the delay is what debounces.
 *
 * Listen for `transitionstart` rather than `transitionrun`: run fires when a
 * transition is *created*, so once per frame regardless of delay, while start
 * fires once the delay has elapsed. With no delay the two coincide.
 */
export function transitionFor(track: Track, settle: number): string {
  return TRACKED[track].map((property) => `${property} 1ms ${settle}ms`).join(', ');
}

/**
 * Probes live inside one `display: contents` group rather than as direct children
 * of `<body>`, so the host page's body gains a single child whatever the observer
 * is watching and `body.children`, `body > *` rules and `:nth-child()` still see
 * what the page author put there.
 *
 * `display: contents` means the group generates no box, so it can neither affect
 * layout nor become a containing block; and because the probes sit in the top
 * layer, even a page rule forcing a transform onto the group leaves them anchored
 * correctly.
 *
 * The one cost is in WebKit 26, which applies an `anchor()` length fallback only
 * when the probe is a direct child of `<body>` — any element parent silences it,
 * whatever the depth or tree position, in the top layer or out of it. That
 * fallback is what turns a lost anchor into an event, so grouping is why WebKit
 * reports no `hidden` / `detached` state. Nothing in the spec ties anchor
 * resolution to the parent element (it is defined over containing blocks, and a
 * `position: fixed` probe's containing block is always the viewport), so this is a
 * WebKit bug. Keeping the group is the right trade: teardown is documented as
 * best-effort on every engine, whereas a probe per observed element directly under
 * `<body>` would reshape `body.children` for every page using the library.
 */
let group: HTMLElement | null = null;

function probeGroup(): HTMLElement {
  if (group?.isConnected === true) return group;
  group = document.createElement('div');
  group.setAttribute(PROBE_GROUP_ATTRIBUTE, '');
  group.setAttribute('aria-hidden', 'true');
  group.style.setProperty('display', 'contents', 'important');
  document.body.append(group);
  return group;
}

export function releaseProbeGroup(): void {
  if (group !== null && group.childElementCount === 0) {
    group.remove();
    group = null;
  }
}

/** Probes are interchangeable, so retire them to a pool instead of churning DOM. */
const pool: HTMLElement[] = [];

/**
 * `popover="manual"` puts the probe in the top layer. That stops any ancestor's
 * overflow, transform, filter or containment from clipping it or stealing its
 * containing block, sidesteps the rule that an element can only anchor to
 * something preceding it in tree order, and — because the probe's containing
 * block is then the viewport rather than anything inside a transformed subtree —
 * is what makes ancestor `transform` changes show up as events at all.
 */
export function createProbe(anchorName: string, track: Track, settle: number): HTMLElement {
  const probe = pool.pop() ?? document.createElement('div');
  probe.setAttribute('popover', 'manual');
  const { style } = probe;
  for (const [property, value] of Object.entries(PROBE_STYLE)) style.setProperty(property, value, 'important');
  style.setProperty('position-anchor', anchorName, 'important');
  style.setProperty('transition', transitionFor(track, settle), 'important');
  probeGroup().append(probe);
  try {
    probe.showPopover();
  } catch {
    // No top layer available: the probe still anchors, it just loses clip and
    // transform immunity.
  }
  return probe;
}

export function retireProbe(probe: HTMLElement): void {
  try {
    probe.hidePopover();
  } catch {
    // Never shown.
  }
  probe.remove();
  probe.style.cssText = '';
  if (pool.length < 64) pool.push(probe);
}
