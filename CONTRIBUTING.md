# Contributing

```bash
bun i
bun run test        # Vitest browser mode, real engines
bun run checks      # lint + format + typecheck + test + build
```

The first run downloads the Playwright browsers it needs:

```bash
bunx playwright install chromium webkit
```

## Tests

Tests run in real browsers, because the whole mechanism is CSS — there is nothing meaningful to assert in a simulated DOM.

- `test/observer.test.ts` — behaviour every engine must have, including where the sampling fallback takes over.
- `test/anchor.test.ts` — things that only exist when anchor positioning is available, skipped elsewhere via `isSupported()`. Anything both paths owe the caller belongs in `observer.test.ts`, so the fallback has to prove it too.
- `test/capabilities.ts` — measures whether this engine reports teardown, instead of sniffing for it, so the suite lights up on its own if an engine starts supporting it.
- `test/react.test.tsx` — the `geometry-observer/react` hook, asserting the memoisation it promises: one stable ref, no re-subscribe on a new callback identity, retune rather than rebuild.

Firefox runs on CI only — Playwright's Firefox build cannot launch on macOS 27. See the comment in `vitest.config.ts`.

## Changes

Lint, format and `tsc` own all mechanical style. Run `bun run fix`, then `bun run checks`, before opening a PR. Fix the code rather than disabling a rule.

Add a changelog entry for anything user-facing, once there is a release to
describe changes against:

```bash
bun tegami add
```

Nothing before the initial release needs one — the first release notes describe
the package, not the path it took to get there.

## Claims

This package makes specific performance and coverage claims. If you change behaviour that one of them rests on, measure it and update the number — in the README, in `AGENTS.md`, and in the comment next to the code. A stale claim is a bug.
