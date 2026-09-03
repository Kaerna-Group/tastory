import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: [
      'packages/**/*.test.ts',
      'apps/apps-script/src/**/*.test.ts',
      'apps/web/src/**/*.test.ts',
      'scripts/**/*.test.mjs',
      'scripts/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: [
        'packages/*/src/**/*.ts',
        'apps/apps-script/src/controllers/**/*.ts',
        'apps/apps-script/src/auth/**/*.ts',
        'apps/apps-script/src/services/core-migration.ts',
        'apps/apps-script/src/services/users-import.ts',
        'apps/apps-script/src/platform/users-import-store.ts',
        'apps/apps-script/src/platform/workspace-directory.ts',
        'apps/apps-script/src/platform/admin-directory.ts',
        'apps/apps-script/src/services/admin-directory.ts',
        'apps/apps-script/src/services/journal-*.ts',
        'apps/apps-script/src/services/operation-journal.ts',
        'apps/apps-script/src/platform/journal-store.ts',
        'apps/apps-script/src/platform/operation-journal.ts',
        'apps/apps-script/src/platform/current-schema.ts',
        'apps/apps-script/src/entrypoints/sheets-auth-staging.ts',
        'apps/apps-script/src/entrypoints/users-staging.ts',
        'apps/apps-script/src/platform/schema-store.ts',
        'apps/apps-script/src/entrypoints/schema-staging.ts',
        'apps/web/src/entities/session/model/**/*.ts',
        'apps/web/src/shared/api/**/*.ts',
      ],
      exclude: ['**/index.ts', '**/*.test.ts', '**/mock-transport.ts'],
      thresholds: { lines: 85, functions: 85, statements: 85, branches: 80 },
    },
  },
});
