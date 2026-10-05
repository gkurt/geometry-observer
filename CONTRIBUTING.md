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
- `test/anchor.test.ts` — things that only exist when anchor positioning is available, skipped elsewhere via `isSupported()`.
- `test/capabilities.ts` — measures whether this engine reports teardown, instead of sniffing for it, so the suite lights up on its own if an engine starts supporting it.

Firefox is currently disabled in `vitest.config.ts`; see the comment there.

## Changes

Lint, format and `tsc` own all mechanical style. Run `bun run fix`, then `bun run checks`, before opening a PR. Fix the code rather than disabling a rule.

Add a changelog entry for anything user-facing:

```bash
bun tegami add
```

## Claims

This package makes specific performance and coverage claims. If you change behaviour that one of them rests on, measure it and update the number — in the README, in `AGENTS.md`, and in the comment next to the code. A stale claim is a bug.
