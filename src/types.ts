import type { GeometryObserver } from './observer.ts';

/** When the callback runs. */
export type BatchMode =
  /** One batched callback per animation frame, like `ResizeObserver`. The default. */
  | 'frame'
  /** Inside the transition event. A frame earlier, but possibly several calls per frame. */
  | 'sync';

/** Which geometry changes trigger a callback. Tracking fewer properties makes the probe cheaper. */
export type Track = 'both' | 'position' | 'size';

/**
 * An element sized 0×0, one hidden with `display: none` and one removed from the
 * document all have the same rect. `state` tells them apart.
 */
export type GeometryState =
  /** In the document and generating boxes. The rect means what it says. */
  | 'rendered'
  /** In the document but generating no boxes, e.g. `display: none`. The rect is all zeroes. */
  | 'hidden'
  /** Removed from the document. Reported once, after which the target is unobserved. */
  | 'detached';

export interface GeometryObserverInit {
  /** When the callback runs. Default `'frame'`. */
  batch?: BatchMode;
  /**
   * Which changes trigger a callback. `'position'` or `'size'` transitions two
   * properties instead of four, which roughly halves the probe's cost. Entries
   * still carry the full, current rect. Default `'both'`.
   */
  track?: Track;
  /**
   * Report only after the geometry has been still for this many milliseconds.
   *
   * Implemented as the probe's `transition-delay`: each change restarts the
   * delay, so no JavaScript runs until the target stops moving. Scrolls and the
   * sampling fallback use a timer instead.
   *
   * Only the trailing edge is reported, so a target that never stops moving never
   * reports. Default `0`.
   */
  settle?: number;
}

export interface ObserveOptions {
  /**
   * An anchor name the target already has (a dashed ident such as `--card`). When
   * given, the observer uses it instead of adding its own to the target's
   * inline `anchor-name`, and never writes to the target's style.
   */
  anchorName?: string;
}

export interface GeometryEntry {
  readonly target: Element;
  /** The target's live viewport rect: scroll- and transform-adjusted, zeroed when not rendered. */
  readonly rect: DOMRectReadOnly;
  /** The rect from the previous entry for this target, or `null` for the first one. */
  readonly previousRect: DOMRectReadOnly | null;
  /** Whether `x` or `y` differs from `previousRect`. `true` on the first entry. */
  readonly moved: boolean;
  /** Whether `width` or `height` differs from `previousRect`. `true` on the first entry. */
  readonly resized: boolean;
  readonly state: GeometryState;
}

export type GeometryCallback = (entries: GeometryEntry[], observer: GeometryObserver) => void;
