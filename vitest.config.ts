import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/**/*.test.ts',
      'apps/apps-script/src/**/*.test.ts',
      'apps/web/src/**/*.test.ts',
      'scripts/**/*.test.mjs',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: [
        'packages/*/src/**/*.ts',
        'apps/apps-script/src/controllers/**/*.ts',
        'apps/web/src/shared/api/**/*.ts',
      ],
      exclude: ['**/index.ts', '**/*.test.ts', '**/mock-transport.ts'],
      thresholds: { lines: 85, functions: 85, statements: 85, branches: 80 },
    },
  },
});
