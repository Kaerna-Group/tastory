import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { RecipePageRenderer } from '@/entities/recipe-page';
import { requestSessionRecipes, acquireRecipePhoto } from '@/entities/session';
import { env } from '@/shared/config';
import { defaultThemePreferences, themeCssVariables } from '@/shared/theme';
import { getUserSettings, subscribeUserSettings } from '@/entities/user-settings';
import {
  draftKey,
  draftScope,
  listDrafts,
  newDraft,
  writeDraft,
  removeDraft,
  isDraftVolatile,
} from '../model/drafts';
import type { RecipeLocalDraft, RecipeSummary } from '../model/drafts';
import { readLibraryQuery, selectLibraryRecipes, writeLibraryQuery } from '../model/library';
import type { LibraryQuery } from '../model/library';
import { cacheRecentLibrary, readRecentLibrary } from '../model/recent-recipes';

const DEMO_RECIPE_ID = '10000000-0000-4000-8000-000000000008';
const DEMO_RECIPE = {
  content: {
    title: 'Яблочный пирог для воскресенья',
    description: 'Тонкое тесто, кислые яблоки и семейная заметка на полях.',
    servings: 8,
    prepMinutes: 25,
    cookMinutes: 45,
    sourceUrl: '',
    notes: 'Подавать чуть тёплым. На следующий день корочка остаётся хрустящей.',
  },
  ingredients: [
    {
      key: 'demo-apples',
      sectionTitle: 'Начинка',
      position: 0,
      name: 'Кислые яблоки',
      quantityValue: 5,
      quantityText: '',
      unit: 'шт.',
      note: '',
      isOptional: false,
    },
    {
      key: 'demo-flour',
      sectionTitle: 'Тесто',
      position: 1,
      name: 'Мука',
      quantityValue: 240,
      quantityText: '',
      unit: 'г',
      note: '',
      isOptional: false,
    },
  ],
  steps: [
    {
      key: 'demo-step-1',
      sectionTitle: '',
      position: 0,
      body: 'Нарежьте яблоки тонкими дольками и смешайте с корицей.',
      durationSeconds: null,
    },
    {
      key: 'demo-step-2',
      sectionTitle: '',
      position: 1,
      body: 'Выложите начинку на тесто и выпекайте до золотистой корочки.',
      durationSeconds: 2700,
    },
  ],
  tagIds: [],
};
const DEMO_THEME = defaultThemePreferences('light').page;

function readIntroDismissed(key: string) {
  try {
    return localStorage.getItem(key) === 'dismissed';
  } catch {
    return false;
  }
}

function RecipeThumbnail({ recipe, href }: { recipe: RecipeSummary; href: string }) {
  const root = useRef<HTMLAnchorElement>(null);
  const [nearby, setNearby] = useState(() => typeof IntersectionObserver === 'undefined');
  const [loaded, setLoaded] = useState<{ photoId: string; source: string } | null>(null);
  const source = nearby && loaded?.photoId === recipe.coverPhotoId ? loaded.source : '';
  useEffect(() => {
    const element = root.current;
    if (!element || !recipe.coverPhotoId) return;
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      (entries) => setNearby(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: '320px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [recipe.coverPhotoId]);
  useEffect(() => {
    if (!recipe.coverPhotoId || !nearby) return;
    let cancelled = false;
    const photoId = recipe.coverPhotoId;
    const lease = acquireRecipePhoto(recipe.id, { id: photoId }, 'thumbnail');
    void lease.promise
      .then((source) => {
        if (!cancelled) setLoaded({ photoId, source });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      lease.release();
    };
  }, [nearby, recipe.coverPhotoId, recipe.id]);
  return (
    <Link
      ref={root}
      className="library-recipe-cover-link"
      to={href}
      aria-label={`Открыть рецепт «${recipe.title}»`}
      data-thumbnail-state={!recipe.coverPhotoId ? 'empty' : source ? 'ready' : 'idle'}
    >
      {source ? (
        <img className="library-recipe-cover" src={source} alt="" loading="lazy" decoding="async" />
      ) : (
        <div className="library-recipe-cover library-recipe-cover-empty" aria-hidden="true">
          <span>⌁</span>
          <i />
          <i />
          <i />
        </div>
      )}
    </Link>
  );
}

function recipeTime(recipe: RecipeSummary) {
  if (recipe.prepMinutes === null && recipe.cookMinutes === null) return '';
  const minutes = (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0);
  if (minutes < 60) return `${minutes} мин`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} ч${rest ? ` ${rest} мин` : ''}`;
}

function FirstRecipeGuide({
  canCreate,
  onCreate,
  onDismiss,
}: {
  canCreate: boolean;
  onCreate: () => void;
  onDismiss: () => void;
}) {
  const style = {
    ...themeCssVariables(DEMO_THEME),
    colorScheme: DEMO_THEME.mode,
  } as CSSProperties;
  return (
    <section className="first-recipe-guide" aria-labelledby="first-recipe-title">
      <div className="first-recipe-copy">
        <div className="first-recipe-label">
          <span>Демонстрационный рецепт</span>
          <button type="button" className="text-link" onClick={onDismiss}>
            Скрыть знакомство
          </button>
        </div>
        <p className="eyebrow">Так выглядит готовая страница</p>
        <h2 id="first-recipe-title">Соберите свою кулинарную книгу</h2>
        <p>
          Рецепт начинается с привычных полей, получает книжный макет и остаётся удобным для чтения
          и печати. Этот пример живёт только в браузере и ничего не записывает на сервер.
        </p>
        <ol className="first-recipe-steps" aria-label="Основной путь создания рецепта">
          <li>
            <span>1</span>Добавить рецепт
          </li>
          <li>
            <span>2</span>Заполнить содержание
          </li>
          <li>
            <span>3</span>Выбрать макет
          </li>
          <li>
            <span>4</span>Открыть просмотр
          </li>
        </ol>
        {canCreate && (
          <button type="button" className="button button-primary" onClick={onCreate}>
            Создать первый рецепт
          </button>
        )}
      </div>
      <div
        className="first-recipe-preview recipe-presentation-theme"
        data-paper={DEMO_THEME.paper}
        data-mode={DEMO_THEME.mode}
        style={style}
        aria-label="Локальный пример готовой страницы"
      >
        <RecipePageRenderer
          recipeId={DEMO_RECIPE_ID}
          recipeRevision={null}
          templateId={null}
          templateRevision={1}
          templateName="Домашняя страница"
          layout="hearth"
          tagNames={['Выпечка', 'Семейное']}
          value={DEMO_RECIPE}
          compact
        />
      </div>
    </section>
  );
}

export function RecipeLibrary({
  subject,
  writer,
  owner,
}: {
  subject: string;
  writer: boolean;
  owner: boolean;
}) {
  const navigate = useNavigate();
  const preferences = useSyncExternalStore(subscribeUserSettings, getUserSettings).settings;
  const [searchParams, setSearchParams] = useSearchParams();
  const query = useMemo(() => readLibraryQuery(searchParams), [searchParams]);
  const scope = draftScope(env.apiUrl || 'mock', subject);
  const [drafts, setDrafts] = useState<RecipeLocalDraft[]>([]);
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [error, setError] = useState('');
  const [localError, setLocalError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [notReady, setNotReady] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [favoriteBusy, setFavoriteBusy] = useState<string | null>(null);
  const introKey = `tastory.library-intro.v1:${encodeURIComponent(scope)}`;
  const [introDismissed, setIntroDismissed] = useState(() => readIntroDismissed(introKey));
  const selectedRecipes = useMemo(() => selectLibraryRecipes(recipes, query), [recipes, query]);
  const tags = useMemo(() => {
    const values = new Map<string, string>();
    for (const recipe of recipes) for (const tag of recipe.tags) values.set(tag.id, tag.name);
    return [...values].sort((a, b) => a[1].localeCompare(b[1], 'ru'));
  }, [recipes]);
  const updateQuery = (patch: Partial<LibraryQuery>) =>
    setSearchParams(writeLibraryQuery({ ...query, ...patch }), { replace: true });
  useEffect(() => {
    const controller = new AbortController();
    function refreshLocal() {
      try {
        const result = listDrafts(localStorage, scope);
        setDrafts(result.drafts);
        setLocalError(
          result.damaged
            ? 'Некоторые локальные копии повреждены или созданы другой версией приложения. Они сохранены в браузере без изменений.'
            : '',
        );
      } catch {
        setLocalError(
          'Локальное хранилище недоступно. Разрешите хранение данных сайта, чтобы создавать черновики.',
        );
      }
    }
    refreshLocal();
    window.addEventListener('storage', refreshLocal);
    void requestSessionRecipes(
      { action: 'recipes.list', payload: {} },
      crypto.randomUUID(),
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted && result.kind === 'recipes') {
          setRecipes(result.recipes);
          try {
            cacheRecentLibrary(localStorage, scope, result.recipes);
          } catch {
            // The current server result remains usable when optional offline caching is full.
          }
          setError('');
          setNotReady(false);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          if (error?.code === 'RECIPE_NOT_READY' && owner) {
            setNotReady(true);
            setError(
              'Хранилище рецептов ещё не подготовлено. Запуск требует явного подтверждения.',
            );
            return;
          }
          const recent = readRecentLibrary(localStorage, scope);
          if (recent.length > 0) {
            setRecipes(recent);
            setError(
              navigator.onLine
                ? 'Сервер недоступен — показаны недавние рецепты с этого устройства.'
                : 'Нет сети — показаны недавние рецепты с этого устройства.',
            );
            setNotReady(false);
          } else {
            setError('Не удалось загрузить рецепты с сервера. Локальные черновики доступны ниже.');
            setNotReady(error?.code === 'RECIPE_NOT_READY');
          }
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      window.removeEventListener('storage', refreshLocal);
    };
  }, [scope, attempt, owner]);
  const create = () => {
    try {
      const draft = newDraft(scope, crypto.randomUUID(), null, preferences.defaultVisibility);
      writeDraft(localStorage, draft);
      void navigate(`/drafts/${draft.id}`);
    } catch {
      setLocalError(
        'Не удалось создать локальную копию. Освободите место или разрешите хранение данных сайта.',
      );
    }
  };
  const initialize = async () => {
    setInitializing(true);
    try {
      await requestSessionRecipes(
        { action: 'admin.recipes.initialize', payload: {} },
        crypto.randomUUID(),
      );
      setAttempt((value) => value + 1);
    } catch {
      setError('Не удалось подготовить хранение рецептов. Проверьте подключение и повторите.');
    } finally {
      setInitializing(false);
    }
  };
  const dismissIntro = () => {
    setIntroDismissed(true);
    try {
      localStorage.setItem(introKey, 'dismissed');
    } catch {
      // Dismissal is optional; the guide can reappear if browser storage is unavailable.
    }
  };
  const remove = async (id: string) => {
    try {
      if (!navigator.locks) throw new Error();
      await navigator.locks.request(draftKey(scope, id), { ifAvailable: true }, (lock) => {
        if (!lock) throw new Error();
        removeDraft(localStorage, scope, id);
        setDrafts((value) => value.filter((draft) => draft.id !== id));
        setRemoveId(null);
      });
    } catch {
      setLocalError('Не удалось удалить копию. Закройте её в другой вкладке и повторите.');
    }
  };
  const setFavorite = async (recipe: RecipeSummary) => {
    const favorite = !recipe.favorite;
    setFavoriteBusy(recipe.id);
    setRecipes((value) =>
      value.map((item) => (item.id === recipe.id ? { ...item, favorite } : item)),
    );
    try {
      await requestSessionRecipes(
        { action: 'recipes.favorite.set', payload: { recipeId: recipe.id, favorite } },
        crypto.randomUUID(),
      );
    } catch {
      setRecipes((value) =>
        value.map((item) =>
          item.id === recipe.id ? { ...item, favorite: recipe.favorite } : item,
        ),
      );
      setError('Не удалось изменить избранное. Повторите попытку.');
    } finally {
      setFavoriteBusy(null);
    }
  };
  return (
    <>
      <div className="library-actions">
        {writer && (
          <button className="button button-primary" type="button" onClick={create}>
            Новый рецепт
          </button>
        )}
        <button
          className="button button-secondary"
          type="button"
          onClick={() => {
            setLoading(true);
            setAttempt((value) => value + 1);
          }}
        >
          Обновить библиотеку
        </button>
      </div>
      {localError && (
        <p role="alert" className="recipe-notice">
          {localError}
        </p>
      )}
      {error && (
        <p role="alert" className="recipe-notice">
          {error}
        </p>
      )}
      {notReady && owner && (
        <section className="panel recipe-section">
          <h2>Подготовка тетради</h2>
          <p>Создайте хранилище рецептов на подключённом сервере, чтобы включить сохранение.</p>
          <button
            type="button"
            disabled={initializing}
            className="button button-secondary"
            onClick={() => {
              void initialize();
            }}
          >
            Подготовить хранение рецептов
          </button>
        </section>
      )}
      {!loading && recipes.length === 0 && drafts.length === 0 && !introDismissed && (
        <FirstRecipeGuide canCreate={writer} onCreate={create} onDismiss={dismissIntro} />
      )}
      {drafts.length > 0 && (
        <section className="recipe-section" aria-labelledby="local-drafts-title">
          <h2 id="local-drafts-title">На этом устройстве</h2>
          <p className="muted">
            Копии доступны после входа в тот же аккаунт. Черновики с очередью продолжат отправку при
            открытии.
          </p>
          <div className="recipe-cards">
            {drafts.map((draft) => (
              <article className="panel recipe-card" key={draft.id}>
                <p className="eyebrow">
                  {isDraftVolatile(scope, draft.id)
                    ? 'Нужно скачать копию'
                    : draft.conflict
                      ? 'Нужно выбрать версию'
                      : draft.pending || draft.editVersion !== draft.savedVersion
                        ? 'Локальный черновик'
                        : 'Сохранённая копия'}
                </p>
                <h3>
                  <Link to={`/drafts/${draft.id}`}>
                    {draft.value.content.title || 'Без названия'}
                  </Link>
                </h3>
                <p className="muted text-sm">{new Date(draft.updatedAt).toLocaleString('ru')}</p>
                {!draft.pending &&
                  (removeId === draft.id ? (
                    <div>
                      <p>
                        Удалить копию с этого устройства? Несохранённые правки будут потеряны.
                        Рецепт на сервере останется.
                      </p>
                      <div className="recipe-row-actions">
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => {
                            void remove(draft.id);
                          }}
                        >
                          Удалить копию
                        </button>
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => setRemoveId(null)}
                        >
                          Отмена
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => setRemoveId(draft.id)}
                    >
                      Убрать с устройства
                    </button>
                  ))}
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="recipe-section" aria-labelledby="server-recipes-title">
        <div className="library-heading">
          <div>
            <h2 id="server-recipes-title">Рецепты в тетради</h2>
            {!loading && recipes.length > 0 && (
              <p className="muted text-sm">
                Найдено: {selectedRecipes.length} из {recipes.length}
              </p>
            )}
          </div>
          <div className="library-view-switch" aria-label="Вид библиотеки">
            <button
              type="button"
              aria-pressed={query.view === 'grid'}
              onClick={() => updateQuery({ view: 'grid' })}
            >
              Сетка
            </button>
            <button
              type="button"
              aria-pressed={query.view === 'list'}
              onClick={() => updateQuery({ view: 'list' })}
            >
              Список
            </button>
          </div>
        </div>
        {loading && <p role="status">Загружаем библиотеку…</p>}
        {!loading && recipes.length === 0 && (introDismissed || drafts.length > 0) && (
          <div className="notebook">
            <h3>Всё начинается с одного рецепта</h3>
            <p className="muted">Запишите любимое блюдо — правки сохраняются автоматически.</p>
          </div>
        )}
        {!loading && recipes.length > 0 && (
          <div className="library-filters">
            <label className="library-search">
              <span>Поиск</span>
              <input
                type="search"
                value={query.q}
                placeholder="Название или ингредиент"
                onChange={(event) => updateQuery({ q: event.target.value.slice(0, 100) })}
              />
            </label>
            <label>
              <span>Состояние</span>
              <select
                value={query.status}
                onChange={(event) =>
                  updateQuery({ status: event.target.value as LibraryQuery['status'] })
                }
              >
                <option value="current">Текущие</option>
                <option value="archived">Архив</option>
                <option value="all">Все</option>
              </select>
            </label>
            <label>
              <span>Доступ</span>
              <select
                value={query.visibility}
                onChange={(event) =>
                  updateQuery({ visibility: event.target.value as LibraryQuery['visibility'] })
                }
              >
                <option value="all">Любой</option>
                <option value="private">Личные</option>
                <option value="workspace">Общие</option>
              </select>
            </label>
            <label>
              <span>Тег</span>
              <select
                value={query.tag}
                onChange={(event) => updateQuery({ tag: event.target.value })}
              >
                <option value="">Любой</option>
                {tags.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Сортировка</span>
              <select
                value={query.sort}
                onChange={(event) =>
                  updateQuery({ sort: event.target.value as LibraryQuery['sort'] })
                }
              >
                <option value="updated-desc">Сначала новые</option>
                <option value="updated-asc">Сначала старые</option>
                <option value="title-asc">Название А–Я</option>
                <option value="title-desc">Название Я–А</option>
              </select>
            </label>
            <label className="library-favorite-filter">
              <input
                type="checkbox"
                checked={query.favorite}
                onChange={(event) => updateQuery({ favorite: event.target.checked })}
              />
              Только избранное
            </label>
          </div>
        )}
        {!loading && recipes.length > 0 && selectedRecipes.length === 0 && (
          <div className="notebook">
            <h3>Ничего не найдено</h3>
            <p className="muted">Измените запрос или сбросьте фильтры.</p>
            <button
              type="button"
              className="text-link"
              onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}
            >
              Сбросить фильтры
            </button>
          </div>
        )}
        <div className="library-recipe-results" data-view={query.view}>
          {selectedRecipes.map((recipe) => {
            const draft = drafts.find((item) => item.base?.recipe.id === recipe.id);
            const href = draft ? `/drafts/${draft.id}` : `/recipes/${recipe.id}`;
            const duration = recipeTime(recipe);
            return (
              <article key={recipe.id} className="panel recipe-card library-recipe-card">
                <RecipeThumbnail recipe={recipe} href={href} />
                <div className="library-recipe-copy">
                  <div className="library-recipe-meta">
                    <p className="eyebrow">
                      {recipe.status === 'archived'
                        ? 'В архиве'
                        : recipe.visibility === 'private'
                          ? 'Личный рецепт'
                          : 'Общий рецепт'}
                    </p>
                    <button
                      type="button"
                      className="library-favorite-button"
                      aria-label={recipe.favorite ? 'Убрать из избранного' : 'Добавить в избранное'}
                      aria-pressed={recipe.favorite}
                      disabled={favoriteBusy === recipe.id}
                      onClick={() => void setFavorite(recipe)}
                    >
                      {recipe.favorite ? '★' : '☆'}
                    </button>
                  </div>
                  <h3>
                    <Link to={href}>{recipe.title}</Link>
                  </h3>
                  {recipe.description && <p className="muted">{recipe.description}</p>}
                  {(duration || recipe.servings !== null) && (
                    <ul className="library-recipe-facts" aria-label="Кратко о рецепте">
                      {duration && <li>◷ {duration}</li>}
                      {recipe.servings !== null && <li>{recipe.servings} порц.</li>}
                    </ul>
                  )}
                  {recipe.ingredientNames.length > 0 && (
                    <p className="library-ingredients">
                      {recipe.ingredientNames.slice(0, 4).join(' · ')}
                    </p>
                  )}
                  {recipe.tags.length > 0 && (
                    <div className="library-tags">
                      {recipe.tags.map((tag) => (
                        <span key={tag.id}>{tag.name}</span>
                      ))}
                    </div>
                  )}
                  <p className="muted text-sm">
                    Обновлён {new Date(recipe.updatedAt).toLocaleDateString('ru')}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}
