import type { GeometryObserver } from './observer.ts';

/** When the callback runs. */
export type BatchMode =
  /** One batched callback per animation frame, like `ResizeObserver`. The default. */
  | 'frame'
  /** Inside the transition event itself — a frame earlier, at the cost of possibly several calls per frame. */
  | 'sync';

/** Which geometry changes raise an event. Fewer tracked properties means a cheaper probe. */
export type Track = 'both' | 'position' | 'size';

/**
 * Why a zero rect is not enough: an element collapsed to 0×0 by its own content,
 * one hidden with `display: none`, and one detached from the document all measure
 * the same and mean completely different things to a caller deciding whether to
 * keep an overlay alive. `ResizeObserver` reports all three identically.
 */
export type GeometryState =
  /** In the document and generating boxes. The rect means what it says. */
  | 'rendered'
  /** Still in the document but generating no boxes. The rect is zeroed and carries no information. */
  | 'hidden'
  /** No longer in the document. Reported once, then the target is released. */
  | 'detached';

export interface GeometryObserverInit {
  /** When the callback runs. Default `'frame'`. */
  batch?: BatchMode;
  /**
   * Narrow what counts as a change. Transitioning two properties instead of four
   * roughly halves the probe's cost. Narrowing stops an axis *raising* events; it
   * does not make it stale, since entries always carry the full rect. Default `'both'`.
   */
  track?: Track;
  /**
   * Report only once the geometry has been still for this many milliseconds.
   *
   * This is `transition-delay`, not a timer. Each new change cancels the pending
   * transition and restarts its delay, so during churn **no event reaches the main
   * thread at all** — something a JS debounce cannot do, because it has to run on
   * every frame to reset its own timer.
   *
   * Trailing edge only, with the sharp edge that implies: a target that never stops
   * moving never reports. Default `0`.
   */
  settle?: number;
}

export interface ObserveOptions {
  /**
   * Reuse an anchor name the page already declares, instead of minting one. The
   * target's own `anchor-name` is then left completely untouched — nothing is
   * written to its style attribute and nothing has to be restored on unobserve.
   */
  anchorName?: string;
}

export interface GeometryEntry {
  readonly target: Element;
  /** The target's live viewport rect: scroll- and transform-adjusted, zeroed when not rendered. */
  readonly rect: DOMRectReadOnly;
  /** The rect from the previous entry for this target, or `null` for the first one. */
  readonly previousRect: DOMRectReadOnly | null;
  readonly moved: boolean;
  readonly resized: boolean;
  readonly state: GeometryState;
}

export type GeometryCallback = (entries: GeometryEntry[], observer: GeometryObserver) => void;
