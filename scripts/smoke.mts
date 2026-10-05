/**
 * Install the packed tarball into a throwaway project and use it, the way a
 * consumer would.
 *
 * The test suite imports `#src/*`, so it never touches `package.json`'s `files`,
 * `exports` map or the built `dist`. Every one of those can be wrong while every
 * test passes: a missing entry in `files`, a `types` path that does not resolve, a
 * code-split chunk left out of the package. This catches that before a release
 * does.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');

function run(command: string, args: string[], cwd: string, label: string): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false });
  if (result.status !== 0) {
    console.error(`\n${label} failed:\n${result.stdout ?? ''}${result.stderr ?? ''}`);
    process.exit(1);
  }
  return result.stdout ?? '';
}

function check(ok: boolean, description: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${description}`);
  if (!ok) failures.push(description);
}

const failures: string[] = [];
const scratch = mkdtempSync(join(tmpdir(), 'geometry-observer-smoke-'));
let tarball = '';

try {
  console.log('building');
  run('bun', ['run', 'build'], repo, 'build');

  console.log('packing');
  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', scratch], repo, 'npm pack')) as {
    filename: string;
    files: { path: string }[];
  }[];
  const entry = packed[0];
  if (entry === undefined) {
    console.error('npm pack produced nothing');
    process.exit(1);
  }
  tarball = join(scratch, entry.filename);
  const shipped = new Set(entry.files.map((file) => file.path));

  console.log('\ntarball contents');
  for (const required of ['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts', 'dist/react.js', 'dist/react.d.ts'])
    check(shipped.has(required), `ships ${required}`);
  // The entry points import a shared chunk; leaving it out breaks the package
  // without breaking a single test.
  check(
    [...shipped].some((path) => /^dist\/.*\.js$/.test(path) && !['dist/index.js', 'dist/react.js'].includes(path)),
    'ships the shared chunk',
  );
  check(![...shipped].some((path) => path.startsWith('src/') || path.startsWith('test/')), 'ships no sources or tests');

  // Every path the exports map points at has to be in the tarball. A typo in a
  // `types` path otherwise goes unnoticed, because TypeScript quietly falls back
  // to the declaration file sitting next to the resolved `.js`.
  const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as {
    exports: Record<string, Record<string, string> | string>;
  };
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    const targets = typeof target === 'string' ? { default: target } : target;
    for (const [condition, file] of Object.entries(targets)) {
      if (condition === 'source') continue; // deliberately points at unshipped src
      check(shipped.has(file.replace(/^\.\//, '')), `exports ${subpath} ${condition} points at a shipped file`);
    }
  }

  console.log('\ninstalling into a throwaway project');
  const project = join(scratch, 'consumer');
  mkdirSync(project);
  writeFileSync(
    join(project, 'package.json'),
    `${JSON.stringify({ name: 'consumer', private: true, version: '0.0.0', type: 'module' }, null, 2)}\n`,
  );
  run('npm', ['install', '--no-audit', '--no-fund', tarball, 'react@19'], project, 'npm install');

  console.log('\nresolving at runtime');
  writeFileSync(
    join(project, 'use.mjs'),
    [
      "import { GeometryObserver, observeGeometry, isSupported, PROBE_GROUP_ATTRIBUTE } from 'geometry-observer';",
      "import { useGeometryObserver } from 'geometry-observer/react';",
      'const names = [GeometryObserver, observeGeometry, isSupported, useGeometryObserver].map((value) => typeof value);',
      'console.log(JSON.stringify({ names, attribute: PROBE_GROUP_ATTRIBUTE, supported: isSupported() }));',
    ].join('\n'),
  );
  const used = JSON.parse(run('node', ['use.mjs'], project, 'node use.mjs').trim()) as {
    names: string[];
    attribute: string;
    supported: boolean;
  };
  check(
    used.names.every((name) => name === 'function'),
    'both entry points export callable values',
  );
  check(used.attribute === 'data-geometry-probes', 'runtime values survive the build');
  // No DOM here, so this also proves the library does not touch one on import.
  check(!used.supported, 'isSupported() reports false off the DOM rather than throwing');

  console.log('\nresolving types');
  writeFileSync(
    join(project, 'use.ts'),
    [
      "import { GeometryObserver } from 'geometry-observer';",
      "import type { GeometryEntry, Track } from 'geometry-observer';",
      "import { useGeometryObserver } from 'geometry-observer/react';",
      'const track: Track = "size";',
      'export const observer = new GeometryObserver((entries: GeometryEntry[]) => entries.length, { track });',
      'export const hook = useGeometryObserver;',
    ].join('\n'),
  );
  writeFileSync(
    join(project, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: 'nodenext',
          moduleResolution: 'nodenext',
          target: 'esnext',
          lib: ['esnext', 'dom'],
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        files: ['use.ts'],
      },
      null,
      2,
    )}\n`,
  );
  run(join(repo, 'node_modules', '.bin', 'tsc'), ['--project', project], project, 'tsc');
  check(true, 'a consumer typechecks against the published types');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} smoke check(s) failed`);
  process.exit(1);
}
console.log('\nsmoke: the package installs and works from the tarball');
