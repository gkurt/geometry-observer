# Contributing

```bash
bun i
bun run test        # Vitest browser mode, real engines
bun run checks      # lint + format + typecheck + test + build
bun run smoke       # pack, install the tarball, use it as a consumer would
bun run bench       # compare with other approaches, see bench/README.md
```

The first run downloads the Playwright browsers it needs:

```bash
bunx playwright install chromium webkit
```

## Tests

Tests run in real browsers. The mechanism is CSS, so a simulated DOM can't exercise it.

- `test/observer.test.ts` — behaviour every engine must have, including engines on the sampling fallback.
- `test/anchor.test.ts` — behaviour specific to anchor positioning, skipped where `isSupported()` is false. Anything the caller relies on on both paths belongs in `observer.test.ts` instead.
- `test/capabilities.ts` — measures whether this engine reports a target hidden by CSS alone, so that test starts running on an engine once it supports it.
- `test/react.test.tsx` — the `geometry-observer/react` hook: one stable ref, no re-subscribe when the callback changes, options updated in place.

Firefox runs on CI only, because Playwright's Firefox can't launch on macOS 27. See the comment in `vitest.config.ts`.

## Changes

The linter, formatter and `tsc` handle style. Run `bun run fix`, then `bun run checks`, before opening a PR. Fix the code rather than disabling a rule.

To preview the homepage, build it with `bun run site` and serve `_site/` with any static server.

Add a changelog entry for anything user-facing, once there's a release to
describe changes against:

```bash
bun tegami add
```

Changes before the first release don't need one.

## Claims

The README and homepage make specific performance and coverage claims. If you change behaviour one of them depends on, measure it again and update it everywhere it appears: the README, the homepage, `AGENTS.md` and the comment next to the code.
