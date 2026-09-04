import type { ThemeProfile } from './theme';

export const THEME_PRESETS = {
  'tastory-light': {
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
  },
  'tastory-dark': {
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
  },
  herbarium: {
    name: 'Гербарий',
    mode: 'light',
    palette: {
      background: '#eef0e7',
      surface: '#fbfcf5',
      text: '#283026',
      muted: '#596356',
      border: '#c7cebc',
      primary: '#426442',
      primaryText: '#ffffff',
      accent: '#795b12',
    },
    fontPair: 'humanist',
    paper: 'linen',
  },
  midnight: {
    name: 'Полуночные чернила',
    mode: 'dark',
    palette: {
      background: '#171d27',
      surface: '#222b38',
      text: '#f4f1e8',
      muted: '#b9c2cf',
      border: '#455268',
      primary: '#e1889d',
      primaryText: '#25171b',
      accent: '#efc76f',
    },
    fontPair: 'modern',
    paper: 'grid',
  },
} as const satisfies Record<string, ThemeProfile>;
export type ThemePresetId = keyof typeof THEME_PRESETS;

export function copyThemePreset(id: ThemePresetId): ThemeProfile {
  const profile = THEME_PRESETS[id];
  return { ...profile, palette: { ...profile.palette } };
}

function channel(value: number) {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}
function luminance(color: string) {
  const value = color.slice(1);
  return (
    0.2126 * channel(Number.parseInt(value.slice(0, 2), 16)) +
    0.7152 * channel(Number.parseInt(value.slice(2, 4), 16)) +
    0.0722 * channel(Number.parseInt(value.slice(4, 6), 16))
  );
}
export function contrastRatio(first: string, second: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(first) || !/^#[0-9a-f]{6}$/i.test(second)) return 1;
  const light = Math.max(luminance(first), luminance(second));
  const dark = Math.min(luminance(first), luminance(second));
  return (light + 0.05) / (dark + 0.05);
}
export function themeContrast(profile: ThemeProfile) {
  const checks = [
    {
      id: 'text',
      label: 'Основной текст',
      ratio: contrastRatio(profile.palette.text, profile.palette.background),
    },
    {
      id: 'muted',
      label: 'Дополнительный текст',
      ratio: contrastRatio(profile.palette.muted, profile.palette.background),
    },
    {
      id: 'button',
      label: 'Основная кнопка',
      ratio: contrastRatio(profile.palette.primaryText, profile.palette.primary),
    },
  ] as const;
  return { checks, passesAA: checks.every(({ ratio }) => ratio >= 4.5) };
}
