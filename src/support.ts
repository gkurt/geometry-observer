import { PROBE_STYLE } from './probe.ts';

let cached: boolean | undefined;

/** Distinctive enough that a fallback or a collapsed box cannot be mistaken for it. */
const WITNESS = 17;
const WITNESS_ANCHOR = '--geometry-observer-support-witness';

/**
 * Whether the probe this library builds actually tracks its anchor.
 *
 * Parsing support isn't enough. Firefox 155 accepts every declaration involved,
 * but `content-visibility: hidden` stops the anchor from resolving, and without it
 * anchor-driven changes still never start a transition. So this measures a real
 * probe, top layer and `content-visibility` included.
 *
 * Costs one forced layout, once per page.
 */
function anchorsResolve(): boolean {
  // `body` is typed non-null but is missing when this runs from a script in <head>.
  const mount: HTMLElement | null = document.body ?? document.documentElement;
  if (mount === null) return false;

  const target = document.createElement('div');
  target.style.cssText = `position:absolute;top:0;left:0;width:${WITNESS}px;height:0`;
  target.style.setProperty('anchor-name', WITNESS_ANCHOR);

  const group = document.createElement('div');
  group.style.setProperty('display', 'contents', 'important');

  const probe = document.createElement('div');
  probe.setAttribute('popover', 'manual');
  for (const [property, value] of Object.entries(PROBE_STYLE)) probe.style.setProperty(property, value, 'important');
  probe.style.setProperty('position-anchor', WITNESS_ANCHOR, 'important');
  group.append(probe);

  mount.append(target, group);
  try {
    probe.showPopover();
  } catch {
    // No top layer. The measurement below still gives the answer.
  }

  const width = probe.getBoundingClientRect().width;
  target.remove();
  group.remove();

  return Math.round(width) === WITNESS;
}

/**
 * Whether this browser can run the anchor-positioning mechanism (Chromium 125+,
 * Safari 26+). Where it can't, {@link GeometryObserver} falls back to one shared
 * `requestAnimationFrame` loop with the same API, so callers don't need to branch.
 */
export function isSupported(): boolean {
  if (typeof CSS === 'undefined' || typeof document === 'undefined') return false;
  cached ??=
    CSS.supports('anchor-name', '--x') &&
    CSS.supports('top', 'anchor(top)') &&
    CSS.supports('width', 'anchor-size(width)') &&
    anchorsResolve();
  return cached;
}
