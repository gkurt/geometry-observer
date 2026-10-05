/** Marks the group element in the DOM, so it is identifiable in devtools and in tests. */
export const PROBE_GROUP_ATTRIBUTE = 'data-geometry-probes';

/** Where a probe's corner goes when it loses its anchor. Any length works, see {@link PROBE_STYLE}. */
const LOST = '-99999px';

/** How far past the viewport a probe reaches. Far enough that a target a long way off-screen still changes its size. */
const FAR = '-1000000px';

/**
 * A probe stretches from its target's top-left corner to far past the viewport's
 * bottom-right, so its size encodes the target's position: when layout moves the
 * target, the probe resizes, and a `ResizeObserver` on it reports the move in the
 * same frame. There's no transition, and no event to wait for.
 *
 * The fallbacks in `anchor()` make teardown observable: a lost anchor puts the
 * corner at the fallback, which resizes the probe too.
 *
 * Every declaration is set inline with `!important`, so page styles can't move,
 * hide or resize a probe. The probe has no content, and `contain: strict` keeps its
 * layout self-contained.
 */
export const PROBE_STYLE: Readonly<Record<string, string>> = {
  position: 'fixed',
  margin: '0',
  border: '0',
  padding: '0',
  background: 'none',
  visibility: 'hidden',
  'pointer-events': 'none',
  contain: 'strict',
  top: `anchor(top, ${LOST})`,
  left: `anchor(left, ${LOST})`,
  bottom: FAR,
  right: FAR,
};

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

let raised = 0;

/**
 * An anchor inside a top-layer element shown after the group can't be resolved,
 * so whenever something else enters the top layer (a popover, a dialog or a
 * fullscreen element), the group goes back on top.
 *
 * WebKit keeps a probe's lost anchor until the probe is restyled, so a custom
 * property on the group, which every probe inherits, makes it look again.
 */
export function raiseProbeGroup(opened: EventTarget | null): void {
  if (group === null || opened === group || !group.isConnected) return;
  try {
    group.hidePopover();
    group.showPopover();
  } catch {
    // No top layer, so no order to restore.
  }
  group.style.setProperty('--geometry-observer-raised', String(++raised));
}

export function releaseProbeGroup(): void {
  if (group !== null && group.childElementCount === 0) {
    group.remove();
    group = null;
  }
}

/** Probes are interchangeable, so unobserved ones are kept for reuse. */
const pool: HTMLElement[] = [];

export function createProbe(anchorName: string): HTMLElement {
  const probe = pool.pop() ?? document.createElement('div');
  const { style } = probe;
  for (const [property, value] of Object.entries(PROBE_STYLE)) style.setProperty(property, value, 'important');
  style.setProperty('position-anchor', anchorName, 'important');
  probeGroup().append(probe);
  return probe;
}

export function retireProbe(probe: HTMLElement): void {
  probe.remove();
  probe.style.cssText = '';
  if (pool.length < 64) pool.push(probe);
}
