import { PROBE_STYLE } from './probe.ts';

let cached: boolean | undefined;

/** Distinctive enough that a fallback or a collapsed box cannot be mistaken for it. */
const WITNESS = 17;
const WITNESS_ANCHOR = '--geometry-observer-support-witness';

/**
 * Whether anchor positioning resolves for the probe this library actually builds.
 *
 * Parsing is not the question. Firefox 155 accepts every declaration involved —
 * `CSS.supports()` is true for `anchor-name`, `anchor()`, `anchor-size()` and
 * `position-anchor`, and `position-anchor` computes to the right name — yet the
 * mechanism produces nothing there, for two separate reasons: `content-visibility:
 * hidden` stops the anchor resolving at all, and even without it, anchor-driven
 * geometry changes never start a transition. So the witness is the real probe,
 * `content-visibility` and top layer included, rather than a simplified stand-in
 * that would report support the mechanism does not have.
 *
 * One forced layout, once per page, behind the cheap parse check below.
 */
function anchorsResolve(): boolean {
  // Typed non-null, but genuinely absent if the library is first used from <head>.
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
    // No top layer here is itself worth knowing; the measurement below still answers.
  }

  const width = probe.getBoundingClientRect().width;
  target.remove();
  group.remove();

  return Math.round(width) === WITNESS;
}

/**
 * Whether this engine can run the mechanism natively.
 *
 * It needs CSS anchor positioning, which shipped in Chromium 125 and Safari 26.
 * Where it is missing — or present in name only, see {@link anchorsResolve} —
 * {@link GeometryObserver} keeps the same API and falls back to a single shared
 * sampling loop, so calling code does not have to branch.
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
