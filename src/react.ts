import { useCallback, useEffect, useRef, useState } from 'react';
import { GeometryObserver } from './observer.ts';
import type { GeometryCallback, GeometryObserverInit, ObserveOptions } from './types.ts';

export interface UseGeometryObserverOptions extends GeometryObserverInit, ObserveOptions {}

/**
 * Observe one element's geometry for the life of the component.
 *
 * ```tsx
 * const ref = useGeometryObserver<HTMLDivElement>(([entry]) => {
 *   overlay.current?.style.setProperty('translate', `${entry.rect.x}px ${entry.rect.y}px`);
 * });
 *
 * return <div ref={ref} />;
 * ```
 *
 * The returned ref callback is stable for the life of the component, so React
 * never detaches and reattaches it across re-renders. Pass whatever you like
 * inline: the callback is read through a ref, so a fresh arrow function every
 * render costs nothing and never re-subscribes.
 *
 * Changing `track`, `settle` or `batch` retunes the existing observer — a style
 * write per observed element rather than a teardown, see
 * {@link GeometryObserver.reconfigure}. Only a new element or a new `anchorName`
 * rebuilds anything, because those decide what the probe binds to.
 *
 * To share the element with another ref, call both:
 * `ref={(node) => { mine.current = node; geometry(node); }}`.
 */
export function useGeometryObserver<T extends Element = Element>(
  callback: GeometryCallback,
  options: UseGeometryObserverOptions = {},
): (node: T | null) => void {
  const { batch, track, settle, anchorName } = options;

  // A ref, not a dependency: the whole point is that an inline callback does not
  // re-subscribe. Written during render so an entry arriving before effects run
  // still reaches the callback this render passed in.
  const latest = useRef(callback);
  latest.current = callback;

  // Subscribing from an effect rather than from the ref callback keeps this
  // correct under StrictMode, where React 18 re-runs effects without reattaching
  // refs — a ref-callback subscription would be torn down and never rebuilt.
  const [element, setElement] = useState<T | null>(null);
  const attach = useCallback((node: T | null) => setElement(node), []);

  const observer = useRef<GeometryObserver | null>(null);
  const applied = useRef<GeometryObserverInit>({ batch, track, settle });

  useEffect(() => {
    if (element === null) return;
    const live = new GeometryObserver((entries, self) => latest.current(entries, self), applied.current);
    observer.current = live;
    live.observe(element, { anchorName });
    return () => {
      live.disconnect();
      if (observer.current === live) observer.current = null;
    };
  }, [element, anchorName]);

  useEffect(() => {
    const previous = applied.current;
    if (previous.batch === batch && previous.track === track && previous.settle === settle) return;
    applied.current = { batch, track, settle };
    observer.current?.reconfigure({ batch, track, settle });
  }, [batch, track, settle]);

  return attach;
}
