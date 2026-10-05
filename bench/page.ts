/**
 * The in-page half of the benchmark: approaches, scenarios and measurements.
 * `bench/run.mts` bundles this, serves it and drives it from Playwright.
 */
import { autoUpdate } from '@floating-ui/dom';
import { GeometryObserver } from '#src/index.ts';

type Report = (target: Element) => void;

/** Starts tracking `targets`, calling `report` whenever one may have changed. Returns a stop function. */
type Approach = (targets: readonly HTMLElement[], report: Report) => () => void;

const APPROACHES: Record<string, Approach> = {
  none: () => () => {},

  'geometry-observer': (targets, report) => {
    const observer = new GeometryObserver((entries) => {
      for (const entry of entries) report(entry.target);
    });
    for (const target of targets) observer.observe(target);
    return () => observer.disconnect();
  },

  // The common hand-rolled approach, and Floating UI's `animationFrame: true`.
  'raf-loop': (targets, report) => {
    let frame = 0;
    const loop = (): void => {
      frame = requestAnimationFrame(loop);
      for (const target of targets) report(target);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  },

  // Floating UI's default: ResizeObserver, ancestor scroll and resize listeners,
  // and an IntersectionObserver rebuilt around the element after every move.
  'floating-ui': (targets, report) => {
    const floating = document.createElement('div');
    floating.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;visibility:hidden';
    document.body.append(floating);
    const stops = targets.map((target) => autoUpdate(target, floating, () => report(target)));
    return () => {
      for (const stop of stops) stop();
      floating.remove();
    };
  },

  'resize-observer': (targets, report) => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) report(entry.target);
    });
    for (const target of targets) observer.observe(target);
    return () => observer.disconnect();
  },
};

interface Fixture {
  root: HTMLElement;
  pad: HTMLElement;
  frame: HTMLElement;
  scroller: HTMLElement;
  bar: HTMLElement;
  targets: HTMLElement[];
}

/**
 * Targets sit in a column inside a scroller, below a pad that can push them down.
 * The bar sits after the scroller, so resizing it reflows the page without moving
 * any target.
 */
function fixture(count: number): Fixture {
  const root = document.createElement('div');
  root.innerHTML =
    '<div data-pad style="height:0"></div>' +
    '<div data-frame><div data-scroller style="height:300px;overflow:auto"><div data-list></div><div style="height:1500px"></div></div></div>' +
    '<div data-bar style="height:8px;width:0;background:#ccc"></div>';
  document.body.append(root);
  const list = root.querySelector<HTMLElement>('[data-list]')!;
  const targets = Array.from({ length: count }, (_, index) => {
    const target = document.createElement('div');
    target.style.cssText = `height:3px;width:${20 + (index % 60)}px;background:#888;white-space:nowrap`;
    list.append(target);
    return target;
  });
  return {
    root,
    pad: root.querySelector('[data-pad]')!,
    frame: root.querySelector('[data-frame]')!,
    scroller: root.querySelector('[data-scroller]')!,
    bar: root.querySelector('[data-bar]')!,
    targets,
  };
}

/**
 * Per-frame changes. Each runs once per animation frame, before any approach reads
 * layout. `idle` requests no frames at all, so only an approach's own work shows.
 * None returns to the starting state, so a missed change always shows up as stale.
 */
const SCENARIOS: Record<string, ((fixture: Fixture, frame: number) => void) | null> = {
  idle: null,
  'unrelated reflow': ({ bar }, frame) => {
    bar.style.width = `${frame % 200}px`;
  },
  'all targets move': ({ pad }, frame) => {
    pad.style.height = `${1 + (frame % 40)}px`;
  },
  'one resize / 10 frames': ({ targets }, frame) => {
    if (frame % 10 !== 0) return;
    const target = targets[(frame / 10) % targets.length]!;
    target.style.width = `${20 + (frame % 60)}px`;
  },
  scroll: ({ scroller }, frame) => {
    scroller.scrollTop = 1 + ((frame * 3) % 600);
  },
  'ancestor transform': ({ frame: wrapper }, frame) => {
    wrapper.style.transform = `translateX(${1 + (frame % 40)}px)`;
  },
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function rectKey(rect: DOMRectReadOnly): string {
  return `${rect.x.toFixed(1)},${rect.y.toFixed(1)},${rect.width.toFixed(1)},${rect.height.toFixed(1)}`;
}

/**
 * Wraps `report` the way a consumer would use it: read the rect and act only when
 * it changed. The read is part of each approach's cost.
 */
function tracker(): { report: Report; last: Map<Element, string> } {
  const last = new Map<Element, string>();
  return {
    report: (target) => {
      const key = rectKey(target.getBoundingClientRect());
      if (last.get(target) !== key) last.set(target, key);
    },
    last,
  };
}

let session: { fix: Fixture; track: ReturnType<typeof tracker>; stop: () => void; scenario: string } | null = null;

/**
 * Sets up `count` targets tracked by `approach`, and waits for the initial reports.
 * Kept apart from {@link run} so setup cost stays out of the measurement.
 */
export async function prepare(approach: string, scenario: string, count: number): Promise<void> {
  const fix = fixture(count);
  const track = tracker();
  const stop = APPROACHES[approach]!(fix.targets, track.report);
  session = { fix, track, stop, scenario };
  await sleep(400);
}

/** Runs the scenario for `frames` frames, or as long as that takes at 60Hz for `idle`. */
export async function run(frames: number): Promise<void> {
  const { fix, scenario } = session!;
  const change = SCENARIOS[scenario];
  if (change === null || change === undefined) {
    await sleep((frames * 1000) / 60);
    return;
  }
  await new Promise<void>((resolve) => {
    let frame = 0;
    const drive = (): void => {
      if (++frame > frames) {
        resolve();
        return;
      }
      change(fix, frame);
      requestAnimationFrame(drive);
    };
    requestAnimationFrame(drive);
  });
}

/** Counts targets whose last report is still wrong once the page settles: missed, not just late. */
export async function finish(): Promise<number> {
  const { fix, track, stop } = session!;
  await sleep(400);
  let stale = 0;
  for (const target of fix.targets) if (track.last.get(target) !== rectKey(target.getBoundingClientRect())) stale++;
  stop();
  fix.root.remove();
  session = null;
  return stale;
}

interface Change {
  /** Puts the fixture in its starting state, before the approach starts tracking. */
  arrange?: (fixture: Fixture) => void;
  change: (fixture: Fixture) => void | Promise<void>;
}

/** One-shot changes for the coverage table. The first target is the one checked. */
const CHANGES: Record<string, Change> = {
  'sibling above grows': {
    change: ({ pad }) => {
      pad.style.height = '30px';
    },
  },
  'sibling inserted before it': {
    change: ({ targets }) => {
      const sibling = document.createElement('div');
      sibling.style.height = '12px';
      targets[0]!.before(sibling);
    },
  },
  'own size (style)': {
    change: ({ targets }) => {
      targets[0]!.style.width = '150px';
    },
  },
  'own size (content)': {
    change: ({ targets }) => {
      targets[0]!.style.width = 'max-content';
      targets[0]!.textContent = 'a run of text';
    },
  },
  'ancestor transform': {
    change: ({ frame }) => {
      frame.style.transform = 'translate(25px, 15px)';
    },
  },
  'ancestor transform animation': {
    change: async ({ frame }) => {
      await frame.animate([{ transform: 'none' }, { transform: 'translateX(40px)' }], { duration: 150, fill: 'forwards' }).finished;
    },
  },
  'nested scroll': {
    change: ({ scroller }) => {
      scroller.scrollTop = 40;
    },
  },
  'page scroll': {
    change: () => {
      scrollTo(0, 50);
    },
  },
  'moves while off-screen': {
    arrange: ({ pad }) => {
      pad.style.height = '2000px';
    },
    change: ({ pad }) => {
      pad.style.height = '2030px';
    },
  },
  'moves while scrolled out of its scroller': {
    arrange: ({ scroller }) => {
      scroller.scrollTop = 200;
    },
    change: ({ pad }) => {
      pad.style.height = '30px';
    },
  },
  'moves while partly clipped': {
    arrange: ({ targets, scroller }) => {
      targets[0]!.style.height = '20px';
      scroller.scrollTop = 10;
    },
    change: ({ pad }) => {
      pad.style.height = '30px';
    },
  },
  'display: none': {
    change: ({ targets }) => {
      targets[0]!.style.display = 'none';
    },
  },
  removed: {
    change: ({ targets }) => {
      targets[0]!.remove();
    },
  },
};

const CHANGE_NAMES = Object.keys(CHANGES);

interface CoverageResult {
  /** Whether the last reported rect matches the real one once things settle. */
  caught: boolean;
  /** Milliseconds from the change to the first correct report, if it came after. */
  latency: number | null;
}

export async function coverage(approach: string, change: string): Promise<CoverageResult> {
  document.documentElement.style.minHeight = '3000px';
  const fix = fixture(3);
  const { arrange, change: apply } = CHANGES[change]!;
  arrange?.(fix);
  const target = fix.targets[0]!;
  const reports: { at: number; key: string }[] = [];
  const stop = APPROACHES[approach]!(fix.targets, (element) => {
    if (element === target) reports.push({ at: performance.now(), key: rectKey(target.getBoundingClientRect()) });
  });
  await sleep(400);
  reports.length = 0;

  // Measured from when the change completes, so an animation's own duration doesn't count.
  await apply(fix);
  const start = performance.now();
  await sleep(500);

  const expected = rectKey(target.getBoundingClientRect());
  const first = reports.find((entry) => entry.key === expected);
  const result = { caught: reports.at(-1)?.key === expected, latency: first ? Math.max(0, first.at - start) : null };
  stop();
  fix.root.remove();
  scrollTo(0, 0);
  document.documentElement.style.minHeight = '';
  await sleep(100);
  return result;
}

const api = { prepare, run, finish, coverage, changes: () => CHANGE_NAMES };

declare global {
  // oxlint-disable-next-line no-var -- a global augmentation has to be a var
  var bench: typeof api;
}

globalThis.bench = api;
