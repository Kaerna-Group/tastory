import { describe, expect, it } from 'vitest';
import { defaultThemePreferences, parseThemePreferences, themeCssVariables } from './theme';
import { THEME_PRESETS, contrastRatio, themeContrast } from './theme-builder-model';

describe('theme builder model', () => {
  it('keeps every built-in palette above the WCAG AA contrast floor', () => {
    for (const theme of Object.values(THEME_PRESETS)) {
      const report = themeContrast(theme);
      expect(
        report.checks.map(({ id, ratio }) => ({ id, ratio: Number(ratio.toFixed(2)) })),
      ).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'text' })]));
      expect(report.passesAA, theme.name).toBe(true);
    }
  });

  it('uses the WCAG relative luminance formula', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 4);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.478, 2);
    expect(contrastRatio('red', '#ffffff')).toBe(1);
  });

  it('restores only bounded colors, fonts and paper values', () => {
    const safe = defaultThemePreferences('dark');
    expect(parseThemePreferences(safe)).toEqual(safe);
    expect(
      parseThemePreferences({
        ...safe,
        app: { ...safe.app, palette: { ...safe.app.palette, background: 'url(example)' } },
      }),
    ).toBeNull();
    expect(
      parseThemePreferences({ ...safe, page: { ...safe.page, fontPair: 'remote-font' } }),
    ).toBeNull();
  });

  it('maps a theme to the shared application tokens without CSS or URLs', () => {
    const variables = themeCssVariables(THEME_PRESETS.herbarium);
    expect(variables).toMatchObject({
      '--app-background': '#eef0e7',
      '--app-primary': '#426442',
    });
    expect(Object.values(variables).join(' ')).not.toMatch(/url\(|https?:/);
  });
});
