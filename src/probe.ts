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
 * All probes share one `display: contents` wrapper, so the page's `<body>` gains
 * one child rather than one per observed element. The wrapper generates no box,
 * and the probes are in the top layer, so styles on the wrapper can't move them.
 *
 * The cost is in WebKit 26, which only applies an `anchor()` length fallback when
 * the probe is a direct child of `<body>`. Without the fallback a lost anchor
 * raises no event, so Safari never reports `hidden` or `detached`. Nothing in the
 * spec ties anchor resolution to the parent element, so this looks like a WebKit
 * bug. `contain` on the wrapper or probe doesn't help, and neither does dropping
 * `content-visibility`.
 */
let group: HTMLElement | null = null;

function probeGroup(): HTMLElement {
  if (group?.isConnected === true) return group;
  group = document.createElement('div');
  group.setAttribute(PROBE_GROUP_ATTRIBUTE, '');
  group.setAttribute('aria-hidden', 'true');
  group.style.setProperty('display', 'contents', 'important');
  // `body` is typed non-null but is missing when this runs from a script in <head>.
  const mount: HTMLElement | null = document.body ?? document.documentElement;
  mount?.append(group);
  return group;
}

export function releaseProbeGroup(): void {
  if (group !== null && group.childElementCount === 0) {
    group.remove();
    group = null;
  }
}

/** Probes are interchangeable, so unobserved ones are kept for reuse. */
const pool: HTMLElement[] = [];

/**
 * `popover="manual"` puts the probe in the top layer, where its containing block
 * is the viewport. No ancestor's overflow, transform or containment applies to it,
 * it can anchor to any element regardless of tree order, and an ancestor
 * `transform` moves the target without moving the probe, so the change is seen.
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
    // No top layer: the probe still anchors, but ancestor clips and transforms apply.
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
