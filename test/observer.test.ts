import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { GeometryObserver, isSupported, observeGeometry } from '#src/index.ts';
import { REPORTS_CSS_ONLY_TEARDOWN } from './capabilities.ts';
import { mount, quiet, recorder } from './helpers.ts';

let host: HTMLElement;
let observer: GeometryObserver | undefined;

beforeEach(() => {
  host = mount('<div id="pad" style="height:10px"></div><div id="box" style="width:90px;height:24px"></div>');
});

afterEach(() => {
  observer?.disconnect();
  observer = undefined;
  host.remove();
});

const box = (): HTMLElement => host.querySelector<HTMLElement>('#box')!;
const pad = (): HTMLElement => host.querySelector<HTMLElement>('#pad')!;

describe('delivery', () => {
  test('delivers an initial entry for a newly observed target', async () => {
    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    observer.observe(box());
    await quiet();

    const entries = rec.drain();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.target).toBe(box());
    expect(entries[0]?.state).toBe('rendered');
    expect(entries[0]?.previousRect).toBeNull();
    expect(Math.round(entries[0]!.rect.width)).toBe(90);
  });

  test('reports a move caused by a sibling above it growing', async () => {
    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    observer.observe(box());
    await quiet();
    rec.drain();

    const before = box().getBoundingClientRect().top;
    pad().style.height = '80px';
    await quiet();

    const entries = rec.drain();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const last = entries.at(-1)!;
    expect(last.moved).toBe(true);
    expect(last.rect.top).toBeGreaterThan(before);
    expect(last.rect.top).toBeCloseTo(box().getBoundingClientRect().top, 1);
  });

  test('reports a transform applied to an ancestor', async () => {
    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    observer.observe(box());
    await quiet();
    rec.drain();

    host.style.transform = 'translateY(40px)';
    await quiet();

    const last = rec.drain().at(-1);
    expect(last?.moved).toBe(true);
    expect(last!.rect.top).toBeCloseTo(box().getBoundingClientRect().top, 1);
    host.style.transform = '';
  });

  test('reports an explicit resize', async () => {
    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    observer.observe(box());
    await quiet();
    rec.drain();

    box().style.width = '220px';
    await quiet();

    const last = rec.drain().at(-1)!;
    expect(last.resized).toBe(true);
    expect(Math.round(last.rect.width)).toBe(220);
  });

  test('reports a resize driven by content, with no style change', async () => {
    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    box().style.width = 'max-content';
    box().style.height = 'auto';
    observer.observe(box());
    await quiet();
    rec.drain();

    box().textContent = 'a considerably longer run of text than before';
    await quiet();

    expect(rec.drain().at(-1)?.resized).toBe(true);
  });

  test('stays silent while nothing moves', async () => {
    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    observer.observe(box());
    await quiet();
    rec.drain();

    await quiet(500);
    expect(rec.count()).toBe(0);
  });

  test('reports moves inside a dialog opened after observing began', async () => {
    host.insertAdjacentHTML(
      'beforeend',
      '<dialog id="dlg" style="margin:0;padding:0"><div id="gap" style="height:10px"></div><div id="inner" style="width:40px;height:10px"></div></dialog>',
    );
    const dialog = host.querySelector<HTMLDialogElement>('#dlg')!;
    const inner = host.querySelector<HTMLElement>('#inner')!;
    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    observer.observe(box());
    await quiet();

    dialog.showModal();
    observer.observe(inner);
    await quiet();
    rec.drain();

    host.querySelector<HTMLElement>('#gap')!.style.height = '50px';
    await quiet();
    const last = rec.drain().at(-1);
    expect(last?.target).toBe(inner);
    expect(last!.rect.top).toBeCloseTo(inner.getBoundingClientRect().top, 1);
    dialog.close();
  });

  test('reports a target in a dialog as the dialog opens, then its moves', async () => {
    host.insertAdjacentHTML(
      'beforeend',
      '<dialog id="dlg" style="margin:0;padding:0"><div id="gap" style="height:10px"></div><div id="inner" style="width:40px;height:10px"></div></dialog>',
    );
    const dialog = host.querySelector<HTMLDialogElement>('#dlg')!;
    const inner = host.querySelector<HTMLElement>('#inner')!;
    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    observer.observe(inner);
    await quiet();
    rec.drain();

    dialog.showModal();
    await quiet();
    expect(rec.drain().at(-1)?.state).toBe('rendered');

    host.querySelector<HTMLElement>('#gap')!.style.height = '50px';
    await quiet();
    const last = rec.drain().at(-1);
    expect(last!.rect.top).toBeCloseTo(inner.getBoundingClientRect().top, 1);
    dialog.close();
  });

  test('reports an exact rect after a nested scroller scrolls', async () => {
    host.innerHTML =
      '<div id="sc" style="height:80px;overflow:auto;width:200px">' +
      '<div style="padding-top:120px;height:400px"><div id="inner" style="width:70px;height:20px"></div></div></div>';
    const scroller = host.querySelector<HTMLElement>('#sc')!;
    const inner = host.querySelector<HTMLElement>('#inner')!;

    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    observer.observe(inner);
    await quiet();
    rec.drain();

    scroller.scrollTop = 60;
    await quiet();

    const last = rec.drain().at(-1);
    expect(last).toBeDefined();
    expect(last!.rect.top).toBeCloseTo(inner.getBoundingClientRect().top, 1);
  });
});

describe('state', () => {
  test('reports a rendered target as rendered', async () => {
    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    observer.observe(box());
    await quiet();
    expect(rec.drain().at(-1)?.state).toBe('rendered');
  });

  test('an element genuinely sized 0x0 is still rendered', async () => {
    const zero = box();
    zero.style.width = '0';
    zero.style.height = '0';
    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    observer.observe(zero);
    await quiet();
    expect(rec.drain().at(-1)?.state).toBe('rendered');
  });
});

describe('state: teardown', () => {
  test('distinguishes rendered, hidden and detached', async () => {
    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    const target = box();
    observer.observe(target);
    await quiet();
    expect(rec.drain().at(-1)?.state).toBe('rendered');

    target.style.display = 'none';
    await quiet();
    const hidden = rec.drain().at(-1);
    expect(hidden?.state).toBe('hidden');
    expect(hidden?.rect.width).toBe(0);

    target.style.display = '';
    await quiet();
    expect(rec.drain().at(-1)?.state).toBe('rendered');

    target.remove();
    await quiet();
    expect(rec.drain().at(-1)?.state).toBe('detached');
  });

  test('a hidden 0x0 element is reported as hidden, not rendered', async () => {
    const zero = box();
    zero.style.width = '0';
    zero.style.height = '0';
    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    observer.observe(zero);
    await quiet();
    rec.drain();

    zero.style.display = 'none';
    await quiet();
    expect(rec.drain().at(-1)?.state).toBe('hidden');
  });

  test('releases a target once it is detached', async () => {
    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    const target = box();
    observer.observe(target);
    await quiet();
    rec.drain();

    target.remove();
    await quiet();
    expect(rec.drain().at(-1)?.state).toBe('detached');

    // Re-attaching must not resurrect the old subscription.
    host.append(target);
    await quiet();
    expect(rec.count()).toBe(0);
  });
  test('reports a target hidden by a class on an ancestor', async () => {
    const sheet = document.createElement('style');
    sheet.textContent = '.gone { display: none }';
    document.head.append(sheet);
    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    observer.observe(box());
    await quiet();
    rec.drain();

    host.classList.add('gone');
    await quiet();
    expect(rec.drain().at(-1)?.state).toBe('hidden');
    sheet.remove();
  });

  test('reports a target detached with its ancestor', async () => {
    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    observer.observe(box());
    await quiet();
    rec.drain();

    host.remove();
    await quiet();
    expect(rec.drain().at(-1)?.state).toBe('detached');
  });

  test('reports a target inside a popover that closes', async () => {
    host.innerHTML = '<div id="pop" popover="manual"><div id="inner" style="width:40px;height:10px"></div></div>';
    const pop = host.querySelector<HTMLElement>('#pop')!;
    pop.showPopover();
    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    observer.observe(host.querySelector('#inner')!);
    await quiet();
    expect(rec.drain().at(-1)?.state).toBe('rendered');

    pop.hidePopover();
    await quiet();
    expect(rec.drain().at(-1)?.state).toBe('hidden');
  });

  test('keeps reporting moves after a target is hidden and shown again', async () => {
    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    observer.observe(box());
    await quiet();

    box().style.display = 'none';
    await quiet();
    box().style.display = '';
    await quiet();
    expect(rec.drain().at(-1)?.state).toBe('rendered');

    pad().style.height = '70px';
    await quiet();
    const last = rec.drain().at(-1);
    expect(last?.moved).toBe(true);
    expect(last!.rect.top).toBeCloseTo(box().getBoundingClientRect().top, 1);
  });

  /** Skipped where the engine can't see it, see {@link REPORTS_CSS_ONLY_TEARDOWN}. */
  test.skipIf(!REPORTS_CSS_ONLY_TEARDOWN)('reports a target hidden by a stylesheet change alone', async () => {
    const sheet = document.createElement('style');
    document.head.append(sheet);
    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    observer.observe(box());
    await quiet();
    rec.drain();

    sheet.sheet!.insertRule('#box { display: none }');
    await quiet();
    expect(rec.drain().at(-1)?.state).toBe('hidden');
    sheet.remove();
  });
});

describe('lifecycle', () => {
  test('unobserve stops delivery', async () => {
    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    observer.observe(box());
    await quiet();
    observer.unobserve(box());
    rec.drain();

    pad().style.height = '90px';
    await quiet();
    expect(rec.count()).toBe(0);
  });

  test('observing the same target twice is a no-op', async () => {
    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    observer.observe(box());
    observer.observe(box());
    await quiet();

    expect(rec.drain()).toHaveLength(1);
  });

  test('takeRecords returns pending entries instead of delivering them', async () => {
    const rec = recorder();
    observer = new GeometryObserver(rec.callback, { batch: 'frame' });
    observer.observe(box());
    // Attaching happens in a microtask; the callback waits for the next frame.
    await Promise.resolve();

    const taken = observer.takeRecords();
    expect(taken).toHaveLength(1);
    expect(taken[0]?.target).toBe(box());
    await quiet();
    expect(rec.count()).toBe(0);
  });

  test('observeGeometry returns a working stop function', async () => {
    const rec = recorder();
    const stop = observeGeometry(box(), rec.callback);
    await quiet();
    expect(rec.drain().length).toBeGreaterThanOrEqual(1);

    stop();
    pad().style.height = '120px';
    await quiet();
    expect(rec.count()).toBe(0);
  });
});

describe('settle', () => {
  test('reports nothing during churn, then once after it stops', async () => {
    const rec = recorder();
    observer = new GeometryObserver(rec.callback, { settle: 150 });
    observer.observe(box());
    await quiet();
    rec.drain();

    const before = box().getBoundingClientRect().width;
    for (let i = 0; i < 15; i++) {
      box().style.width = `${100 + i * 6}px`;
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    }
    expect(rec.count()).toBe(0);

    await quiet();
    const entries = rec.drain();
    expect(entries).toHaveLength(1);

    // The one entry spans the whole churn: measured against the geometry from
    // before it started, not against the previous frame.
    expect(Math.round(entries[0]!.previousRect!.width)).toBe(Math.round(before));
    expect(Math.round(entries[0]!.rect.width)).toBe(Math.round(box().getBoundingClientRect().width));
  });
});

describe('support', () => {
  test('reports a stable boolean', () => {
    expect(typeof isSupported()).toBe('boolean');
    expect(isSupported()).toBe(isSupported());
  });
});
