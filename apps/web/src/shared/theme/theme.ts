import { isThemeMode } from '@tastory/design-tokens';
import type { ThemeMode } from '@tastory/design-tokens';
const STORAGE_KEY = 'tastory.theme';
export function readTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isThemeMode(saved)) return saved;
  } catch {
    // Настройки доступны и при запрете localStorage в браузере.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function applyTheme(theme: ThemeMode): void {
  document.documentElement.dataset['theme'] = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Тема остается активной в текущей вкладке.
  }
}
