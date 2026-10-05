import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { GeometryObserver, isSupported, PROBE_GROUP_ATTRIBUTE } from '#src/index.ts';
import { mount, quiet, recorder } from './helpers.ts';

/**
 * Behaviour that only exists when the anchor-positioning mechanism is available.
 * Elsewhere the observer falls back to sampling, which has none of these
 * properties — and is covered by observer.test.ts instead.
 */
const anchors = describe.skipIf(!isSupported());

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
const probeCount = (): number => document.querySelectorAll(`[${PROBE_GROUP_ATTRIBUTE}] > *`).length;

anchors('probes', () => {
  test('keeps every probe in a single group, not on <body>', async () => {
    const bodyChildrenBefore = document.body.children.length;
    const probesBefore = probeCount();

    const targets = Array.from({ length: 12 }, () => {
      const el = document.createElement('div');
      el.style.cssText = 'width:30px;height:10px';
      host.append(el);
      return el;
    });

    observer = new GeometryObserver(recorder().callback);
    for (const target of targets) observer.observe(target);
    await quiet();

    expect(probeCount() - probesBefore).toBe(12);
    // One group element at most, never one body child per target.
    expect(document.body.children.length - bodyChildrenBefore).toBeLessThanOrEqual(1);
    expect(document.querySelectorAll(`body > [popover]`).length).toBe(0);
  });

  test('releases probes on unobserve', async () => {
    const before = probeCount();
    observer = new GeometryObserver(recorder().callback);
    observer.observe(box());
    await quiet();
    expect(probeCount()).toBe(before + 1);

    observer.unobserve(box());
    expect(probeCount()).toBe(before);
  });
});

anchors('anchor-name handling', () => {
  test('appends to an existing anchor-name rather than clobbering it', async () => {
    box().style.setProperty('anchor-name', '--mine');
    observer = new GeometryObserver(recorder().callback);
    observer.observe(box());
    await quiet();

    const applied = box().style.getPropertyValue('anchor-name');
    expect(applied).toContain('--mine');
    expect(applied).toMatch(/--geo-probe-\d+/);

    observer.unobserve(box());
    expect(box().style.getPropertyValue('anchor-name')).toBe('--mine');
  });

  test('leaves the target untouched when given an anchorName', async () => {
    box().style.setProperty('anchor-name', '--mine');
    const styleBefore = box().getAttribute('style');

    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    observer.observe(box(), { anchorName: '--mine' });
    await quiet();

    expect(box().getAttribute('style')).toBe(styleBefore);
    rec.drain();

    box().style.width = '150px';
    await quiet();
    expect(Math.round(rec.drain().at(-1)!.rect.width)).toBe(150);
  });

  test('does not strip an anchor-name it never wrote', async () => {
    box().style.setProperty('anchor-name', '--mine');
    observer = new GeometryObserver(recorder().callback);
    // Attachment is deferred to a microtask; tearing down first must be harmless.
    observer.observe(box());
    observer.disconnect();
    await quiet();

    expect(box().style.getPropertyValue('anchor-name')).toBe('--mine');
  });

  test('rejects an anchor name that is not a dashed ident', () => {
    observer = new GeometryObserver(recorder().callback);
    expect(() => observer!.observe(box(), { anchorName: 'mine' })).toThrow(TypeError);
  });
});

anchors('coverage the sampling fallback cannot match', () => {
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

  test('survives a blanket transition reset', async () => {
    const reset = document.createElement('style');
    reset.textContent = '*{transition:none !important;animation:none !important}';
    document.head.append(reset);
    try {
      const rec = recorder();
      observer = new GeometryObserver(rec.callback);
      observer.observe(box());
      await quiet();
      rec.drain();

      pad().style.height = '90px';
      await quiet();
      expect(rec.drain().length).toBeGreaterThanOrEqual(1);
    } finally {
      reset.remove();
    }
  });
});

anchors('reconfigure', () => {
  test('narrows what raises events without re-observing', async () => {
    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    observer.observe(box());
    await quiet();
    const anchorName = box().style.getPropertyValue('anchor-name');
    rec.drain();

    observer.reconfigure({ track: 'size' });
    await quiet();
    // Reconfiguring is a style write, not a change of geometry.
    expect(rec.count()).toBe(0);
    expect(box().style.getPropertyValue('anchor-name')).toBe(anchorName);
    expect(observer.track).toBe('size');

    pad().style.height = '70px'; // a pure move no longer raises an event
    await quiet();
    expect(rec.count()).toBe(0);

    box().style.width = '160px'; // a resize still does, carrying the new position
    await quiet();
    const last = rec.drain().at(-1)!;
    expect(Math.round(last.rect.width)).toBe(160);
    expect(last.rect.top).toBeCloseTo(box().getBoundingClientRect().top, 1);
  });

  test('turns settle on and off in place', async () => {
    const rec = recorder();
    observer = new GeometryObserver(rec.callback);
    observer.observe(box());
    await quiet();
    rec.drain();

    observer.reconfigure({ settle: 150 });
    expect(observer.settle).toBe(150);
    for (let i = 0; i < 12; i++) {
      box().style.width = `${100 + i * 6}px`;
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    }
    expect(rec.count()).toBe(0);
    await quiet();
    expect(rec.drain()).toHaveLength(1);

    observer.reconfigure({ settle: 0 });
    box().style.width = '250px';
    await quiet();
    expect(rec.drain().length).toBeGreaterThanOrEqual(1);
  });
});
