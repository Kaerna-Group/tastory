import { isThemeMode } from '@tastory/design-tokens';
import type { ThemeMode } from '@tastory/design-tokens';

export const FONT_PAIRS = ['literary', 'modern', 'humanist'] as const;
export const PAPER_STYLES = ['plain', 'linen', 'dots', 'grid'] as const;
export type FontPair = (typeof FONT_PAIRS)[number];
export type PaperStyle = (typeof PAPER_STYLES)[number];
export type ThemeTarget = 'app' | 'page';
export type ThemePalette = Readonly<{
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  primary: string;
  primaryText: string;
  accent: string;
}>;
export type ThemeProfile = Readonly<{
  name: string;
  mode: ThemeMode;
  palette: ThemePalette;
  fontPair: FontPair;
  paper: PaperStyle;
}>;
export type ThemePreferences = Readonly<{ app: ThemeProfile; page: ThemeProfile }>;

const STORAGE_KEY = 'tastory.theme-builder.v1';
const LEGACY_STORAGE_KEY = 'tastory.theme';
const hex = /^#[0-9a-f]{6}$/i;
const fonts: Record<FontPair, Readonly<{ body: string; display: string }>> = {
  literary: {
    body: "'Segoe UI', system-ui, sans-serif",
    display: "Georgia, 'Times New Roman', serif",
  },
  modern: {
    body: "Arial, 'Helvetica Neue', sans-serif",
    display: "'Segoe UI', Arial, sans-serif",
  },
  humanist: {
    body: "'Trebuchet MS', 'Segoe UI', sans-serif",
    display: "Palatino, 'Book Antiqua', Georgia, serif",
  },
};

const defaultLight: ThemeProfile = {
  name: 'Тёплая бумага',
  mode: 'light',
  palette: {
    background: '#f4efe7',
    surface: '#fffdf8',
    text: '#302a25',
    muted: '#695f57',
    border: '#d8ccbd',
    primary: '#a74459',
    primaryText: '#ffffff',
    accent: '#8a5b00',
  },
  fontPair: 'literary',
  paper: 'plain',
};
const defaultDark: ThemeProfile = {
  name: 'Вечерняя тетрадь',
  mode: 'dark',
  palette: {
    background: '#1f1b19',
    surface: '#2b2623',
    text: '#f7efe6',
    muted: '#c7bbb0',
    border: '#554a43',
    primary: '#e18496',
    primaryText: '#26181c',
    accent: '#e6bf6d',
  },
  fontPair: 'literary',
  paper: 'plain',
};
function copyProfile(profile: ThemeProfile): ThemeProfile {
  return { ...profile, palette: { ...profile.palette } };
}
export function defaultThemePreferences(mode: ThemeMode = 'light'): ThemePreferences {
  return {
    app: copyProfile(mode === 'dark' ? defaultDark : defaultLight),
    page: copyProfile(defaultLight),
  };
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function parseThemeProfile(value: unknown): ThemeProfile | null {
  if (!isObject(value) || !isObject(value['palette'])) return null;
  const palette = value['palette'];
  const keys = [
    'background',
    'surface',
    'text',
    'muted',
    'border',
    'primary',
    'primaryText',
    'accent',
  ] as const;
  if (
    typeof value['name'] !== 'string' ||
    !value['name'].trim() ||
    value['name'].length > 40 ||
    !isThemeMode(value['mode']) ||
    !FONT_PAIRS.includes(value['fontPair'] as FontPair) ||
    !PAPER_STYLES.includes(value['paper'] as PaperStyle) ||
    keys.some((key) => typeof palette[key] !== 'string' || !hex.test(palette[key] as string))
  )
    return null;
  return {
    name: value['name'].trim(),
    mode: value['mode'],
    fontPair: value['fontPair'] as FontPair,
    paper: value['paper'] as PaperStyle,
    palette: Object.fromEntries(
      keys.map((key) => [key, (palette[key] as string).toLowerCase()]),
    ) as {
      [K in (typeof keys)[number]]: string;
    },
  };
}
export function parseThemePreferences(value: unknown): ThemePreferences | null {
  if (!isObject(value)) return null;
  const app = parseThemeProfile(value['app']);
  const page = parseThemeProfile(value['page']);
  return app && page ? { app, page } : null;
}

export function readThemePreferences(): ThemePreferences {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = parseThemePreferences(JSON.parse(saved));
      if (parsed) return parsed;
    }
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (isThemeMode(legacy)) return defaultThemePreferences(legacy);
  } catch {
    // Без localStorage настройки продолжают работать в текущей вкладке.
  }
  return defaultThemePreferences(
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
}

export function themeCssVariables(profile: ThemeProfile): Record<string, string> {
  const pair = fonts[profile.fontPair];
  return {
    '--app-background': profile.palette.background,
    '--app-surface': profile.palette.surface,
    '--app-surface-raised': profile.palette.surface,
    '--app-text': profile.palette.text,
    '--app-text-muted': profile.palette.muted,
    '--app-border': profile.palette.border,
    '--app-primary': profile.palette.primary,
    '--app-primary-text': profile.palette.primaryText,
    '--app-accent': profile.palette.accent,
    '--app-focus': profile.palette.accent,
    '--app-font-body': pair.body,
    '--app-font-display': pair.display,
  };
}

let snapshot: ThemePreferences | null = null;
const listeners = new Set<() => void>();
export function getThemePreferences(): ThemePreferences {
  snapshot ??= readThemePreferences();
  return snapshot;
}
export function subscribeThemePreferences(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function applyThemePreferences(preferences: ThemePreferences): void {
  const parsed = parseThemePreferences(preferences);
  if (!parsed) return;
  snapshot = parsed;
  const root = document.documentElement;
  root.dataset['theme'] = parsed.app.mode;
  root.dataset['appPaper'] = parsed.app.paper;
  root.style.colorScheme = parsed.app.mode;
  for (const [key, value] of Object.entries(themeCssVariables(parsed.app)))
    root.style.setProperty(key, value);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    localStorage.setItem(LEGACY_STORAGE_KEY, parsed.app.mode);
  } catch {
    // Тема остается активной в текущей вкладке.
  }
  listeners.forEach((listener) => listener());
}

export function readTheme(): ThemeMode {
  return getThemePreferences().app.mode;
}
export function applyTheme(theme: ThemeMode): void {
  const current = getThemePreferences();
  applyThemePreferences({
    ...current,
    app: defaultThemePreferences(theme).app,
  });
}
