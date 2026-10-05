import { useCallback, useEffect, useRef } from 'react';
import { GeometryObserver } from './observer.ts';
import type { GeometryCallback, GeometryObserverInit, ObserveOptions } from './types.ts';

export interface UseGeometryObserverOptions extends GeometryObserverInit, ObserveOptions {}

/**
 * Observes the element the returned ref is attached to, for as long as it's mounted.
 *
 * ```tsx
 * const ref = useGeometryObserver(([entry]) => {
 *   overlay.current?.style.setProperty('translate', `${entry.rect.x}px ${entry.rect.y}px`);
 * });
 *
 * return <div ref={ref} />;
 * ```
 *
 * The returned ref callback keeps its identity across renders, and always calls
 * the latest `callback`, so an inline function is fine. Changing `track`,
 * `settle` or `batch` updates the existing observer through
 * {@link GeometryObserver.reconfigure}. A new element or `anchorName`
 * re-subscribes. Requires React 19, which runs the cleanup a ref callback returns.
 *
 * To combine it with a ref of your own, return its cleanup and memoise the result.
 * React calls a new ref callback on every render, so an inline one re-subscribes
 * every time:
 *
 * ```tsx
 * const geometry = useGeometryObserver(onGeometry);
 * const ref = useCallback((node: HTMLDivElement | null) => {
 *   mine.current = node;
 *   return geometry(node);
 * }, [geometry]);
 * ```
 */
export function useGeometryObserver(
  callback: GeometryCallback,
  options: UseGeometryObserverOptions = {},
): (node: Element | null) => (() => void) | undefined {
  const { batch, track, settle, anchorName } = options;

  // Refs rather than dependencies, so an inline callback or options object doesn't
  // re-subscribe. Written during render so an entry delivered before effects run
  // still reaches this render's callback.
  const latest = useRef(callback);
  latest.current = callback;
  const current = useRef<UseGeometryObserverOptions>({ batch, track, settle, anchorName });
  current.current = { batch, track, settle, anchorName };

  // The options the live observer currently has, so the effects below can tell a
  // real change from a re-render.
  const applied = useRef<UseGeometryObserverOptions>(current.current);
  const observer = useRef<GeometryObserver | null>(null);
  const node = useRef<Element | null>(null);

  const attach = useCallback((element: Element | null) => {
    if (element === null) {
      // React only passes null when the ref returned no cleanup, which happens
      // when a combined ref doesn't forward ours.
      observer.current?.disconnect();
      observer.current = null;
      node.current = null;
      return undefined;
    }
    const options = current.current;
    const live = new GeometryObserver((entries, self) => latest.current(entries, self), options);
    observer.current = live;
    node.current = element;
    applied.current = options;
    live.observe(element, { anchorName: options.anchorName });

    return () => {
      live.disconnect();
      if (observer.current === live) observer.current = null;
      if (node.current === element) node.current = null;
    };
  }, []);

  useEffect(() => {
    const previous = applied.current;
    if (previous.batch === batch && previous.track === track && previous.settle === settle) return;
    applied.current = { ...previous, batch, track, settle };
    observer.current?.reconfigure({ batch, track, settle });
  }, [batch, track, settle]);

  useEffect(() => {
    if (applied.current.anchorName === anchorName) return;
    applied.current = { ...applied.current, anchorName };
    const live = observer.current;
    if (live === null || node.current === null) return;
    live.unobserve(node.current);
    live.observe(node.current, { anchorName });
  }, [anchorName]);

  return attach;
}
