import { describe, expect, it } from 'vitest';
import { checkImport, checkExternal } from './architecture-rules.mjs';
const src = 'apps/web/src/';
describe('architecture guardrails', () => {
  it.each([
    ['pages/library/ui/page.tsx', 'features/search/index.ts', '@/features/search'],
    ['features/search/ui/search.tsx', 'features/search/model/state.ts', '../model/state'],
    ['shared/api/runtime.ts', 'shared/config/index.ts', '@/shared/config'],
    ['app/main.tsx', 'pages/library/index.ts', '@/pages/library'],
  ])('accepts legal imports', (from, to, specifier) => {
    expect(checkImport(src + from, src + to, specifier)).toBeNull();
  });
  it.each([
    ['entities/recipe/model/state.ts', 'features/search/index.ts', '@/features/search'],
    ['features/search/ui/search.tsx', 'features/edit/index.ts', '@/features/edit'],
    [
      'pages/library/ui/page.tsx',
      'features/search/model/state.ts',
      '@/features/search/model/state',
    ],
    ['pages/library/ui/page.tsx', 'features/search/index.ts', '../../../features/search'],
    ['features/search/ui/search.tsx', 'features/search/index.ts', '@/features/search'],
  ])('rejects forbidden imports', (from, to, specifier) => {
    expect(checkImport(src + from, src + to, specifier)).toBeTypeOf('string');
  });
  it('protects platform-free packages', () => {
    expect(
      checkImport('packages/domain/src/index.ts', src + 'app/main.tsx', '../../apps/web'),
    ).toBeTypeOf('string');
    expect(checkExternal('packages/domain/src/index.ts', 'react')).toBeTypeOf('string');
    expect(checkExternal('packages/domain/src/index.ts', 'node:fs')).toBeTypeOf('string');
    expect(checkExternal('packages/contracts/src/index.ts', 'zod')).toBeNull();
  });
  it('keeps domain and DTOs out of shared UI', () => {
    expect(
      checkImport(
        src + 'shared/ui/button/index.tsx',
        'packages/domain/src/index.ts',
        '@tastory/domain',
      ),
    ).toBeTypeOf('string');
    expect(
      checkImport(
        src + 'pages/library/ui/page.tsx',
        'packages/contracts/src/index.ts',
        '@tastory/contracts',
      ),
    ).toBeTypeOf('string');
    expect(
      checkImport(
        src + 'entities/recipe/model/time.ts',
        'packages/domain/src/index.ts',
        '@tastory/domain',
      ),
    ).toBeNull();
  });
});
