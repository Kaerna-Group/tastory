import { useMemo, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import {
  THEME_PRESETS,
  applyThemePreferences,
  copyThemePreset,
  getThemePreferences,
  subscribeThemePreferences,
  themeContrast,
  themeCssVariables,
} from '@/shared/theme';
import type {
  FontPair,
  PaperStyle,
  ThemePalette,
  ThemePresetId,
  ThemeProfile,
  ThemeTarget,
} from '@/shared/theme';

const targets: ReadonlyArray<{ id: ThemeTarget; label: string; description: string }> = [
  { id: 'app', label: 'Приложение', description: 'Меню, библиотека и настройки' },
  { id: 'page', label: 'Страница рецепта', description: 'Бумага и карточки открытого рецепта' },
];
const fontNames: Record<FontPair, string> = {
  literary: 'Литературная — Georgia и Segoe UI',
  modern: 'Современная — Segoe UI и Arial',
  humanist: 'Рукописная — Palatino и Trebuchet',
};
const paperNames: Record<PaperStyle, string> = {
  plain: 'Чистая бумага',
  linen: 'Льняная фактура',
  dots: 'Точечная сетка',
  grid: 'Клетка',
};
const colorFields: ReadonlyArray<{ key: keyof ThemePalette; label: string }> = [
  { key: 'background', label: 'Фон' },
  { key: 'surface', label: 'Лист' },
  { key: 'text', label: 'Текст' },
  { key: 'muted', label: 'Доп. текст' },
  { key: 'border', label: 'Линии' },
  { key: 'primary', label: 'Кнопка' },
  { key: 'primaryText', label: 'Текст кнопки' },
  { key: 'accent', label: 'Акцент' },
];

export function ThemeBuilder(): React.JSX.Element {
  const preferences = useSyncExternalStore(subscribeThemePreferences, getThemePreferences);
  const [target, setTarget] = useState<ThemeTarget>('app');
  const [draft, setDraft] = useState<ThemeProfile>(preferences.app);
  const [preset, setPreset] = useState<ThemePresetId>('tastory-light');
  const [message, setMessage] = useState('');
  const contrast = useMemo(() => themeContrast(draft), [draft]);
  const previewStyle = useMemo(
    () =>
      ({
        ...themeCssVariables(draft),
        colorScheme: draft.mode,
      }) as CSSProperties,
    [draft],
  );
  const change = <K extends keyof ThemeProfile>(key: K, value: ThemeProfile[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const changeColor = (key: keyof ThemePalette, value: string) =>
    setDraft((current) => ({
      ...current,
      palette: { ...current.palette, [key]: value.toLowerCase() },
    }));
  const copyPreset = () => {
    const next = copyThemePreset(preset);
    setDraft({ ...next, name: `${next.name} — копия` });
    setMessage('Встроенная тема скопирована. Измените её и примените.');
  };
  const apply = () => {
    if (!contrast.passesAA || !draft.name.trim()) return;
    applyThemePreferences({
      ...preferences,
      [target]: { ...draft, name: draft.name.trim().slice(0, 40) },
    });
    setMessage(target === 'app' ? 'Тема приложения применена.' : 'Тема страниц применена.');
  };

  return (
    <section className="panel theme-builder" aria-labelledby="theme-builder-title">
      <div className="theme-builder-heading">
        <div>
          <p className="eyebrow">Оформление без кода</p>
          <h2 id="theme-builder-title">Конструктор тем</h2>
          <p className="muted">
            Создайте безопасную копию встроенной темы. Цвета и шрифты применяются без внешних файлов
            и произвольных стилей.
          </p>
        </div>
        <fieldset className="theme-targets">
          <legend>Что оформить</legend>
          {targets.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={target === item.id}
              onClick={() => {
                setTarget(item.id);
                setDraft(preferences[item.id]);
                setMessage('');
              }}
            >
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </button>
          ))}
        </fieldset>
      </div>

      <div className="theme-builder-layout">
        <div className="theme-controls">
          <div className="theme-preset-row">
            <label>
              Встроенная тема
              <select
                value={preset}
                onChange={(event) => setPreset(event.target.value as ThemePresetId)}
              >
                {Object.entries(THEME_PRESETS).map(([id, item]) => (
                  <option key={id} value={id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="button button-secondary" onClick={copyPreset}>
              Создать копию
            </button>
          </div>
          <div className="theme-meta-grid">
            <label>
              Название
              <input
                value={draft.name}
                maxLength={40}
                onChange={(event) => change('name', event.target.value)}
              />
            </label>
            <label>
              Режим элементов
              <select
                value={draft.mode}
                onChange={(event) => change('mode', event.target.value as ThemeProfile['mode'])}
              >
                <option value="light">Светлый</option>
                <option value="dark">Тёмный</option>
              </select>
            </label>
            <label>
              Шрифты
              <select
                value={draft.fontPair}
                onChange={(event) => change('fontPair', event.target.value as FontPair)}
              >
                {Object.entries(fontNames).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Бумага
              <select
                value={draft.paper}
                onChange={(event) => change('paper', event.target.value as PaperStyle)}
              >
                {Object.entries(paperNames).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="theme-colors">
            <legend>Палитра</legend>
            {colorFields.map((field) => (
              <label key={field.key}>
                <span>{field.label}</span>
                <input
                  type="color"
                  value={draft.palette[field.key]}
                  onChange={(event) => changeColor(field.key, event.target.value)}
                />
                <code>{draft.palette[field.key].toUpperCase()}</code>
              </label>
            ))}
          </fieldset>
        </div>

        <div className="theme-preview-column">
          <article
            className="theme-preview"
            data-paper={draft.paper}
            style={previewStyle}
            aria-label="Предпросмотр темы"
          >
            <p className="eyebrow">Семейный рецепт</p>
            <h3>Яблочный пирог</h3>
            <p>Тонкое тесто, яблоки и щепотка корицы.</p>
            <p className="muted">Подготовка · 20 минут</p>
            <div className="theme-preview-note">
              <strong>Первый шаг</strong>
              <span>Разогрейте духовку и подготовьте форму.</span>
            </div>
            <button type="button">Сохранить рецепт</button>
          </article>
          <section className="contrast-report" aria-labelledby="contrast-title">
            <div>
              <h3 id="contrast-title">Контраст WCAG</h3>
              <strong className={contrast.passesAA ? 'contrast-pass' : 'contrast-fail'}>
                {contrast.passesAA ? 'AA пройден' : 'Нужно исправить'}
              </strong>
            </div>
            <ul>
              {contrast.checks.map((check) => (
                <li key={check.id}>
                  <span>{check.label}</span>
                  <strong>{check.ratio.toFixed(2)}:1</strong>
                  <span>{check.ratio >= 4.5 ? 'Проходит' : 'Ниже 4.5'}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
      <div className="settings-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={!contrast.passesAA || !draft.name.trim()}
          onClick={apply}
        >
          {target === 'app' ? 'Применить к приложению' : 'Применить к страницам'}
        </button>
        {!contrast.passesAA && (
          <p role="alert" className="error-text">
            Подберите цвета так, чтобы все три сочетания имели контраст не ниже 4.5:1.
          </p>
        )}
        {message && <p role="status">{message}</p>}
      </div>
    </section>
  );
}
