import { cleanup, render } from '@testing-library/react';
import { StrictMode, useCallback, useRef, useState } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { isSupported } from '#src/index.ts';
import type { GeometryCallback, GeometryEntry } from '#src/index.ts';
import { useGeometryObserver } from '#src/react.ts';
import { quiet } from './helpers.ts';

afterEach(cleanup);

/** Reports what the component did, so the hook's promises can be asserted from outside. */
interface Probe {
  entries: GeometryEntry[];
  renders: number;
  refIdentities: Set<unknown>;
}

function Box({
  probe,
  width = 100,
  options = {},
  onGeometry,
}: {
  probe: Probe;
  width?: number;
  options?: Parameters<typeof useGeometryObserver>[1];
  onGeometry?: GeometryCallback;
}) {
  probe.renders++;
  // A fresh arrow every render on purpose: it must not re-subscribe.
  const ref = useGeometryObserver((entries, observer) => {
    probe.entries.push(...entries);
    onGeometry?.(entries, observer);
  }, options);
  probe.refIdentities.add(ref);
  return <div data-testid="box" ref={ref} style={{ width, height: 40 }} />;
}

function probe(): Probe {
  return { entries: [], renders: 0, refIdentities: new Set() };
}

describe('useGeometryObserver', () => {
  test('observes the element it is attached to', async () => {
    const p = probe();
    const { getByTestId, rerender } = render(<Box probe={p} />);
    await quiet();
    p.entries.length = 0;

    rerender(<Box probe={p} width={240} />);
    await quiet();

    const last = p.entries.at(-1);
    expect(last).toBeDefined();
    expect(last!.resized).toBe(true);
    expect(Math.round(last!.rect.width)).toBe(240);
    expect(getByTestId('box')).toBe(last!.target);
  });

  test('keeps one stable ref across re-renders', async () => {
    const p = probe();
    const { rerender } = render(<Box probe={p} />);
    await quiet();

    for (let i = 0; i < 5; i++) rerender(<Box probe={p} width={100 + i} />);
    await quiet();

    expect(p.renders).toBeGreaterThan(5);
    expect(p.refIdentities.size).toBe(1);
  });

  test('does not re-subscribe when the callback identity changes', async () => {
    const p = probe();
    const { getByTestId, rerender } = render(<Box probe={p} />);
    await quiet();

    // A re-subscribe would re-observe and emit a fresh first entry, whose
    // previousRect is null. Nothing here should produce one.
    p.entries.length = 0;
    for (let i = 0; i < 5; i++) rerender(<Box probe={p} />);
    await quiet();
    expect(p.entries).toHaveLength(0);

    getByTestId('box').style.width = '180px';
    await quiet();
    expect(p.entries).toHaveLength(1);
    expect(p.entries[0]!.previousRect).not.toBeNull();
  });

  test('retunes rather than re-subscribes when track or settle changes', async () => {
    const p = probe();
    const { getByTestId, rerender } = render(<Box probe={p} options={{ track: 'both' }} />);
    await quiet();
    p.entries.length = 0;

    rerender(<Box probe={p} options={{ track: 'size' }} />);
    await quiet();
    expect(p.entries).toHaveLength(0); // a rebuild would announce the element again

    getByTestId('box').style.width = '200px';
    await quiet();
    expect(p.entries.at(-1)!.resized).toBe(true);
    expect(p.entries.at(-1)!.previousRect).not.toBeNull();
  });

  test('moves the subscription when the element itself changes', async () => {
    function Swap({ p }: { p: Probe }) {
      const [second, setSecond] = useState(false);
      const ref = useGeometryObserver((entries) => p.entries.push(...entries));
      return (
        <>
          <button type="button" data-testid="swap" onClick={() => setSecond(true)}>
            swap
          </button>
          {second ? (
            <div data-testid="b" ref={ref} style={{ width: 150, height: 20 }} />
          ) : (
            <div data-testid="a" ref={ref} style={{ width: 80, height: 20 }} />
          )}
        </>
      );
    }

    const p = probe();
    const { getByTestId } = render(<Swap p={p} />);
    await quiet();
    p.entries.length = 0;

    getByTestId('swap').click();
    await quiet();

    const last = p.entries.at(-1);
    expect(last).toBeDefined();
    expect(last!.target).toBe(getByTestId('b'));
    expect(Math.round(last!.rect.width)).toBe(150);
  });

  test('stops reporting once unmounted', async () => {
    const p = probe();
    const { getByTestId, unmount } = render(<Box probe={p} />);
    await quiet();
    const element = getByTestId('box');

    unmount();
    p.entries.length = 0;
    element.style.width = '300px';
    await quiet();

    expect(p.entries).toHaveLength(0);
  });

  test('survives StrictMode, which remounts effects', async () => {
    const p = probe();
    const { getByTestId } = render(
      <StrictMode>
        <Box probe={p} />
      </StrictMode>,
    );
    await quiet();
    p.entries.length = 0;

    getByTestId('box').style.width = '260px';
    await quiet();

    expect(p.entries.length).toBeGreaterThanOrEqual(1);
    expect(Math.round(p.entries.at(-1)!.rect.width)).toBe(260);
  });

  test('does not re-subscribe through a memoised combined ref', async () => {
    function Combined({ p, width }: { p: Probe; width: number }) {
      const mine = useRef<HTMLDivElement | null>(null);
      const geometry = useGeometryObserver((entries) => p.entries.push(...entries));
      const ref = useCallback(
        (node: HTMLDivElement | null) => {
          mine.current = node;
          return geometry(node);
        },
        [geometry],
      );
      return <div data-testid="combined" ref={ref} style={{ width, height: 20 }} />;
    }

    const p = probe();
    const { getByTestId, rerender } = render(<Combined p={p} width={60} />);
    await quiet();
    p.entries.length = 0;

    rerender(<Combined p={p} width={120} />);
    await quiet();

    // A re-subscribe would report a first entry, with no previousRect.
    expect(p.entries).toHaveLength(1);
    expect(p.entries[0]!.previousRect).not.toBeNull();
    expect(Math.round(p.entries[0]!.rect.width)).toBe(120);
    expect(p.entries[0]!.target).toBe(getByTestId('combined'));
  });

  test('leaves the element clean when it never had an anchor-name', async () => {
    function Named({ p }: { p: Probe }) {
      const host = useRef<HTMLDivElement>(null);
      const ref = useGeometryObserver((entries) => p.entries.push(...entries));
      return (
        <div
          data-testid="named"
          ref={(node) => {
            host.current = node;
            ref(node);
          }}
          style={{ width: 60, height: 20 }}
        />
      );
    }

    const p = probe();
    const { getByTestId, unmount } = render(<Named p={p} />);
    await quiet();
    const element = getByTestId('named');
    // Only the native path mints an anchor name; the sampling fallback has
    // nothing to write, and so nothing to restore either.
    if (isSupported()) expect(element.style.getPropertyValue('anchor-name')).not.toBe('');

    // The node keeps its inline style after React drops it, so unobserve's
    // restoration is still inspectable.
    unmount();
    expect(element.style.getPropertyValue('anchor-name')).toBe('');
  });
});
