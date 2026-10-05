import { createProbe, releaseProbeGroup, retireProbe, transitionFor } from './probe.ts';
import { isSupported } from './support.ts';
import type { BatchMode, GeometryCallback, GeometryEntry, GeometryObserverInit, GeometryState, ObserveOptions, Track } from './types.ts';

interface Watch {
  probe: HTMLElement | null;
  /** The target's own inline `anchor-name`, to be put back exactly as found. */
  priorAnchorName: string;
  ownsAnchorName: boolean;
  /**
   * Whether we have actually written to the target's `anchor-name` yet. Attach is
   * deferred to a microtask, so an `observe()` followed by a synchronous
   * `unobserve()` — a fast mount/unmount, say — must leave the target as it found
   * it rather than removing a name the page set itself.
   */
  wroteAnchorName: boolean;
  last: DOMRectReadOnly | null;
  /** Geometry as last reported to the callback. What decides whether an entry is news. */
  key: string;
  /**
   * Geometry as of the last settle check — a separate baseline on purpose. Debounce
   * has to ask "did anything move since I last looked", and `key` cannot answer
   * that: it stays put until a delivery, so every frame after the first change
   * would still look like a change and restart the timer forever.
   */
  seen: string;
}

/* One set of listeners and one fallback loop for every observer on the page,
 * rather than one per instance. */
const live = new Set<GeometryObserver>();
let listening = false;
let samplerTick = 0;

function onScroll(event: Event): void {
  for (const observer of live) observer.wakeWithin(event.target);
}

function onViewportChange(): void {
  for (const observer of live) observer.wakeAll();
}

function enlist(observer: GeometryObserver): void {
  live.add(observer);
  if (!listening) {
    listening = true;
    addEventListener('scroll', onScroll, { capture: true, passive: true });
    addEventListener('resize', onViewportChange, { passive: true });
    visualViewport?.addEventListener('resize', onViewportChange, { passive: true });
    visualViewport?.addEventListener('scroll', onViewportChange, { passive: true });
  }
  // Without anchor positioning there is nothing to listen to, so this is the one
  // path that samples. One shared loop serves every observer.
  if (!isSupported() && samplerTick === 0) {
    const loop = (): void => {
      samplerTick = requestAnimationFrame(loop);
      for (const observer of live) observer.wakeAll();
    };
    samplerTick = requestAnimationFrame(loop);
  }
}

function delist(observer: GeometryObserver): void {
  live.delete(observer);
  if (live.size > 0) return;
  listening = false;
  removeEventListener('scroll', onScroll, { capture: true });
  removeEventListener('resize', onViewportChange);
  visualViewport?.removeEventListener('resize', onViewportChange);
  visualViewport?.removeEventListener('scroll', onViewportChange);
  if (samplerTick !== 0) cancelAnimationFrame(samplerTick);
  samplerTick = 0;
  releaseProbeGroup();
}

/**
 * One rect read, plus the key that decides whether it is news.
 *
 * State belongs in the key: an element already 0×0 that then gets hidden has the
 * same rect and a different meaning.
 */
function measure(target: Element): { rect: DOMRect; state: GeometryState; key: string } {
  const connected = target.isConnected;
  const rect = target.getBoundingClientRect();
  const state: GeometryState = connected
    ? rect.width > 0 || rect.height > 0 || target.getClientRects().length > 0
      ? 'rendered'
      : 'hidden'
    : 'detached';
  return { rect, state, key: `${state}|${rect.x},${rect.y},${rect.width},${rect.height}` };
}

/** `Element` carries no `style`; every element we can anchor to does. */
function hasStyle(element: Element): element is Element & ElementCSSInlineStyle {
  return 'style' in element;
}

function inlineStyle(element: Element): CSSStyleDeclaration | undefined {
  return hasStyle(element) ? element.style : undefined;
}

let seq = 0;

/**
 * Event-based position and size observation.
 *
 * `anchor()` and `anchor-size()` resolve a target's box into computed lengths on
 * a hidden probe element; those lengths are transitionable; and a running
 * transition dispatches an event. So the layout engine reports geometry changes
 * on its own, with no sampling loop and no main-thread work while nothing moves.
 *
 * ```ts
 * const observer = new GeometryObserver((entries) => {
 *   for (const { target, rect, state } of entries) position(target, rect, state);
 * });
 * observer.observe(element);
 * ```
 */
export class GeometryObserver {
  #cb: GeometryCallback;
  #batch: BatchMode;
  #track: Track;
  #settle: number;
  #settleTimer: ReturnType<typeof setTimeout> | undefined;
  #settleTick = 0;
  #watches = new Map<Element, Watch>();
  #pendingObserve: { target: Element; anchorName?: string }[] = [];
  #dirty = new Set<Element>();
  #records: GeometryEntry[] = [];
  #tick = 0;
  #delivering = false;

  constructor(callback: GeometryCallback, init: GeometryObserverInit = {}) {
    this.#cb = callback;
    this.#batch = init.batch ?? 'frame';
    this.#track = init.track ?? 'both';
    this.#settle = Math.max(0, init.settle ?? 0);
  }

  get track(): Track {
    return this.#track;
  }

  get settle(): number {
    return this.#settle;
  }

  get batch(): BatchMode {
    return this.#batch;
  }

  observe(target: Element, options: ObserveOptions = {}): void {
    if (this.#watches.has(target)) return;
    const { anchorName } = options;
    if (anchorName !== undefined && !anchorName.startsWith('--'))
      throw new TypeError(`anchorName must be a dashed ident, got "${anchorName}"`);

    // Placeholder, so a second observe() in the same tick is a no-op.
    this.#watches.set(target, {
      probe: null,
      priorAnchorName: '',
      ownsAnchorName: anchorName === undefined,
      wroteAnchorName: false,
      last: null,
      key: '',
      seen: '',
    });
    this.#pendingObserve.push({ target, anchorName });
    if (this.#pendingObserve.length === 1) queueMicrotask(() => this.#attachPending());
    enlist(this);
  }

  unobserve(target: Element): void {
    const watch = this.#watches.get(target);
    if (!watch) return;
    if (watch.probe) retireProbe(watch.probe);
    if (watch.ownsAnchorName && watch.wroteAnchorName) {
      const style = inlineStyle(target);
      if (watch.priorAnchorName) style?.setProperty('anchor-name', watch.priorAnchorName);
      else style?.removeProperty('anchor-name');
    }
    this.#watches.delete(target);
    this.#dirty.delete(target);
    if (this.#watches.size === 0) delist(this);
  }

  disconnect(): void {
    for (const target of this.#watches.keys()) this.unobserve(target);
    this.#pendingObserve.length = 0;
    this.#records.length = 0;
    if (this.#tick !== 0) cancelAnimationFrame(this.#tick);
    this.#tick = 0;
    if (this.#settleTick !== 0) cancelAnimationFrame(this.#settleTick);
    this.#settleTick = 0;
    clearTimeout(this.#settleTimer);
    this.#settleTimer = undefined;
    delist(this);
  }

  /** Pending entries, cleared. Mirrors `ResizeObserver.takeRecords()`. */
  takeRecords(): GeometryEntry[] {
    this.#collect();
    return this.#records.splice(0);
  }

  /**
   * Change what counts as a change, without tearing anything down.
   *
   * `track` and `settle` live entirely in one inline `transition` declaration per
   * probe, so switching them is a style write per observed element: no probe is
   * rebuilt, no `anchor-name` is touched, no target is re-measured, and targets
   * queued by `observe()` but not yet attached pick the new values up on their own.
   */
  reconfigure(init: GeometryObserverInit): void {
    if (init.batch !== undefined) this.#batch = init.batch;
    const retune = init.track !== undefined || init.settle !== undefined;
    if (init.track !== undefined) this.#track = init.track;
    if (init.settle !== undefined) this.#settle = Math.max(0, init.settle);
    if (!retune) return;

    const transition = transitionFor(this.#track, this.#settle);
    for (const watch of this.#watches.values()) watch.probe?.style.setProperty('transition', transition, 'important');

    // Dropping the delay while a wake was still waiting it out would otherwise
    // leave that change stranded in the timer for the old duration.
    if (this.#settle === 0 && this.#settleTimer !== undefined) {
      clearTimeout(this.#settleTimer);
      this.#settleTimer = undefined;
      this.#schedule();
    }
  }

  /** @internal A scroller moved; only elements inside it can have shifted. */
  wakeWithin(scroller: EventTarget | null): void {
    if (this.#watches.size === 0) return;
    const root = scroller instanceof Element ? scroller : null;
    for (const target of this.#watches.keys())
      if (root === null || root === document.scrollingElement || root.contains(target)) this.#dirty.add(target);

    if (this.#dirty.size > 0) this.#wakeScheduled();
  }

  /** @internal */
  wakeAll(): void {
    for (const target of this.#watches.keys()) this.#dirty.add(target);
    if (this.#dirty.size > 0) this.#wakeScheduled();
  }

  /**
   * Scrolling, viewport resizes and the sampling fallback arrive as plain events
   * with no transition behind them, so there is no CSS delay to lean on. Honour
   * `settle` here with an actual timer, otherwise the same observer would debounce
   * layout changes and fire immediately on scroll.
   *
   * The timer restarts on a real change, never on a bare wake. The sampler wakes
   * every frame whether or not anything moved, so restarting per wake would keep
   * pushing the deadline out of reach and the observer would go silent for good.
   * Checking is read-only, so the delivery that eventually lands still measures
   * against the geometry from before the churn started and reports it as one entry.
   */
  #wakeScheduled(): void {
    if (this.#settle === 0) {
      this.#schedule();
      return;
    }
    if (this.#settleTick !== 0) return;
    this.#settleTick = requestAnimationFrame(() => {
      this.#settleTick = 0;
      if (!this.#changed()) return;
      clearTimeout(this.#settleTimer);
      this.#settleTimer = setTimeout(() => {
        this.#settleTimer = undefined;
        this.#collect();
        this.#deliver();
      }, this.#settle);
    });
  }

  /**
   * Whether anything dirty moved since the last check. Records nothing itself, so
   * the delivery this eventually allows still measures against the geometry from
   * before the churn and reports the whole burst as one entry.
   */
  #changed(): boolean {
    let moved = false;
    for (const target of this.#dirty) {
      const watch = this.#watches.get(target);
      if (watch === undefined) continue;
      const { key } = measure(target);
      if (key === watch.seen) continue;
      watch.seen = key;
      moved = true; // keep going: every watch needs its baseline refreshed
    }
    return moved;
  }

  /**
   * Attach every target queued this tick. Reading all the prior anchor names
   * before writing any keeps this to a single style flush instead of one per
   * target, which matters when a page observes a few hundred elements at once.
   */
  #attachPending(): void {
    const pending = this.#pendingObserve.splice(0);
    if (pending.length === 0) return;

    const priors = pending.map(({ target, anchorName }) =>
      anchorName !== undefined || !isSupported()
        ? { inline: '', computed: '' }
        : {
            inline: inlineStyle(target)?.getPropertyValue('anchor-name') ?? '',
            computed: getComputedStyle(target).getPropertyValue('anchor-name').trim(),
          },
    );

    pending.forEach(({ target, anchorName }, index) => {
      const watch = this.#watches.get(target);
      if (!watch) return; // unobserved before we got here
      watch.priorAnchorName = priors[index]?.inline ?? '';

      if (isSupported()) {
        let name: string;
        if (anchorName === undefined) {
          name = `--geo-probe-${++seq}`;
          const prior = priors[index]?.computed ?? '';
          // anchor-name is a list — never clobber a name the page already set.
          inlineStyle(target)?.setProperty('anchor-name', prior && prior !== 'none' ? `${prior}, ${name}` : name);
          watch.wroteAnchorName = true;
        } else {
          name = anchorName; // the page owns it; touch nothing
        }

        const probe = createProbe(name, this.#track, this.#settle);
        // The CSS delay has already done the waiting by the time this fires, so
        // deliver straight away rather than waiting again in JS.
        probe.addEventListener('transitionstart', () => {
          this.#dirty.add(target);
          this.#schedule();
        });
        watch.probe = probe;
      }

      this.#dirty.add(target);
    });

    this.#schedule();
  }

  #schedule(): void {
    if (this.#batch === 'sync') {
      // Layout is already clean inside a transition event, so reading now is free
      // and lands the callback a frame earlier than rAF would.
      this.#collect();
      this.#deliver();
      return;
    }
    if (this.#tick !== 0) return;
    this.#tick = requestAnimationFrame(() => {
      this.#tick = 0;
      this.#collect();
      this.#deliver();
    });
  }

  #collect(): void {
    if (this.#dirty.size === 0) return;
    for (const target of this.#dirty) {
      const watch = this.#watches.get(target);
      if (!watch) continue;

      // Always measure the target, never the probe. The probe exists to raise the
      // event; its rect is only a mirror, and once its anchor is gone the probe is
      // parked on its fallback and describes nothing. The target's own
      // getBoundingClientRect() is the scroll- and transform-adjusted truth in
      // every state, and honestly reports zeroes in the states below.
      const { rect, state, key } = measure(target);
      if (key === watch.key) continue; // woken by a scroll with nothing to say
      const previousRect = watch.last;
      watch.key = key;
      watch.seen = key;
      watch.last = rect;
      this.#records.push({
        target,
        rect,
        previousRect,
        moved: previousRect === null || previousRect.x !== rect.x || previousRect.y !== rect.y,
        resized: previousRect === null || previousRect.width !== rect.width || previousRect.height !== rect.height,
        state,
      });
      // Nothing more can happen to a detached target, so report it once and let go
      // — otherwise its probe and anchor name leak for the page's lifetime.
      if (state === 'detached') this.unobserve(target);
    }
    this.#dirty.clear();
  }

  #deliver(): void {
    if (this.#records.length === 0 || this.#delivering) return;
    const entries = this.#records.splice(0);
    this.#delivering = true;
    try {
      this.#cb(entries, this);
    } finally {
      this.#delivering = false;
    }
  }
}
