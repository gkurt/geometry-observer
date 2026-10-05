import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Chromium is the engine the mechanism was built against. WebKit runs the same
// suite because Safari 26 ships anchor positioning too — it skips the teardown
// group on its own, via the capability measured in test/capabilities.ts.
//
// Firefox has no anchor positioning yet, so it is the only engine that exercises
// the sampling fallback end to end — worth running, but CI-only: Playwright's
// Firefox build cannot launch on macOS 27. It fails to open any profile ("Could
// not find profile folder"), rooted in a sandbox denial
// (`sandbox_extension_issue_file_to_process failed for plugin-container.app`)
// that reproduces outside Playwright and across every cached revision. Nothing in
// this repo can work around it; CI runs Linux, where the same build is fine.
const engines: ('chromium' | 'firefox' | 'webkit')[] = ['chromium', 'webkit'];
if (process.env.CI) engines.push('firefox');

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: engines.map((browser) => ({ browser })),
    },
  },
});
