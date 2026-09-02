import { expect, it } from 'vitest';
import { isThemeMode } from './index';

it('allows only supported themes when restoring saved preferences', () => {
  expect(isThemeMode('light')).toBe(true);
  expect(isThemeMode('dark')).toBe(true);
  expect(isThemeMode(null)).toBe(false);
  expect(isThemeMode('url(https://example.com)')).toBe(false);
});
