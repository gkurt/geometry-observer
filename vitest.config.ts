import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// WebKit skips the teardown tests by itself, see test/capabilities.ts.
//
// Firefox is the engine that exercises the sampling fallback, but it only runs on
// CI: Playwright's Firefox can't open a profile on macOS 27 ("Could not find
// profile folder", from a sandbox denial on plugin-container.app). It works on
// the Linux CI runners.
const engines: ('chromium' | 'firefox' | 'webkit')[] = ['chromium', 'webkit'];
if (process.env.CI) engines.push('firefox');

export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: engines.map((browser) => ({ browser })),
    },
  },
});
