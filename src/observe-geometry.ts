import { GeometryObserver } from './observer.ts';
import type { GeometryCallback, GeometryObserverInit, ObserveOptions } from './types.ts';

/**
 * Observe one element and get back a function that stops observing it.
 *
 * The ergonomic form for the common case — a single target whose lifetime matches
 * some effect or component. For many targets, or to change configuration later,
 * use {@link GeometryObserver} directly.
 *
 * ```ts
 * const stop = observeGeometry(tooltipTarget, ([entry]) => place(entry.rect));
 * // later
 * stop();
 * ```
 */
export function observeGeometry(target: Element, callback: GeometryCallback, init: GeometryObserverInit & ObserveOptions = {}): () => void {
  const { anchorName, ...observerInit } = init;
  const observer = new GeometryObserver(callback, observerInit);
  observer.observe(target, { anchorName });
  return () => observer.disconnect();
}
