import type { Track } from './types.ts';

/** Marks the group element in the DOM, so it is identifiable in devtools and in tests. */
export const PROBE_GROUP_ATTRIBUTE = 'data-geometry-probes';

/** Where a probe goes when it loses its anchor. Any length works, see {@link PROBE_STYLE}. */
const LOST = '-99999px';

/**
 * Every declaration is set inline with `!important`. The transition is the whole
 * mechanism, and a reset like `* { transition: none !important }` (common in
 * reduced-motion and test setups) would otherwise turn reporting off without any
 * error. An important inline declaration beats an important stylesheet one.
 *
 * The fallbacks in `anchor()` and `anchor-size()` make teardown observable. With
 * no fallback, a lost anchor makes these properties compute to `auto`, a length
 * can't transition to `auto`, and no event fires. With one, the probe moves to the
 * fallback position and the transition reports it.
 *
 * `content-visibility: hidden` changes nothing for a probe with no content, but
 * noticeably reduces its share of each reflow.
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
 * The 1ms duration only needs to be non-zero; the delay implements `settle`.
 * `transitionstart` waits for the delay, while `transitionrun` fires as soon as a
 * transition is created, which is why the observer listens for the former.
 */
export function transitionFor(track: Track, settle: number): string {
  return TRACKED[track].map((property) => `${property} 1ms ${settle}ms`).join(', ');
}

/**
 * All probes share one group, so the page's `<body>` gains one child rather than
 * one per observed element.
 *
 * `popover="manual"` puts the group in the top layer, where its containing block
 * is the viewport. No ancestor's overflow, transform or containment applies to the
 * probes, they can anchor to any element regardless of tree order, and an ancestor
 * `transform` moves the target without moving the probe, so the change is seen.
 *
 * One top-layer group, rather than each probe in the top layer itself, cuts the
 * probes' share of each reflow by 30–50% at 200–1,000 probes, and keeps `observe()`
 * linear: Chromium spends O(n) per `showPopover()`, so 1,000 per-probe popovers took
 * over 4s. The declarations below stop page styles on `[popover]` from turning the
 * group into a containing block for the probes.
 */
export const GROUP_STYLE: Readonly<Record<string, string>> = {
  display: 'block',
  position: 'fixed',
  inset: '0',
  width: '0',
  height: '0',
  margin: '0',
  border: '0',
  padding: '0',
  overflow: 'visible',
  background: 'none',
  visibility: 'hidden',
  'pointer-events': 'none',
  transform: 'none',
  translate: 'none',
  rotate: 'none',
  scale: 'none',
  perspective: 'none',
  filter: 'none',
  'backdrop-filter': 'none',
  contain: 'none',
  'container-type': 'normal',
  'content-visibility': 'visible',
  'will-change': 'auto',
};

let group: HTMLElement | null = null;

function probeGroup(): HTMLElement {
  if (group?.isConnected === true) return group;
  group = document.createElement('div');
  group.setAttribute(PROBE_GROUP_ATTRIBUTE, '');
  group.setAttribute('aria-hidden', 'true');
  group.setAttribute('popover', 'manual');
  for (const [property, value] of Object.entries(GROUP_STYLE)) group.style.setProperty(property, value, 'important');
  // `body` is typed non-null but is missing when this runs from a script in <head>.
  const mount: HTMLElement | null = document.body ?? document.documentElement;
  mount?.append(group);
  try {
    group.showPopover();
  } catch {
    // No top layer: the probes still anchor, but ancestor clips and transforms apply.
  }
  return group;
}

/**
 * An anchor inside a top-layer element shown after the group can't be resolved,
 * so whenever something else enters the top layer, the group goes back on top.
 */
export function raiseProbeGroup(opened: EventTarget | null): void {
  if (group === null || opened === group || !group.isConnected) return;
  try {
    group.hidePopover();
    group.showPopover();
  } catch {
    // No top layer, so no order to restore.
  }
}

export function releaseProbeGroup(): void {
  if (group !== null && group.childElementCount === 0) {
    group.remove();
    group = null;
  }
}

/** Probes are interchangeable, so unobserved ones are kept for reuse. */
const pool: HTMLElement[] = [];

export function createProbe(anchorName: string, track: Track, settle: number): HTMLElement {
  const probe = pool.pop() ?? document.createElement('div');
  const { style } = probe;
  for (const [property, value] of Object.entries(PROBE_STYLE)) style.setProperty(property, value, 'important');
  style.setProperty('position-anchor', anchorName, 'important');
  style.setProperty('transition', transitionFor(track, settle), 'important');
  probeGroup().append(probe);
  return probe;
}

export function retireProbe(probe: HTMLElement): void {
  probe.remove();
  probe.style.cssText = '';
  if (pool.length < 64) pool.push(probe);
}
