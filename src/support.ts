let cached: boolean | undefined;

/** Distinctive enough that a fallback or a collapsed box cannot be mistaken for it. */
const WITNESS = 17;
const WITNESS_ANCHOR = '--geometry-observer-support-witness';

/**
 * Whether anchor positioning actually resolves, rather than merely parsing.
 *
 * Firefox 155 accepts every declaration the mechanism needs — `CSS.supports()`
 * returns true for `anchor-name`, `anchor()`, `anchor-size()` and
 * `position-anchor`, and `position-anchor` even computes to the right name — but
 * never resolves the reference during layout, so every probe silently sits at its
 * fallback and no transition ever runs. A feature sniff cannot see that; only
 * laying a probe out can.
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

  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;margin:0;border:0;padding:0';
  probe.style.setProperty('position-anchor', WITNESS_ANCHOR);
  probe.style.setProperty('width', 'anchor-size(width, 0px)');

  mount.append(target, probe);
  const width = probe.getBoundingClientRect().width;
  target.remove();
  probe.remove();

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
