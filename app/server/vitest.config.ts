import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/routes/**', 'src/services/**', 'src/middleware/**'],
      thresholds: {
        lines: 90,
        branches: 85,
      },
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    teardownTimeout: 10000,
  },
});
