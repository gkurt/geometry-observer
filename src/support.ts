import { GROUP_STYLE, PROBE_STYLE } from './probe.ts';

interface Measurement {
  /** The probe follows its anchor. */
  tracks: boolean;
  /** The probe falls back once its anchor is removed, with no other style change. */
  seesLoss: boolean;
}

let cached: Measurement | undefined;

/** Distinctive enough that a fallback or a collapsed box cannot be mistaken for it. */
const WITNESS = 17;
const WITNESS_ANCHOR = '--geometry-observer-support-witness';

function setImportant(element: HTMLElement, declarations: Readonly<Record<string, string>>): void {
  for (const [property, value] of Object.entries(declarations)) element.style.setProperty(property, value, 'important');
}

/**
 * Measures a real probe, built the way the library builds one.
 *
 * Parsing support isn't enough. Firefox 155 accepts every declaration involved,
 * but `content-visibility: hidden` stops the anchor from resolving, and without it
 * anchor-driven changes still never start a transition.
 *
 * WebKit (Safari 26 and 27) tracks the anchor but doesn't restyle the probe when
 * the anchor is removed or hidden: the probe keeps its last anchored box and no
 * transition runs, until something else restyles it.
 *
 * Costs two forced layouts, once per page.
 */
function measure(): Measurement {
  // `body` is typed non-null but is missing when this runs from a script in <head>.
  const mount: HTMLElement | null = document.body ?? document.documentElement;
  if (mount === null) return { tracks: false, seesLoss: false };

  const target = document.createElement('div');
  target.style.cssText = `position:absolute;top:0;left:0;width:${WITNESS}px;height:0`;
  target.style.setProperty('anchor-name', WITNESS_ANCHOR);

  const group = document.createElement('div');
  group.setAttribute('popover', 'manual');
  setImportant(group, GROUP_STYLE);

  const probe = document.createElement('div');
  setImportant(probe, PROBE_STYLE);
  probe.style.setProperty('position-anchor', WITNESS_ANCHOR, 'important');
  group.append(probe);

  mount.append(target, group);
  try {
    group.showPopover();
  } catch {
    // No top layer. The measurement below still gives the answer.
  }

  const tracks = Math.round(probe.getBoundingClientRect().width) === WITNESS;
  target.remove();
  const seesLoss = probe.getBoundingClientRect().width === 0;
  group.remove();

  return { tracks, seesLoss };
}

function measurement(): Measurement | undefined {
  if (typeof CSS === 'undefined' || typeof document === 'undefined') return undefined;
  cached ??=
    CSS.supports('anchor-name', '--x') && CSS.supports('top', 'anchor(top)') && CSS.supports('width', 'anchor-size(width)')
      ? measure()
      : { tracks: false, seesLoss: false };
  return cached;
}

/**
 * Whether this browser can run the anchor-positioning mechanism (Chromium 125+,
 * Safari 26+). Where it can't, {@link GeometryObserver} falls back to one shared
 * `requestAnimationFrame` loop with the same API, so callers don't need to branch.
 */
export function isSupported(): boolean {
  return measurement()?.tracks ?? false;
}

/**
 * @internal Whether probes need help to notice a target being removed or hidden.
 * True in WebKit, where the observer watches DOM mutations instead.
 */
export function missesAnchorLoss(): boolean {
  const measured = measurement();
  return measured !== undefined && measured.tracks && !measured.seesLoss;
}
