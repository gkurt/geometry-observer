let cached: boolean | undefined;

/**
 * Whether this engine can run the mechanism natively.
 *
 * It needs CSS anchor positioning, which shipped in Chromium 125. Where it is
 * missing, {@link GeometryObserver} keeps the same API and falls back to a single
 * shared sampling loop, so calling code does not have to branch.
 */
export function isSupported(): boolean {
  cached ??=
    typeof CSS !== 'undefined' &&
    CSS.supports('anchor-name', '--x') &&
    CSS.supports('top', 'anchor(top)') &&
    CSS.supports('width', 'anchor-size(width)');
  return cached;
}
