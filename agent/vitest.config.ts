import { defineConfig } from 'vitest/config';

// Each API test file boots an in-memory PGlite (WASM Postgres). Unbounded
// parallel workers can exhaust memory in small CI/sandbox machines and crash
// with "Worker exited unexpectedly", so cap the fork pool. Tests need no
// network or secrets.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: {
      forks: { minForks: 1, maxForks: 2 },
    },
    teardownTimeout: 30_000,
  },
});
