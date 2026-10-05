import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/react.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  // Browser library: no Node built-ins. React is a peer, so it stays external.
  platform: 'browser',
});
