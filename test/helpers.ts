import type { GeometryCallback, GeometryEntry } from '#src/index.ts';

/** Collects entries so a test can assert on what actually arrived. */
export function recorder(): { callback: GeometryCallback; drain: () => GeometryEntry[]; count: () => number } {
  let entries: GeometryEntry[] = [];
  return {
    callback: (batch) => entries.push(...batch),
    drain: () => {
      const taken = entries;
      entries = [];
      return taken;
    },
    count: () => entries.length,
  };
}

/** Long enough for a frame-batched delivery, a 250ms settle, or a sampler tick. */
export function quiet(ms = 320): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** A fixture rooted in its own container, removed by the caller. */
export function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  return host;
}
