import { createProbe, raiseProbeGroup, releaseProbeGroup, retireProbe, transitionFor } from './probe.ts';
import { isSupported, missesAnchorLoss } from './support.ts';
import type { BatchMode, GeometryCallback, GeometryEntry, GeometryObserverInit, GeometryState, ObserveOptions, Track } from './types.ts';

interface Watch {
  probe: HTMLElement | null;
  /** Removes the probe's listener. Probes are pooled, so a listener left behind would keep this target and observer alive. */
  release: AbortController | null;
  /** The target's own inline `anchor-name`, to be put back exactly as found. */
  priorAnchorName: string;
  ownsAnchorName: boolean;
  /**
   * Attaching waits for a microtask, so `observe()` then `unobserve()` in the same
   * tick must not remove an `anchor-name` the page set itself.
   */
  wroteAnchorName: boolean;
  last: DOMRectReadOnly | null;
  /** Geometry as last reported to the callback. */
  key: string;
  /**
   * Geometry as of the last settle check. `key` can't serve here: it only changes
   * on delivery, so every frame after the first change would look like a new
   * change and keep restarting the settle timer.
   */
  seen: string;
}

// One set of listeners and one fallback loop, shared by every observer on the page.
const live = new Set<GeometryObserver>();
let listening = false;
let samplerTick = 0;
let mutations: MutationObserver | null = null;

function onScroll(event: Event): void {
  for (const observer of live) observer.wakeWithin(event.target);
}

function onViewportChange(): void {
  for (const observer of live) observer.wakeAll();
}

/**
 * A popover or dialog opening or closing can show or hide targets inside it, and
 * hiding a popover changes no attribute, so WebKit's mutation path can't see it.
 */
function onToggle(event: Event): void {
  if ('newState' in event && event.newState === 'open') raiseProbeGroup(event.target);
  for (const observer of live) observer.wakeWithin(event.target);
}

/** A fullscreen element joins the top layer too, but fires no `toggle`. */
function onFullscreenChange(): void {
  if (document.fullscreenElement !== null) raiseProbeGroup(document.fullscreenElement);
  for (const observer of live) observer.wakeAll();
}

/**
 * WebKit doesn't restyle a probe when its anchor is removed or hidden, so no
 * transition reports it (see `missesAnchorLoss()`). There, the DOM changes that
 * remove or hide an element wake the targets they can affect instead.
 */
function onMutations(records: MutationRecord[]): void {
  const changed = new Set<Node>();
  let removed = false;
  for (const record of records) {
    if (record.type === 'attributes') changed.add(record.target);
    else if (record.removedNodes.length > 0) removed = true;
  }
  for (const observer of live) observer.wakeAffected(changed, removed);
}

function enlist(observer: GeometryObserver): void {
  live.add(observer);
  if (!listening) {
    listening = true;
    addEventListener('scroll', onScroll, { capture: true, passive: true });
    addEventListener('resize', onViewportChange, { passive: true });
    addEventListener('toggle', onToggle, { capture: true, passive: true });
    document.addEventListener('fullscreenchange', onFullscreenChange, { passive: true });
    visualViewport?.addEventListener('resize', onViewportChange, { passive: true });
    visualViewport?.addEventListener('scroll', onViewportChange, { passive: true });
    if (missesAnchorLoss()) {
      mutations = new MutationObserver(onMutations);
      mutations.observe(document, { subtree: true, childList: true, attributes: true });
    }
  }
  // Without anchor positioning there are no events to listen to, so sample instead.
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
  removeEventListener('toggle', onToggle, { capture: true });
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  mutations?.disconnect();
  mutations = null;
  if (samplerTick !== 0) cancelAnimationFrame(samplerTick);
  samplerTick = 0;
  releaseProbeGroup();
}

/**
 * Reads the target's rect and state. The key includes the state because an
 * element that is already 0×0 keeps the same rect when it gets hidden.
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

/** Whether `element` or one of its ancestors is in `nodes`, across shadow roots. */
function hasAncestorIn(element: Element, nodes: ReadonlySet<Node>): boolean {
  for (let node: Node | null = element; node !== null; node = node instanceof ShadowRoot ? node.host : node.parentNode)
    if (nodes.has(node)) return true;
  return false;
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
 * Reports when observed elements move or change size.
 *
 * Each target gets a hidden probe element that copies its box with `anchor()` and
 * `anchor-size()`. The probe's position and size have a short transition, so when
 * layout moves the target the probe fires `transitionstart`, and the observer
 * reads the target's rect. Nothing runs while nothing moves.
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
      release: null,
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
    watch.release?.abort();
    if (watch.probe) retireProbe(watch.probe);
    if (watch.ownsAnchorName && watch.wroteAnchorName) {
      const style = inlineStyle(target);
      if (watch.priorAnchorName) style?.setProperty('anchor-name', watch.priorAnchorName);
      else style?.removeProperty('anchor-name');
    }
    this.#watches.delete(target);
    this.#dirty.delete(target);
    // Otherwise observe(), unobserve(), observe() in one tick attaches twice.
    this.#pendingObserve = this.#pendingObserve.filter((pending) => pending.target !== target);
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
   * Changes options on a live observer.
   *
   * `track` and `settle` only affect each probe's inline `transition`, so this is
   * one style write per observed element. Nothing is re-attached or re-measured.
   */
  reconfigure(init: GeometryObserverInit): void {
    if (init.batch !== undefined) this.#batch = init.batch;
    const retune = init.track !== undefined || init.settle !== undefined;
    if (init.track !== undefined) this.#track = init.track;
    if (init.settle !== undefined) this.#settle = Math.max(0, init.settle);
    if (!retune) return;

    const transition = transitionFor(this.#track, this.#settle);
    for (const watch of this.#watches.values()) watch.probe?.style.setProperty('transition', transition, 'important');

    // A change already waiting in the settle timer would otherwise wait out the old delay.
    if (this.#settle === 0 && this.#settleTimer !== undefined) {
      clearTimeout(this.#settleTimer);
      this.#settleTimer = undefined;
      this.#schedule();
    }
  }

  /** @internal A scroller moved or a popover toggled; only elements inside it can have changed. */
  wakeWithin(scroller: EventTarget | null): void {
    if (this.#watches.size === 0) return;
    const root = scroller instanceof Element ? scroller : null;
    for (const target of this.#watches.keys())
      if (root === null || root === document.scrollingElement || root.contains(target)) this.#dirty.add(target);

    if (this.#dirty.size > 0) this.#wakeScheduled();
  }

  /**
   * @internal Wakes targets that a batch of DOM mutations can have removed or
   * hidden: any target no longer connected, and any whose attributes, or an
   * ancestor's, changed.
   */
  wakeAffected(changed: ReadonlySet<Node>, removed: boolean): void {
    for (const target of this.#watches.keys())
      if ((removed && !target.isConnected) || (changed.size > 0 && hasAncestorIn(target, changed))) this.#dirty.add(target);

    if (this.#dirty.size > 0) this.#wakeScheduled();
  }

  /** @internal */
  wakeAll(): void {
    for (const target of this.#watches.keys()) this.#dirty.add(target);
    if (this.#dirty.size > 0) this.#wakeScheduled();
  }

  /**
   * Scrolls, viewport resizes and the sampling fallback have no transition behind
   * them, so `settle` needs a real timer on this path.
   *
   * The timer restarts only when something actually moved. The sampler wakes every
   * frame, so restarting on every wake would push the deadline back forever.
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
   * Whether any dirty target moved since the last check. Only `seen` is updated,
   * so the eventual entry still compares against the rect from before the burst.
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
   * Attaches every target queued this tick. All existing anchor names are read
   * before any is written, so this costs one style flush rather than one per target.
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
      if (!watch) return;
      watch.priorAnchorName = priors[index]?.inline ?? '';

      if (isSupported()) {
        let name: string;
        if (anchorName === undefined) {
          name = `--geo-probe-${++seq}`;
          const prior = priors[index]?.computed ?? '';
          // anchor-name takes a list, so keep any name the page already set.
          inlineStyle(target)?.setProperty('anchor-name', prior && prior !== 'none' ? `${prior}, ${name}` : name);
          watch.wroteAnchorName = true;
        } else {
          name = anchorName;
        }

        const probe = createProbe(name, this.#track, this.#settle);
        const release = new AbortController();
        // transition-delay has already applied `settle` by the time this fires.
        probe.addEventListener(
          'transitionstart',
          () => {
            this.#dirty.add(target);
            this.#schedule();
          },
          { signal: release.signal },
        );
        watch.probe = probe;
        watch.release = release;
      }

      this.#dirty.add(target);
    });

    this.#schedule();
  }

  #schedule(): void {
    if (this.#batch === 'sync') {
      // Layout is already clean inside a transition event, so reading now is
      // cheap and delivers a frame earlier than rAF would.
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

      // Measure the target, not the probe. A probe that lost its anchor sits at
      // its fallback position and no longer describes anything.
      const { rect, state, key } = measure(target);
      if (key === watch.key) continue;
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
      // Report a detached target once, then release its probe and anchor name.
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
