import { useCallback, useEffect, useMemo, useState } from 'react';
import { RecipePageRenderer } from '@/entities/recipe-page';
import type { RecipeDraftValue } from '../model/drafts';
import { BUILTIN_RECIPE_TEMPLATES } from '../model/templates';
import type {
  RecipeTemplate,
  RecipeTemplateCategory,
  RecipeTemplateLayout,
  RecipeTemplateView,
  TemplateCommand,
} from '../model/templates';
import { requestSessionTemplates } from '@/entities/session';
import './recipe-templates.css';

const CATEGORY_LABELS: Record<RecipeTemplateCategory, string> = {
  dish: 'Блюда',
  drink: 'Напитки',
};
const LAYOUT_LABELS = Object.fromEntries(
  BUILTIN_RECIPE_TEMPLATES.map((template) => [template.layout, template.name]),
) as Record<RecipeTemplateLayout, string>;
type LibraryScope = 'all' | 'dish' | 'drink' | 'mine' | 'community';

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : 'Не удалось обновить библиотеку шаблонов.';
}

function TemplateCard({
  item,
  recipeId,
  recipeRevision,
  value,
  selected,
  busy,
  editable,
  onApply,
  onCopy,
  onUpdate,
  onArchive,
  onRestore,
}: {
  item: RecipeTemplateView;
  recipeId: string;
  recipeRevision: number;
  value: RecipeDraftValue;
  selected: boolean;
  busy: boolean;
  editable: boolean;
  onApply: (item: RecipeTemplateView) => void;
  onCopy: (item: RecipeTemplateView) => void;
  onUpdate: (
    item: RecipeTemplateView,
    value: {
      name: string;
      description: string;
      layout: RecipeTemplateLayout;
      visibility: 'private' | 'workspace';
    },
  ) => void;
  onArchive: (item: RecipeTemplateView) => void;
  onRestore: (item: RecipeTemplateView) => void;
}) {
  const { template } = item;
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(template.name);
  const [editDescription, setEditDescription] = useState(template.description);
  const [editLayout, setEditLayout] = useState(template.layout);
  const [editVisibility, setEditVisibility] = useState(template.visibility);
  return (
    <article className={`template-card${selected ? ' template-card-selected' : ''}`}>
      <RecipePageRenderer
        recipeId={recipeId}
        recipeRevision={recipeRevision}
        templateId={template.id}
        templateRevision={template.revision}
        templateName={template.name}
        layout={template.layout}
        tagNames={[]}
        value={value}
        compact
      />
      <div className="template-card-copy">
        <div>
          <span className="eyebrow">{CATEGORY_LABELS[template.category]}</span>
          <h3>{template.name}</h3>
          <p>{template.description}</p>
        </div>
        <p className="template-card-author">
          {template.kind === 'builtin' ? 'Tastory' : `Автор: ${item.authorName}`}
          {template.visibility === 'private' && ' · личный'}
          {template.status === 'archived' && ' · в архиве'}
        </p>
        <div className="recipe-row-actions">
          {template.status === 'active' && editable && (
            <button
              className="button button-primary"
              type="button"
              disabled={busy}
              onClick={() => onApply(item)}
            >
              {selected ? 'Применить снова' : 'Применить'}
            </button>
          )}
          {template.status === 'active' && item.canCopy && (
            <button
              className="button button-secondary"
              type="button"
              disabled={busy}
              onClick={() => onCopy(item)}
            >
              Сохранить себе
            </button>
          )}
          {item.canManage && template.kind === 'custom' && (
            <details className="template-card-more">
              <summary aria-label={`Дополнительные действия: ${template.name}`}>•••</summary>
              <div className="template-card-more-menu">
                {template.status === 'active' && (
                  <button type="button" disabled={busy} onClick={() => setEditing(true)}>
                    Изменить
                  </button>
                )}
                {template.status === 'active' ? (
                  <button type="button" disabled={busy} onClick={() => onArchive(item)}>
                    Убрать в архив
                  </button>
                ) : (
                  <button type="button" disabled={busy} onClick={() => onRestore(item)}>
                    Восстановить
                  </button>
                )}
              </div>
            </details>
          )}
        </div>
        {editing && (
          <form
            className="template-card-edit"
            onSubmit={(event) => {
              event.preventDefault();
              onUpdate(item, {
                name: editName,
                description: editDescription,
                layout: editLayout,
                visibility: editVisibility,
              });
              setEditing(false);
            }}
          >
            <label>
              Название шаблона
              <input
                required
                maxLength={80}
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
              />
            </label>
            <label>
              Основа шаблона
              <select
                value={editLayout}
                onChange={(event) => setEditLayout(event.target.value as RecipeTemplateLayout)}
              >
                {BUILTIN_RECIPE_TEMPLATES.map((option) => (
                  <option key={option.layout} value={option.layout}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Описание шаблона
              <textarea
                rows={2}
                maxLength={240}
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
              />
            </label>
            <label>
              Доступ к шаблону
              <select
                value={editVisibility}
                onChange={(event) =>
                  setEditVisibility(event.target.value === 'workspace' ? 'workspace' : 'private')
                }
              >
                <option value="private">Только мне</option>
                <option value="workspace">Поделиться с участниками</option>
              </select>
            </label>
            <div className="recipe-row-actions">
              <button className="button button-primary" type="submit" disabled={busy}>
                Сохранить изменения
              </button>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setEditing(false)}
              >
                Отмена
              </button>
            </div>
          </form>
        )}
      </div>
    </article>
  );
}

export function RecipeTemplates({
  recipeId,
  recipeRevision,
  value,
  editable,
}: {
  recipeId: string;
  recipeRevision: number;
  value: RecipeDraftValue;
  editable: boolean;
}) {
  const [items, setItems] = useState<RecipeTemplateView[]>([]);
  const [applied, setApplied] = useState<RecipeTemplate | null>(null);
  const [scope, setScope] = useState<LibraryScope>('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [layout, setLayout] = useState<RecipeTemplateLayout>('hearth');
  const [visibility, setVisibility] = useState<'private' | 'workspace'>('private');

  const fetchTemplates = useCallback(
    async (signal?: AbortSignal) => {
      const [library, current] = await Promise.all([
        requestSessionTemplates(
          {
            action: 'templates.list',
            payload: { query: '', category: 'all', scope: 'all', includeArchived: true },
          },
          crypto.randomUUID(),
          signal,
        ),
        requestSessionTemplates(
          { action: 'recipes.template.get', payload: { recipeId } },
          crypto.randomUUID(),
          signal,
        ),
      ]);
      if (library.kind !== 'templateLibrary' || current.kind !== 'recipeTemplate')
        throw new Error('Сервер вернул несовместимую библиотеку шаблонов.');
      return { items: library.templates, applied: current.template };
    },
    [recipeId],
  );

  useEffect(() => {
    const next = new AbortController();
    void fetchTemplates(next.signal)
      .then((result) => {
        if (next.signal.aborted) return;
        setItems(result.items);
        setApplied(result.applied);
      })
      .catch((cause) => {
        if (!next.signal.aborted) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!next.signal.aborted) setLoading(false);
      });
    return () => next.abort();
  }, [fetchTemplates]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ru');
    return items.filter((item) => {
      const template = item.template;
      if (template.status === 'archived' && scope !== 'mine') return false;
      if (scope === 'dish' && template.category !== 'dish') return false;
      if (scope === 'drink' && template.category !== 'drink') return false;
      if (scope === 'mine' && !item.canManage) return false;
      if (scope === 'community' && (!item.canCopy || template.kind !== 'custom')) return false;
      return (
        !needle ||
        `${template.name} ${template.description} ${item.authorName}`
          .toLocaleLowerCase('ru')
          .includes(needle)
      );
    });
  }, [items, query, scope]);

  async function mutate(command: TemplateCommand, success: string) {
    if (busy) return false;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await requestSessionTemplates(command, crypto.randomUUID());
      if (result.kind === 'recipeTemplate') setApplied(result.template);
      const refreshed = await fetchTemplates();
      setItems(refreshed.items);
      setApplied(refreshed.applied);
      setNotice(success);
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const selectedLayout = applied?.layout ?? 'hearth';

  return (
    <section className="panel recipe-templates" aria-labelledby="recipe-templates-title">
      <header className="template-heading">
        <div>
          <p className="eyebrow">Оформление рецепта</p>
          <h2 id="recipe-templates-title">Шаблоны страниц</h2>
          <p>
            Выберите готовую композицию. Цвета и шрифты возьмутся из вашей темы, а содержание
            рецепта останется на месте.
          </p>
        </div>
        {applied && <span className="template-current">Сейчас: {applied.templateName}</span>}
      </header>

      <div className="template-stage" aria-label={`Предпросмотр: ${LAYOUT_LABELS[selectedLayout]}`}>
        <RecipePageRenderer
          recipeId={recipeId}
          recipeRevision={recipeRevision}
          templateId={applied?.templateId ?? null}
          templateRevision={applied?.revision ?? 1}
          templateName={applied?.templateName ?? LAYOUT_LABELS[selectedLayout]}
          layout={selectedLayout}
          tagNames={[]}
          value={value}
        />
      </div>

      {notice && (
        <p className="template-notice template-notice-success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="template-notice template-notice-error" role="alert">
          {error}
        </p>
      )}

      <div className="template-library-heading">
        <div>
          <h3>Библиотека</h3>
          <p className="muted text-sm">10 готовых вариантов и сохранённые шаблоны участников.</p>
        </div>
        <label className="template-search">
          <span className="sr-only">Поиск шаблонов</span>
          <input
            value={query}
            maxLength={100}
            placeholder="Найти шаблон"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="template-filters" role="group" aria-label="Разделы библиотеки">
        {(
          [
            ['all', 'Все'],
            ['dish', 'Блюда'],
            ['drink', 'Напитки'],
            ['mine', 'Мои'],
            ['community', 'От участников'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={scope === id ? 'is-active' : ''}
            aria-pressed={scope === id}
            onClick={() => setScope(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <p role="status">Открываем библиотеку…</p>
      ) : visible.length ? (
        <div className="template-grid">
          {visible.map((item) => (
            <TemplateCard
              key={item.template.id}
              item={item}
              recipeId={recipeId}
              recipeRevision={recipeRevision}
              value={value}
              selected={applied?.templateId === item.template.id}
              busy={busy}
              editable={editable}
              onApply={(selected) =>
                void mutate(
                  {
                    action: 'recipes.template.apply',
                    payload: {
                      recipeId,
                      expectedRecipeRevision: recipeRevision,
                      templateId: selected.template.id,
                    },
                  },
                  `Шаблон «${selected.template.name}» применён.`,
                )
              }
              onCopy={(selected) =>
                void mutate(
                  {
                    action: 'templates.clone',
                    payload: {
                      templateId: selected.template.id,
                      expectedRevision: selected.template.revision,
                      visibility: 'private',
                    },
                  },
                  `Шаблон «${selected.template.name}» сохранён в вашей библиотеке.`,
                )
              }
              onUpdate={(selected, next) =>
                void mutate(
                  {
                    action: 'templates.update',
                    payload: {
                      templateId: selected.template.id,
                      expectedRevision: selected.template.revision,
                      ...next,
                    },
                  },
                  `Шаблон «${next.name}» обновлён.`,
                )
              }
              onArchive={(selected) =>
                void mutate(
                  {
                    action: 'templates.archive',
                    payload: {
                      templateId: selected.template.id,
                      expectedRevision: selected.template.revision,
                    },
                  },
                  `Шаблон «${selected.template.name}» перемещён в архив.`,
                )
              }
              onRestore={(selected) =>
                void mutate(
                  {
                    action: 'templates.restore',
                    payload: {
                      templateId: selected.template.id,
                      expectedRevision: selected.template.revision,
                    },
                  },
                  `Шаблон «${selected.template.name}» восстановлен.`,
                )
              }
            />
          ))}
        </div>
      ) : (
        <p className="template-empty">В этом разделе пока нет шаблонов.</p>
      )}

      {editable && (
        <details className="template-create">
          <summary>Дополнительно: создать свой шаблон</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void mutate(
                {
                  action: 'templates.create',
                  payload: { name, description, layout, visibility },
                },
                `Шаблон «${name}» добавлен в вашу библиотеку.`,
              ).then((created) => {
                if (!created) return;
                setName('');
                setDescription('');
                setScope('mine');
              });
            }}
          >
            <label>
              Название шаблона
              <input
                required
                maxLength={80}
                value={name}
                placeholder="Например, воскресный завтрак"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Основа
              <select
                value={layout}
                onChange={(event) => setLayout(event.target.value as RecipeTemplateLayout)}
              >
                <optgroup label="Блюда">
                  {BUILTIN_RECIPE_TEMPLATES.filter((item) => item.category === 'dish').map(
                    (item) => (
                      <option key={item.layout} value={item.layout}>
                        {item.name}
                      </option>
                    ),
                  )}
                </optgroup>
                <optgroup label="Напитки">
                  {BUILTIN_RECIPE_TEMPLATES.filter((item) => item.category === 'drink').map(
                    (item) => (
                      <option key={item.layout} value={item.layout}>
                        {item.name}
                      </option>
                    ),
                  )}
                </optgroup>
              </select>
            </label>
            <label>
              Описание
              <textarea
                maxLength={240}
                rows={3}
                value={description}
                placeholder="Для каких рецептов подходит этот вариант"
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label>
              Доступ
              <select
                value={visibility}
                onChange={(event) =>
                  setVisibility(event.target.value === 'workspace' ? 'workspace' : 'private')
                }
              >
                <option value="private">Только мне</option>
                <option value="workspace">Поделиться с участниками</option>
              </select>
            </label>
            <button className="button button-primary" type="submit" disabled={busy || !name.trim()}>
              Создать шаблон
            </button>
          </form>
        </details>
      )}
    </section>
  );
}
