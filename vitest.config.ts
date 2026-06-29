import { defineConfig } from 'vitest/config';

// Phase 3.0 toolchain bootstrap. Minimal Vitest config — proves the runner executes.
// No Audit Engine logic is configured or imported here.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    // All DB tests share one real PostgreSQL cluster, and the tamper test toggles a
    // trigger; run files sequentially so they never race on shared schema state.
    fileParallelism: false,
  },
});
