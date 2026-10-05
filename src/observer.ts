import { createProbe, raiseProbeGroup, releaseProbeGroup, retireProbe } from './probe.ts';
import { isSupported, missesAnchorLoss } from './support.ts';
import type { BatchMode, GeometryCallback, GeometryEntry, GeometryObserverInit, GeometryState, ObserveOptions, Track } from './types.ts';

interface Watch {
  /** Only while position is tracked: `track: 'size'` needs no probe. */
  probe: HTMLElement | null;
  /** The anchor name the probe follows, or `''` before attaching and where anchors aren't supported. */
  anchor: string;
  /** Whether the target's own size is being observed. */
  sized: boolean;
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

/**
 * A fullscreen element joins the top layer too, but fires no `toggle`. WebKit on
 * Linux can fire the event before the element is in the top layer, so the group
 * is raised again on the next frame.
 */
function onFullscreenChange(): void {
  const raise = (): void => {
    if (document.fullscreenElement !== null) raiseProbeGroup(document.fullscreenElement);
    for (const observer of live) observer.wakeAll();
  };
  raise();
  requestAnimationFrame(raise);
}

/**
 * WebKit doesn't restyle a probe when its anchor is removed or hidden, so the
 * probe doesn't resize (see `missesAnchorLoss()`). A target that has a size still
 * shrinks to 0×0, which its own `ResizeObserver` sees, but a 0×0 target, or one
 * tracked with `track: 'position'`, doesn't. There, the DOM changes that remove
 * or hide an element wake the targets they can affect instead.
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
 * Each target gets a hidden probe that stretches from the target's top-left
 * corner, with `anchor()`, to far past the viewport. When layout moves the target
 * the probe resizes, and a `ResizeObserver` on it reports the move in the same
 * frame. The same `ResizeObserver` watches the target's own size, and one scroll
 * listener covers scrolling. Nothing runs while nothing moves.
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
  #resize: ResizeObserver | null = null;
  /** Probe to target, for the shared `ResizeObserver`. */
  #owners = new Map<Element, Element>();

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
      anchor: '',
      sized: false,
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
    this.#dropProbe(watch);
    if (watch.sized) this.#resize?.unobserve(target);
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
    this.#resize?.disconnect();
    this.#resize = null;
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
   * Nothing is re-attached. A new `track` adds or removes probes and changes what
   * the `ResizeObserver` watches; `settle` and `batch` only change when entries go out.
   */
  reconfigure(init: GeometryObserverInit): void {
    if (init.batch !== undefined) this.#batch = init.batch;
    if (init.settle !== undefined) this.#settle = Math.max(0, init.settle);
    if (init.track !== undefined && init.track !== this.#track) {
      this.#track = init.track;
      for (const [target, watch] of this.#watches) this.#applyTrack(target, watch);
    }

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
   * Scrolls, viewport resizes, toggles and the sampling fallback wake targets that
   * may not have changed, so with `settle` the timer restarts only when something
   * actually moved. The sampler wakes every frame, so restarting on every wake
   * would push the deadline back forever.
   */
  #wakeScheduled(): void {
    if (this.#settle === 0) {
      this.#schedule();
      return;
    }
    if (this.#settleTick !== 0) return;
    this.#settleTick = requestAnimationFrame(() => {
      this.#settleTick = 0;
      if (this.#changed()) this.#settleThenDeliver();
    });
  }

  /** Each call restarts the wait, so entries go out once nothing has changed for `settle` ms. */
  #settleThenDeliver(): void {
    clearTimeout(this.#settleTimer);
    this.#settleTimer = setTimeout(() => {
      this.#settleTimer = undefined;
      this.#collect();
      this.#deliver();
    }, this.#settle);
  }

  /**
   * A `ResizeObserver` entry is a real change, to a probe or a target. Layout is
   * already clean inside its callback, so reading rects here is cheap, and the
   * entries go out in the same frame as the change.
   */
  #onResize(entries: ResizeObserverEntry[]): void {
    for (const entry of entries) {
      const target = this.#owners.get(entry.target) ?? entry.target;
      if (this.#watches.has(target)) this.#dirty.add(target);
    }
    if (this.#dirty.size === 0) return;
    if (this.#settle > 0) {
      this.#settleThenDeliver();
      return;
    }
    this.#collect();
    this.#deliver();
  }

  #resizeObserver(): ResizeObserver {
    this.#resize ??= new ResizeObserver((entries) => this.#onResize(entries));
    return this.#resize;
  }

  /** Matches what's observed to `track`: a probe for position, the target itself for size. */
  #applyTrack(target: Element, watch: Watch): void {
    if (watch.anchor === '') return;
    const resize = this.#resizeObserver();
    if (this.#track === 'size') {
      this.#dropProbe(watch);
    } else if (watch.probe === null) {
      watch.probe = createProbe(watch.anchor);
      this.#owners.set(watch.probe, target);
      resize.observe(watch.probe);
    }

    const sized = this.#track !== 'position';
    if (sized === watch.sized) return;
    watch.sized = sized;
    // The border box, so a padding or border change counts as a resize.
    if (sized) resize.observe(target, { box: 'border-box' });
    else resize.unobserve(target);
  }

  #dropProbe(watch: Watch): void {
    if (watch.probe === null) return;
    this.#resize?.unobserve(watch.probe);
    this.#owners.delete(watch.probe);
    retireProbe(watch.probe);
    watch.probe = null;
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
        if (anchorName === undefined) {
          watch.anchor = `--geo-probe-${++seq}`;
          const prior = priors[index]?.computed ?? '';
          // anchor-name takes a list, so keep any name the page already set.
          inlineStyle(target)?.setProperty('anchor-name', prior && prior !== 'none' ? `${prior}, ${watch.anchor}` : watch.anchor);
          watch.wroteAnchorName = true;
        } else {
          watch.anchor = anchorName;
        }
        this.#applyTrack(target, watch);
      }

      this.#dirty.add(target);
    });

    this.#schedule();
  }

  #schedule(): void {
    if (this.#batch === 'sync') {
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
