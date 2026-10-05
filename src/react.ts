import { useCallback, useEffect, useRef } from 'react';
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
 * never detaches and reattaches it across re-renders, and it subscribes from the
 * ref itself rather than from an effect: the observer is attached the moment the
 * element exists and released by the ref's own cleanup (React 19).
 *
 * Pass whatever you like inline. The callback is read through a ref, so a fresh
 * arrow function every render costs nothing and never re-subscribes. Changing
 * `track`, `settle` or `batch` retunes the live observer, a style write per
 * observed element rather than a teardown, see
 * {@link GeometryObserver.reconfigure}. Only a new element or a new `anchorName`
 * rebuilds anything, because those decide what the probe binds to.
 *
 * To share the element with a ref of your own, call both and forward the cleanup:
 * `ref={(node) => { mine.current = node; return geometry(node); }}`. Dropping the
 * `return` still works, it just releases a beat later, through React's older
 * null-on-detach path.
 */
export function useGeometryObserver<T extends Element = Element>(
  callback: GeometryCallback,
  options: UseGeometryObserverOptions = {},
): (node: T | null) => (() => void) | undefined {
  const { batch, track, settle, anchorName } = options;

  // Refs, not dependencies: the whole point is that an inline callback and an
  // inline options object do not re-subscribe. Written during render so an entry
  // arriving before effects run still reaches what this render passed in.
  const latest = useRef(callback);
  latest.current = callback;
  const current = useRef<UseGeometryObserverOptions>({ batch, track, settle, anchorName });
  current.current = { batch, track, settle, anchorName };

  // What the live observer was actually built or retuned with, so the effects
  // below can tell a real change from a re-render.
  const applied = useRef<UseGeometryObserverOptions>(current.current);
  const observer = useRef<GeometryObserver | null>(null);
  const node = useRef<T | null>(null);

  const attach = useCallback((element: T | null) => {
    if (element === null) {
      // React 19 releases through the cleanup below and never passes null. A
      // caller composing refs by hand can still forget to forward that cleanup,
      // which puts React back on the classic convention, so honour it too rather
      // than leaking the observer.
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
