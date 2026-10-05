import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      // Chromium is the engine the mechanism was built against. WebKit runs the
      // same suite because Safari 26 ships anchor positioning too — it skips the
      // teardown group on its own, via the capability measured in
      // test/capabilities.ts.
      //
      // Firefox is disabled: it has no anchor positioning yet (it would exercise
      // the sampling fallback, which is worth covering), but Playwright's Firefox
      // build fails to launch on this machine — "Could not find profile folder",
      // which survives a forced reinstall. Re-enable by adding
      // `{ browser: 'firefox' }` once that is fixed upstream.
      instances: [{ browser: 'chromium' }, { browser: 'webkit' }],
    },
  },
});
