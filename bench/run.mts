/**
 * Compares geometry-observer with the other ways to track element geometry, in
 * real engines. See bench/README.md for what each scenario and column means.
 *
 *   bun run bench               every engine, every scenario, writes bench/results.md
 *   bun run bench --quick       100 targets, one run each
 *   bun run bench --engine webkit
 *   bun run bench --coverage    or --cost, one section only
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, type BrowserType, chromium, firefox, type Page, webkit } from 'playwright';

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const only = args.includes('--engine') ? args[args.indexOf('--engine') + 1] : undefined;
const counts = quick ? [100] : [10, 100, 1000];
const frames = quick ? 90 : 120;
const repeats = quick ? 1 : 3;
const sections = args.includes('--coverage') ? ['coverage'] : args.includes('--cost') ? ['cost'] : ['cost', 'coverage'];

const APPROACHES = args.includes('--approaches')
  ? args[args.indexOf('--approaches') + 1]!.split(',')
  : ['geometry-observer', 'raf-loop', 'floating-ui', 'resize-observer'];
const SCENARIOS = ['idle', 'unrelated reflow', 'all targets move', 'one resize / 10 frames', 'scroll', 'ancestor transform'];

const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'page.ts')], target: 'browser', format: 'esm' });
if (!built.success) throw new AggregateError(built.logs, 'bundling bench/page.ts failed');
const script = await built.outputs[0]!.text();
const server = Bun.serve({
  port: 0,
  fetch: (request) =>
    new URL(request.url).pathname === '/page.js'
      ? new Response(script, { headers: { 'content-type': 'text/javascript' } })
      : new Response('<!doctype html><meta charset="utf-8"><body style="margin:0"><script type="module" src="/page.js"></script>', {
          headers: { 'content-type': 'text/html' },
        }),
});

async function freshPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.goto(server.url.href);
  await page.waitForFunction(() => 'bench' in globalThis);
  return page;
}

/** Chromium's own accounting of main-thread work so far, in ms: script, style, layout, paint and events. */
async function taskClock(page: Page): Promise<() => Promise<number>> {
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  return async () => {
    const { metrics } = await session.send('Performance.getMetrics');
    return (metrics.find((metric) => metric.name === 'TaskDuration')?.value ?? 0) * 1000;
  };
}

const median = (values: number[]): number => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)]!;

const lines: string[] = [];
const out = (line = ''): void => {
  console.log(line);
  lines.push(line);
};

/** Main-thread milliseconds per frame, and how many targets were left with a wrong rect. */
async function cost(browser: Browser, approach: string, scenario: string, count: number): Promise<{ busy: number; stale: number }> {
  const page = await freshPage(browser);
  const clock = await taskClock(page);
  await page.evaluate(([a, s, c]) => globalThis.bench.prepare(a, s, c), [approach, scenario, count] as const);
  const before = await clock();
  await page.evaluate((f) => globalThis.bench.run(f), frames);
  const busy = ((await clock()) - before) / frames;
  const stale = await page.evaluate(() => globalThis.bench.finish());
  await page.close();
  return { busy, stale };
}

async function costTable(browser: Browser): Promise<void> {
  out('### Main-thread cost\n');
  out(
    `Milliseconds of main-thread work each approach adds per frame over an untracked page, from Chromium's task accounting ` +
      `(median of ${repeats} runs of ${frames} frames). **stale** counts targets whose last report was still wrong after the page settled.\n`,
  );
  out(`| scenario | targets | ${APPROACHES.join(' | ')} |`);
  out(`| --- | --: | ${APPROACHES.map(() => '--:').join(' | ')} |`);
  for (const scenario of SCENARIOS) {
    for (const count of counts) {
      const results = new Map<string, { busy: number; stale: number }>();
      for (const approach of ['none', ...APPROACHES]) {
        const runs: { busy: number; stale: number }[] = [];
        for (let run = 0; run < repeats; run++) runs.push(await cost(browser, approach, scenario, count));
        results.set(approach, {
          busy: median(runs.map((sample) => sample.busy)),
          stale: Math.max(...runs.map((sample) => sample.stale)),
        });
      }
      const base = results.get('none')!.busy;
      const cells = APPROACHES.map((approach) => {
        const { busy, stale } = results.get(approach)!;
        const added = Math.max(0, busy - base).toFixed(2);
        return stale > 0 ? `${added} (${stale} stale)` : added;
      });
      out(`| ${scenario} | ${count} | ${cells.join(' | ')} |`);
    }
  }
  out();
}

async function coverageTable(browser: Browser): Promise<void> {
  out('### Coverage\n');
  out(
    'Whether the last report matches the real rect once the page settles, and the median time from the change to the first ' +
      `correct report (${repeats} runs).\n`,
  );
  out(`| change | ${APPROACHES.join(' | ')} |`);
  out(`| --- | ${APPROACHES.map(() => ':-:').join(' | ')} |`);
  const probe = await freshPage(browser);
  const changes = await probe.evaluate(() => globalThis.bench.changes());
  await probe.close();
  for (const change of changes) {
    const cells: string[] = [];
    for (const approach of APPROACHES) {
      const runs = [];
      for (let run = 0; run < repeats; run++) {
        const page = await freshPage(browser);
        runs.push(await page.evaluate(([a, c]) => globalThis.bench.coverage(a, c), [approach, change] as const));
        await page.close();
      }
      const caught = runs.every((result) => result.caught);
      cells.push(caught ? `yes, ${Math.round(median(runs.map((result) => result.latency ?? 0)))}ms` : 'no');
    }
    out(`| ${change} | ${cells.join(' | ')} |`);
  }
  out();
}

async function benchEngine(type: BrowserType): Promise<void> {
  let browser: Browser;
  try {
    browser = await type.launch();
  } catch (error) {
    out(`## ${type.name()}\n\nSkipped, the browser didn't launch: ${String(error).split('\n')[0]}\n`);
    return;
  }
  out(`## ${type.name()} ${browser.version()}\n`);
  // Only Chromium exposes main-thread accounting. Filling idle time with work and
  // counting what's left was tried for the others, and was noisier than the
  // differences it was meant to show.
  if (type === chromium && sections.includes('cost')) await costTable(browser);
  if (sections.includes('coverage')) await coverageTable(browser);
  await browser.close();
}

out('# Benchmark results\n');
out(`Generated by \`bun run bench${quick ? ' --quick' : ''}\` on ${process.platform} ${process.arch}. See README.md in this folder.\n`);
for (const type of [chromium, webkit, firefox]) if (only === undefined || type.name() === only) await benchEngine(type);
await server.stop();

if (!quick && only === undefined && sections.length === 2 && !args.includes('--approaches'))
  writeFileSync(join(import.meta.dir, 'results.md'), `${lines.join('\n')}\n`);
