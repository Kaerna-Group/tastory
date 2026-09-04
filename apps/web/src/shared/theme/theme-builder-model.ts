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
  provence: {
    name: 'Прованская кухня',
    mode: 'light',
    palette: {
      background: '#f4f0f7',
      surface: '#fffafd',
      text: '#342b39',
      muted: '#6c5d71',
      border: '#d8cadd',
      primary: '#765084',
      primaryText: '#ffffff',
      accent: '#805400',
    },
    fontPair: 'humanist',
    paper: 'dots',
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
  coffeehouse: {
    name: 'Домашняя кофейня',
    mode: 'dark',
    palette: {
      background: '#1d1916',
      surface: '#2a2420',
      text: '#f8efe5',
      muted: '#c7b8aa',
      border: '#594c43',
      primary: '#d8905f',
      primaryText: '#2a160b',
      accent: '#f0c36d',
    },
    fontPair: 'literary',
    paper: 'linen',
  },
  nordic: {
    name: 'Скандинавский стол',
    mode: 'light',
    palette: {
      background: '#edf2f3',
      surface: '#fbfdfd',
      text: '#263136',
      muted: '#5b686d',
      border: '#c4d0d3',
      primary: '#376776',
      primaryText: '#ffffff',
      accent: '#80500d',
    },
    fontPair: 'modern',
    paper: 'plain',
  },
  berry: {
    name: 'Ягодный десерт',
    mode: 'light',
    palette: {
      background: '#f8edef',
      surface: '#fffafb',
      text: '#39282d',
      muted: '#705b61',
      border: '#dbc5ca',
      primary: '#9f3f5c',
      primaryText: '#ffffff',
      accent: '#745a00',
    },
    fontPair: 'literary',
    paper: 'dots',
  },
  'olive-cellar': {
    name: 'Оливковый погреб',
    mode: 'dark',
    palette: {
      background: '#1b1e17',
      surface: '#282d22',
      text: '#f3f2e7',
      muted: '#bcc2ad',
      border: '#505945',
      primary: '#adc16f',
      primaryText: '#17200b',
      accent: '#e0ad64',
    },
    fontPair: 'humanist',
    paper: 'linen',
  },
  'plum-night': {
    name: 'Сливовый вечер',
    mode: 'dark',
    palette: {
      background: '#211821',
      surface: '#302330',
      text: '#f8eef7',
      muted: '#cbafc9',
      border: '#614a60',
      primary: '#d794c5',
      primaryText: '#271323',
      accent: '#e7bd72',
    },
    fontPair: 'literary',
    paper: 'grid',
  },
} as const satisfies Record<string, ThemeProfile>;
export type ThemePresetId = keyof typeof THEME_PRESETS;

export const QUICK_THEME_PRESET_IDS = [
  'tastory-light',
  'herbarium',
  'provence',
  'tastory-dark',
  'midnight',
  'coffeehouse',
] as const satisfies ReadonlyArray<ThemePresetId>;

export const LIBRARY_THEME_PRESET_IDS = [
  'nordic',
  'berry',
  'olive-cellar',
  'plum-night',
] as const satisfies ReadonlyArray<ThemePresetId>;

export const THEME_PRESET_DETAILS = {
  'tastory-light': {
    description: 'Фирменная тёплая бумага для долгого чтения и семейных рецептов.',
    mood: 'Уютная классика',
  },
  herbarium: {
    description: 'Спокойные травяные оттенки для сезонных и домашних блюд.',
    mood: 'Натуральная',
  },
  provence: {
    description: 'Светлая лавандовая палитра для выпечки и неспешной кухни.',
    mood: 'Мягкая',
  },
  'tastory-dark': {
    description: 'Тёплая тёмная основа с розовым фирменным акцентом.',
    mood: 'Камерная',
  },
  midnight: {
    description: 'Холодные чернила и клетка для точных заметок и рецептур.',
    mood: 'Собранная',
  },
  coffeehouse: {
    description: 'Кофейные оттенки и лён для вечерней работы на кухне.',
    mood: 'Тёплая',
  },
  nordic: {
    description: 'Воздушная нейтральная тема с ясной современной типографикой.',
    mood: 'Минималистичная',
  },
  berry: {
    description: 'Светлая ягодная палитра для десертов и праздничных подборок.',
    mood: 'Нарядная',
  },
  'olive-cellar': {
    description: 'Глубокая зелёная тема для заготовок, трав и старых записей.',
    mood: 'Землистая',
  },
  'plum-night': {
    description: 'Сливовые тона и золотой акцент для личной вечерней тетради.',
    mood: 'Выразительная',
  },
} as const satisfies Record<ThemePresetId, { description: string; mood: string }>;

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
