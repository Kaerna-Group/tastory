import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import {
  LIBRARY_THEME_PRESET_IDS,
  QUICK_THEME_PRESET_IDS,
  THEME_PRESET_DETAILS,
  THEME_PRESETS,
  applyThemePreferences,
  contrastRatio,
  copyThemePreset,
  getThemePreferences,
  readCustomThemeLibrary,
  removeCustomTheme,
  saveCustomTheme,
  subscribeThemePreferences,
  themeContrast,
  themeCssVariables,
} from '@/shared/theme';
import type {
  CustomTheme,
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
const fontChoices: ReadonlyArray<{ id: FontPair; label: string; description: string }> = [
  { id: 'literary', label: 'Классика', description: 'Как в любимой кулинарной книге' },
  { id: 'modern', label: 'Современно', description: 'Просто и аккуратно' },
  { id: 'humanist', label: 'По-домашнему', description: 'Мягко и немного рукописно' },
];
const paperChoices: ReadonlyArray<{ id: PaperStyle; label: string }> = [
  { id: 'plain', label: 'Чистая' },
  { id: 'linen', label: 'Лён' },
  { id: 'dots', label: 'Точки' },
  { id: 'grid', label: 'Клетка' },
];
const detailColors: ReadonlyArray<{ value: string; label: string }> = [
  { value: '#a74459', label: 'Ягодный' },
  { value: '#426442', label: 'Травяной' },
  { value: '#765084', label: 'Лавандовый' },
  { value: '#376776', label: 'Морской' },
  { value: '#b45f35', label: 'Терракотовый' },
  { value: '#8a6500', label: 'Медовый' },
];
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
const presetIds = Object.keys(THEME_PRESETS) as ThemePresetId[];
type LibraryFilter = 'all' | 'light' | 'dark' | 'custom';

function sameProfile(first: ThemeProfile, second: ThemeProfile): boolean {
  return (
    first.name === second.name &&
    first.mode === second.mode &&
    first.fontPair === second.fontPair &&
    first.paper === second.paper &&
    colorFields.every(({ key }) => first.palette[key] === second.palette[key])
  );
}

function findPreset(profile: ThemeProfile): ThemePresetId | null {
  return presetIds.find((id) => sameProfile(profile, THEME_PRESETS[id])) ?? null;
}

function readThemeLibraryWithCurrent(profiles: ReadonlyArray<ThemeProfile>): CustomTheme[] {
  let library = readCustomThemeLibrary();
  for (const profile of profiles) {
    if (
      !findPreset(profile) &&
      themeContrast(profile).passesAA &&
      !library.some((theme) => sameProfile(theme.profile, profile))
    ) {
      saveCustomTheme(profile);
      library = readCustomThemeLibrary();
    }
  }
  return library;
}

type ThemeCardProps = Readonly<{
  profile: ThemeProfile;
  description: string;
  source: string;
  selected: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}>;

function ThemeCard({
  profile,
  description,
  source,
  selected,
  onSelect,
  onRemove,
}: ThemeCardProps): React.JSX.Element {
  const style = {
    ...themeCssVariables(profile),
    colorScheme: profile.mode,
  } as CSSProperties;
  return (
    <article
      className={`theme-card${selected ? ' theme-card-selected' : ''}`}
      data-mode={profile.mode}
      style={style}
    >
      <div className="theme-card-sample" aria-hidden="true">
        <span className="theme-card-sheet" />
        <span className="theme-card-line theme-card-line-wide" />
        <span className="theme-card-line" />
        <span className="theme-card-button" />
      </div>
      <div className="theme-card-copy">
        <div className="theme-card-meta">
          <span>{profile.mode === 'light' ? 'Светлая' : 'Тёмная'}</span>
          <span>{source}</span>
        </div>
        <h4>{profile.name}</h4>
        <p>{description}</p>
        <div className="theme-card-swatches" aria-label="Основные цвета темы">
          {[
            profile.palette.background,
            profile.palette.surface,
            profile.palette.primary,
            profile.palette.accent,
          ].map((color) => (
            <span key={color} style={{ backgroundColor: color }} />
          ))}
        </div>
      </div>
      <div className="theme-card-actions">
        <button type="button" className="button button-secondary" onClick={onSelect}>
          {selected ? `Тема ${profile.name} выбрана` : `Выбрать тему ${profile.name}`}
        </button>
        {onRemove && (
          <button
            type="button"
            className="theme-card-remove"
            aria-label={`Удалить тему ${profile.name}`}
            onClick={onRemove}
          >
            Удалить
          </button>
        )}
      </div>
    </article>
  );
}

export function ThemeBuilder(): React.JSX.Element {
  const preferences = useSyncExternalStore(subscribeThemePreferences, getThemePreferences);
  const [target, setTarget] = useState<ThemeTarget>('app');
  const [draft, setDraft] = useState<ThemeProfile>(preferences.app);
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>(() =>
    readThemeLibraryWithCurrent([preferences.app, preferences.page]),
  );
  const [selectedPreset, setSelectedPreset] = useState<ThemePresetId | null>(() =>
    findPreset(preferences.app),
  );
  const [selectedCustom, setSelectedCustom] = useState<string | null>(
    () => customThemes.find((theme) => sameProfile(theme.profile, preferences.app))?.id ?? null,
  );
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all');
  const [libraryQuery, setLibraryQuery] = useState('');
  const [message, setMessage] = useState('');
  const libraryTriggerRef = useRef<HTMLButtonElement>(null);
  const libraryDialogRef = useRef<HTMLElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const contrast = useMemo(() => themeContrast(draft), [draft]);
  const previewStyle = useMemo(
    () =>
      ({
        ...themeCssVariables(draft),
        colorScheme: draft.mode,
      }) as CSSProperties,
    [draft],
  );

  useEffect(() => {
    if (!libraryOpen) return undefined;
    const trigger = libraryTriggerRef.current;
    const controlDialog = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLibraryOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        libraryDialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', controlDialog);
    document.body.classList.add('theme-library-open');
    return () => {
      document.removeEventListener('keydown', controlDialog);
      document.body.classList.remove('theme-library-open');
      trigger?.focus();
    };
  }, [libraryOpen]);

  useEffect(() => {
    if (!moreOpen) return undefined;
    const closeMenu = (event: PointerEvent) => {
      if (!moreMenuRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMoreOpen(false);
        moreTriggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [moreOpen]);

  const change = <K extends keyof ThemeProfile>(key: K, value: ThemeProfile[K]) => {
    setSelectedPreset(null);
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const changeColor = (key: keyof ThemePalette, value: string) => {
    setSelectedPreset(null);
    setDraft((current) => ({
      ...current,
      palette: { ...current.palette, [key]: value.toLowerCase() },
    }));
  };
  const changeDetailColor = (value: string) => {
    const normalized = value.toLowerCase();
    const primaryText =
      contrastRatio('#ffffff', normalized) >= contrastRatio('#24191a', normalized)
        ? '#ffffff'
        : '#24191a';
    setSelectedPreset(null);
    setDraft((current) => ({
      ...current,
      palette: { ...current.palette, primary: normalized, primaryText },
    }));
  };
  const selectPreset = (id: ThemePresetId) => {
    const next = copyThemePreset(id);
    setDraft(next);
    setSelectedPreset(id);
    setSelectedCustom(null);
    setLibraryOpen(false);
    setMoreOpen(false);
    setAdvancedOpen(false);
    setMessage(`Тема «${next.name}» загружена в предпросмотр.`);
  };
  const selectCustomTheme = (theme: CustomTheme) => {
    setDraft({ ...theme.profile, palette: { ...theme.profile.palette } });
    setSelectedPreset(null);
    setSelectedCustom(theme.id);
    setLibraryOpen(false);
    setMoreOpen(false);
    setAdvancedOpen(false);
    setMessage(`Своя тема «${theme.profile.name}» загружена в предпросмотр.`);
  };
  const copyCurrent = () => {
    setDraft((current) => ({ ...current, name: `${current.name} — копия`.slice(0, 40) }));
    setSelectedPreset(null);
    setSelectedCustom(null);
    setMessage('Создана независимая копия. Измените её и сохраните в свою библиотеку.');
  };
  const normalizedDraft = (): ThemeProfile => ({
    ...draft,
    name: draft.name.trim().slice(0, 40),
    palette: { ...draft.palette },
  });
  const saveMine = () => {
    if (!contrast.passesAA || !draft.name.trim()) return;
    const profile = normalizedDraft();
    const ownProfile = selectedPreset
      ? { ...profile, name: `${profile.name} — моя`.slice(0, 40) }
      : profile;
    const saved = saveCustomTheme(
      ownProfile,
      selectedPreset ? undefined : (selectedCustom ?? undefined),
    );
    if (!saved) {
      setMessage('Не удалось сохранить тему в этом браузере. Предпросмотр остался доступен.');
      return;
    }
    setDraft(saved.profile);
    setSelectedPreset(null);
    setSelectedCustom(saved.id);
    setCustomThemes(readCustomThemeLibrary());
    setMessage(`Тема «${saved.profile.name}» сохранена в разделе «Мои темы».`);
  };
  const apply = () => {
    if (!contrast.passesAA || !draft.name.trim()) return;
    const profile = normalizedDraft();
    let librarySaved = true;
    if (!selectedPreset) {
      const saved = saveCustomTheme(profile, selectedCustom ?? undefined);
      librarySaved = Boolean(saved);
      if (saved) {
        setSelectedCustom(saved.id);
        setCustomThemes(readCustomThemeLibrary());
      }
    }
    applyThemePreferences({ ...preferences, [target]: profile });
    const area = target === 'app' ? 'приложения' : 'страниц';
    setMessage(
      librarySaved
        ? `Тема ${area} применена${selectedPreset ? '.' : ' и сохранена в «Моих темах».'}`
        : `Тема ${area} применена в текущей вкладке. Хранилище браузера недоступно.`,
    );
  };
  const removeMine = (theme: CustomTheme) => {
    if (!removeCustomTheme(theme.id)) {
      setMessage('Не удалось удалить тему из библиотеки этого браузера.');
      return;
    }
    if (selectedCustom === theme.id) setSelectedCustom(null);
    setCustomThemes(readCustomThemeLibrary());
    setMessage(
      `Тема «${theme.profile.name}» удалена из библиотеки. Применённое оформление не изменилось.`,
    );
  };
  const switchTarget = (nextTarget: ThemeTarget) => {
    const profile = preferences[nextTarget];
    setTarget(nextTarget);
    setDraft(profile);
    setSelectedPreset(findPreset(profile));
    setSelectedCustom(customThemes.find((item) => sameProfile(item.profile, profile))?.id ?? null);
    setMoreOpen(false);
    setAdvancedOpen(false);
    setMessage('');
  };

  const normalizedQuery = libraryQuery.trim().toLocaleLowerCase('ru');
  const matchesLibrary = (profile: ThemeProfile, description = '') =>
    (libraryFilter === 'all' || libraryFilter === 'custom' || profile.mode === libraryFilter) &&
    (!normalizedQuery ||
      `${profile.name} ${description}`.toLocaleLowerCase('ru').includes(normalizedQuery));
  const libraryPresets = LIBRARY_THEME_PRESET_IDS.filter(
    (id) =>
      libraryFilter !== 'custom' &&
      matchesLibrary(THEME_PRESETS[id], THEME_PRESET_DETAILS[id].description),
  );
  const libraryCustomThemes = customThemes.filter(
    (theme) =>
      (libraryFilter === 'all' ||
        libraryFilter === 'custom' ||
        theme.profile.mode === libraryFilter) &&
      (!normalizedQuery || theme.profile.name.toLocaleLowerCase('ru').includes(normalizedQuery)),
  );

  return (
    <section className="panel theme-builder" aria-labelledby="theme-builder-title">
      <div className="theme-builder-heading">
        <div>
          <p className="eyebrow">Оформление без кода</p>
          <h2 id="theme-builder-title">Конструктор тем</h2>
          <p className="muted">
            Шесть основных тем доступны сразу. Расширенная библиотека хранит ещё четыре встроенные
            темы и ваши собственные варианты.
          </p>
        </div>
        <fieldset className="theme-targets">
          <legend>Что оформить</legend>
          {targets.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={target === item.id}
              onClick={() => switchTarget(item.id)}
            >
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </button>
          ))}
        </fieldset>
      </div>

      <section className="theme-quick-section" aria-labelledby="quick-themes-title">
        <div className="theme-section-heading">
          <div>
            <p className="eyebrow">3 светлые · 3 тёмные</p>
            <h3 id="quick-themes-title">Быстрый выбор</h3>
          </div>
          <button
            ref={libraryTriggerRef}
            type="button"
            className="button button-secondary"
            onClick={() => setLibraryOpen(true)}
          >
            Открыть библиотеку тем
            <span className="theme-library-count">10 встроенных · {customThemes.length} своих</span>
          </button>
        </div>
        <div className="theme-quick-groups">
          {(['light', 'dark'] as const).map((mode) => (
            <div key={mode} className="theme-quick-group">
              <h4>{mode === 'light' ? 'Светлые темы' : 'Тёмные темы'}</h4>
              <div className="theme-card-grid theme-card-grid-quick">
                {QUICK_THEME_PRESET_IDS.filter((id) => THEME_PRESETS[id].mode === mode).map(
                  (id) => (
                    <ThemeCard
                      key={id}
                      profile={THEME_PRESETS[id]}
                      description={THEME_PRESET_DETAILS[id].description}
                      source={THEME_PRESET_DETAILS[id].mood}
                      selected={selectedPreset === id}
                      onSelect={() => selectPreset(id)}
                    />
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="theme-builder-layout">
        <div className="theme-controls">
          <div className="theme-current-row">
            <div>
              <span className="theme-current-label">Редактируется</span>
              <strong>{draft.name}</strong>
              <span>
                {selectedPreset ? 'Встроенная тема' : selectedCustom ? 'Моя тема' : 'Новая тема'}
              </span>
            </div>
            <div ref={moreMenuRef} className="theme-more">
              <button
                ref={moreTriggerRef}
                type="button"
                className="theme-more-button"
                aria-label="Дополнительные действия с темой"
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                onClick={() => setMoreOpen((open) => !open)}
              >
                ⋮
              </button>
              {moreOpen && (
                <div className="theme-more-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      copyCurrent();
                      setMoreOpen(false);
                    }}
                  >
                    <strong>Создать копию</strong>
                    <span>Сохранить исходную тему без изменений</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!contrast.passesAA || !draft.name.trim()}
                    onClick={() => {
                      saveMine();
                      setMoreOpen(false);
                    }}
                  >
                    <strong>{selectedCustom ? 'Обновить мою тему' : 'Сохранить в мои темы'}</strong>
                    <span>Добавить оформление в личную библиотеку</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAdvancedOpen((open) => !open);
                      setMoreOpen(false);
                    }}
                  >
                    <strong>{advancedOpen ? 'Скрыть точные настройки' : 'Точные настройки'}</strong>
                    <span>Все цвета, режим и проверка контраста</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <section className="theme-simple-controls" aria-labelledby="simple-theme-title">
            <div className="theme-simple-heading">
              <div>
                <p className="eyebrow">Легко изменить</p>
                <h3 id="simple-theme-title">Подстройте оформление под себя</h3>
              </div>
              <p className="muted">Изменения сразу появляются в примере справа.</p>
            </div>
            <label className="theme-friendly-name">
              Название оформления
              <input
                value={draft.name}
                maxLength={40}
                onChange={(event) => change('name', event.target.value)}
              />
            </label>

            <fieldset className="theme-friendly-colors">
              <legend>Цвет деталей</legend>
              <div className="theme-color-choices">
                {detailColors.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    aria-label={`Цвет деталей: ${color.label}`}
                    aria-pressed={draft.palette.primary === color.value}
                    onClick={() => changeDetailColor(color.value)}
                  >
                    <span style={{ backgroundColor: color.value }} />
                    {color.label}
                  </button>
                ))}
                <label className="theme-custom-color">
                  <input
                    type="color"
                    aria-label="Свой цвет деталей"
                    value={draft.palette.primary}
                    onChange={(event) => changeDetailColor(event.target.value)}
                  />
                  <span>Свой</span>
                </label>
              </div>
            </fieldset>

            <fieldset className="theme-choice-group">
              <legend>Стиль текста</legend>
              <div className="theme-choice-buttons theme-font-choices">
                {fontChoices.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    aria-pressed={draft.fontPair === choice.id}
                    onClick={() => change('fontPair', choice.id)}
                  >
                    <strong>{choice.label}</strong>
                    <span>{choice.description}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="theme-choice-group">
              <legend>Фактура страницы</legend>
              <div className="theme-choice-buttons theme-paper-choices">
                {paperChoices.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    aria-pressed={draft.paper === choice.id}
                    onClick={() => change('paper', choice.id)}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            </fieldset>
          </section>

          {advancedOpen && (
            <section className="theme-advanced" aria-labelledby="advanced-theme-title">
              <div className="theme-advanced-heading">
                <div>
                  <p className="eyebrow">Дополнительные функции</p>
                  <h3 id="advanced-theme-title">Точные настройки</h3>
                </div>
                <button
                  type="button"
                  className="theme-advanced-close"
                  onClick={() => setAdvancedOpen(false)}
                >
                  Скрыть
                </button>
              </div>
              <div className="theme-meta-grid theme-advanced-meta">
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
                  Точная пара шрифтов
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
                  Точная фактура
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
                <legend>Все цвета</legend>
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
              <section className="contrast-report" aria-labelledby="contrast-title">
                <div>
                  <h3 id="contrast-title">Читаемость текста</h3>
                  <strong className={contrast.passesAA ? 'contrast-pass' : 'contrast-fail'}>
                    {contrast.passesAA ? 'Всё хорошо' : 'Нужно исправить'}
                  </strong>
                </div>
                <ul>
                  {contrast.checks.map((check) => (
                    <li key={check.id}>
                      <span>{check.label}</span>
                      <strong>{check.ratio.toFixed(2)}:1</strong>
                      <span>{check.ratio >= 4.5 ? 'Читается' : 'Слишком бледно'}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </section>
          )}
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
        </div>
      </div>
      <div className="settings-actions theme-builder-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={!contrast.passesAA || !draft.name.trim()}
          onClick={apply}
        >
          {target === 'app' ? 'Применить оформление' : 'Оформить страницы рецептов'}
        </button>
        {!contrast.passesAA && (
          <p role="alert" className="error-text">
            Некоторые цвета плохо читаются.{' '}
            <button type="button" onClick={() => setAdvancedOpen(true)}>
              Исправить в точных настройках
            </button>
          </p>
        )}
        {message && <p role="status">{message}</p>}
      </div>

      {libraryOpen && (
        <div
          className="theme-library-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLibraryOpen(false);
          }}
        >
          <section
            ref={libraryDialogRef}
            className="theme-library-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="theme-library-title"
          >
            <div className="theme-library-header">
              <div>
                <p className="eyebrow">Каталог оформления</p>
                <h3 id="theme-library-title">Библиотека тем</h3>
                <p className="muted">
                  Четыре дополнительных встроенных варианта и все темы, которые вы создали сами.
                </p>
              </div>
              <button
                type="button"
                className="theme-library-close"
                aria-label="Закрыть библиотеку тем"
                autoFocus
                onClick={() => setLibraryOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="theme-library-tools">
              <label>
                <span>Поиск тем</span>
                <input
                  type="search"
                  value={libraryQuery}
                  placeholder="Название или настроение"
                  onChange={(event) => setLibraryQuery(event.target.value)}
                />
              </label>
              <fieldset className="theme-library-filters">
                <legend>Фильтр</legend>
                {(
                  [
                    ['all', 'Все'],
                    ['light', 'Светлые'],
                    ['dark', 'Тёмные'],
                    ['custom', `Мои (${customThemes.length})`],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={libraryFilter === id}
                    onClick={() => setLibraryFilter(id)}
                  >
                    {label}
                  </button>
                ))}
              </fieldset>
            </div>
            <div className="theme-library-scroll">
              {libraryPresets.length > 0 && (
                <section aria-labelledby="additional-themes-title">
                  <div className="theme-library-section-heading">
                    <h4 id="additional-themes-title">Дополнительные темы</h4>
                    <span>{libraryPresets.length}</span>
                  </div>
                  <div className="theme-card-grid">
                    {libraryPresets.map((id) => (
                      <ThemeCard
                        key={id}
                        profile={THEME_PRESETS[id]}
                        description={THEME_PRESET_DETAILS[id].description}
                        source={THEME_PRESET_DETAILS[id].mood}
                        selected={selectedPreset === id}
                        onSelect={() => selectPreset(id)}
                      />
                    ))}
                  </div>
                </section>
              )}
              {libraryCustomThemes.length > 0 && (
                <section aria-labelledby="custom-themes-title">
                  <div className="theme-library-section-heading">
                    <h4 id="custom-themes-title">Мои темы</h4>
                    <span>{libraryCustomThemes.length}</span>
                  </div>
                  <div className="theme-card-grid">
                    {libraryCustomThemes.map((theme) => (
                      <ThemeCard
                        key={theme.id}
                        profile={theme.profile}
                        description={`Сохранена ${new Intl.DateTimeFormat('ru', { dateStyle: 'medium' }).format(new Date(theme.updatedAt))}`}
                        source="Пользовательская"
                        selected={selectedCustom === theme.id}
                        onSelect={() => selectCustomTheme(theme)}
                        onRemove={() => removeMine(theme)}
                      />
                    ))}
                  </div>
                </section>
              )}
              {libraryPresets.length === 0 && libraryCustomThemes.length === 0 && (
                <div className="theme-library-empty">
                  <strong>Подходящих тем не найдено</strong>
                  <p>Измените запрос или сохраните собственную тему в конструкторе.</p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
