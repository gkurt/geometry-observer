import { GeometryObserver } from './observer.ts';
import type { GeometryCallback, GeometryObserverInit, ObserveOptions } from './types.ts';

/**
 * Observes one element and returns a function that stops observing it. For
 * several targets, or to change options later, use {@link GeometryObserver}.
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
