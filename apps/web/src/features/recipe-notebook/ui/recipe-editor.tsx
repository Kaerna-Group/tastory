import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { requestSessionRecipes } from '@/entities/session';
import { buildTransferDocument, serializeTransferDocument } from '@/entities/recipe-transfer';
import { getUserSettings, subscribeUserSettings } from '@/entities/user-settings';
import { useEditor } from '../model/use-editor';
import { valueFromAggregate } from '../model/drafts';
import type { RecipeLocalDraft, RecipeDraftValue, Tag } from '../model/drafts';
import { RecipeFields } from './recipe-fields';
import { RecipeHistory } from './recipe-history';
import { RecipePhotos } from './recipe-photos';
import { RecipeBookView } from './recipe-book-view';
import { RecipeTemplates } from './recipe-templates';
import { StickerPacks } from './sticker-packs';
import './recipe-editor-modes.css';

function download(draft: RecipeLocalDraft) {
  const url = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          {
            title: 'Tastory — копия черновика',
            local: draft.value,
            server: draft.conflict,
            saved: draft.base,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    ),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `tastory-draft-${draft.id}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function PortableRecipeExport({
  recipeId,
  title,
  disabled,
}: {
  recipeId: string;
  title: string;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [],
  );
  async function run() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    try {
      const document = await buildTransferDocument(
        'recipe',
        [recipeId],
        requestSessionRecipes,
        controller.signal,
      );
      const url = URL.createObjectURL(
        new Blob([serializeTransferDocument(document)], { type: 'application/json' }),
      );
      const anchor = window.document.createElement('a');
      const safeTitle =
        title
          .trim()
          .toLocaleLowerCase('ru')
          .replace(/[^a-zа-яё0-9]+/gi, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 80) || recipeId;
      anchor.href = url;
      anchor.download = `tastory-recipe-${safeTitle}.tastory.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Не удалось экспортировать рецепт.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      pending.current = null;
    }
  }
  return (
    <>
      <button
        className="button button-secondary"
        type="button"
        disabled={disabled || busy}
        onClick={() => void run()}
      >
        {busy ? 'Собираем рецепт…' : 'Экспортировать с фото'}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
function VersionPreview({
  title,
  value,
  tags,
}: {
  title: string;
  value: RecipeDraftValue;
  tags: Tag[];
}) {
  return (
    <div className="recipe-version">
      <h3>{title}</h3>
      <strong>{value.content.title || 'Без названия'}</strong>
      <p>{value.content.description}</p>
      <p>
        Порции: {value.content.servings ?? '—'} · Подготовка: {value.content.prepMinutes ?? '—'} мин
        · Приготовление: {value.content.cookMinutes ?? '—'} мин
      </p>
      <h4>Ингредиенты</h4>
      <ul>
        {value.ingredients.map((row) => (
          <li key={row.key}>
            {row.sectionTitle && `${row.sectionTitle}: `}
            {row.name} — {row.quantityText || row.quantityValue} {row.unit}
            {row.isOptional ? ' (необязательно)' : ''} {row.note}
          </li>
        ))}
      </ul>
      <h4>Шаги</h4>
      <ol>
        {value.steps.map((row) => (
          <li key={row.key}>
            {row.sectionTitle && `${row.sectionTitle}: `}
            {row.body}
            {row.durationSeconds !== null ? ` (${row.durationSeconds} с)` : ''}
          </li>
        ))}
      </ol>
      <p>
        Теги:{' '}
        {value.tagIds
          .map((id) => tags.find((tag) => tag.id === id)?.name ?? 'Тег недоступен')
          .join(', ') || '—'}
      </p>
      <p>Источник: {value.content.sourceUrl || '—'}</p>
      <p>Заметки: {value.content.notes || '—'}</p>
    </div>
  );
}
function EditorContent({
  queue,
  editable: allowed,
  tags,
  recovered,
  offlineCopy,
}: NonNullable<ReturnType<typeof useEditor>['state']>) {
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  const preferences = useSyncExternalStore(subscribeUserSettings, getUserSettings).settings;
  const editable = allowed && snapshot.editable;
  const { draft, status, message, backupId } = snapshot;
  const [resolving, setResolving] = useState(false);
  const [mode, setMode] = useState<'view' | 'content' | 'design' | 'history'>(() =>
    draft.base ? 'view' : 'content',
  );
  const availableTags = [
    ...tags,
    ...(draft.base?.tags.filter((tag) => !tags.some((item) => item.id === tag.id)) ?? []),
  ];
  useEffect(
    () => queue.setAutosaveDelay(preferences.autosaveDelay),
    [preferences.autosaveDelay, queue],
  );
  useEffect(() => {
    if (!preferences.keyboardShortcuts) return;
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        queue.retry();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [preferences.keyboardShortcuts, queue]);
  const resolve = async (choice: 'mine' | 'server') => {
    setResolving(true);
    try {
      await queue.resolveConflict(choice);
    } finally {
      setResolving(false);
    }
  };
  return (
    <>
      <div className="recipe-toolbar">
        <div>
          <p role="status" className={`save-status save-status-${status}`}>
            {editable || status === 'storage-error'
              ? message
              : 'Рецепт доступен только для чтения.'}
          </p>
          {recovered && <p className="muted text-sm">Открыта локальная копия из этого браузера.</p>}
          {offlineCopy && (
            <p className="muted text-sm">
              Открыта недавняя версия: сервер недоступен. Повторно откройте рецепт с сетью для
              проверки доступа.
            </p>
          )}
        </div>
        <div className="recipe-row-actions">
          {editable && !draft.conflict && (
            <button
              className="button button-primary"
              type="button"
              disabled={status === 'saving'}
              onClick={() => queue.retry()}
            >
              {status === 'error' || status === 'storage-error'
                ? 'Повторить сохранение'
                : 'Сохранить сейчас'}
            </button>
          )}
          <button className="button button-secondary" type="button" onClick={() => download(draft)}>
            Скачать копию
          </button>
          {draft.base && (
            <PortableRecipeExport
              recipeId={draft.base.recipe.id}
              title={draft.base.recipe.title}
              disabled={status !== 'saved' || Boolean(draft.pending || draft.conflict)}
            />
          )}
        </div>
      </div>
      <div className="recipe-editor-mode-tabs" role="tablist" aria-label="Разделы рецепта">
        {draft.base && (
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'view'}
            onClick={() => setMode('view')}
          >
            Просмотр
          </button>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'content'}
          onClick={() => setMode('content')}
        >
          Содержание
        </button>
        {draft.base && (
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'design'}
            onClick={() => setMode('design')}
          >
            Дизайн
          </button>
        )}
        {draft.base && (
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'history'}
            onClick={() => setMode('history')}
          >
            История
          </button>
        )}
      </div>
      {backupId && (
        <p className="recipe-notice">
          Версия до выбора сохранена отдельно.{' '}
          <Link className="text-link" to={`/drafts/${backupId}`}>
            Открыть копию
          </Link>
        </p>
      )}
      {draft.conflict && (
        <section className="panel recipe-conflict" aria-labelledby="conflict-title">
          <h2 id="conflict-title">Рецепт изменился в другом месте</h2>
          <p>
            Автосохранение приостановлено. Серверная версия — от{' '}
            {new Date(draft.conflict.recipe.updatedAt).toLocaleString('ru')}. Перед выбором ваша
            версия останется отдельным локальным черновиком.
          </p>
          <div className="recipe-comparison">
            <VersionPreview
              title="Ваша версия"
              value={draft.value}
              tags={[...tags, ...(draft.base?.tags ?? [])]}
            />
            <VersionPreview
              title="Версия на сервере"
              value={valueFromAggregate(draft.conflict)}
              tags={draft.conflict.tags}
            />
          </div>
          {draft.conflict.recipe.status === 'archived' && (
            <p>На сервере рецепт в архиве. Ваши правки можно оставить отдельной копией.</p>
          )}
          <p className="muted">
            «Продолжить с моей версией» заменит содержимое серверного рецепта вашими правками. Если
            его снова изменят, появится новый конфликт.
          </p>
          <div className="recipe-row-actions">
            <button
              className="button button-primary"
              type="button"
              disabled={
                !editable ||
                resolving ||
                draft.conflict.recipe.status === 'archived' ||
                draft.conflict.recipe.status === 'deleted'
              }
              onClick={() => {
                void resolve('mine');
              }}
            >
              Продолжить с моей версией
            </button>
            <button
              className="button button-secondary"
              type="button"
              disabled={resolving}
              onClick={() => {
                void resolve('server');
              }}
            >
              Принять серверную, мою оставить копией
            </button>
          </div>
        </section>
      )}
      {mode === 'view' && draft.base && (
        <RecipeBookView
          recipeId={draft.base.recipe.id}
          recipeRevision={draft.base.recipe.revision}
          value={draft.value}
          tags={availableTags}
          coverPhoto={draft.base.photos.find((photo) => photo.kind === 'cover') ?? null}
        />
      )}
      {mode === 'content' && (
        <>
          <div className="recipe-visibility">
            <label>
              Видимость
              <select
                aria-label="Видимость"
                value={draft.visibility}
                disabled={!editable || Boolean(draft.base || draft.pending)}
                onChange={(e) =>
                  queue.edit(draft.value, e.target.value === 'workspace' ? 'workspace' : 'private')
                }
              >
                <option value="private">Личный рецепт</option>
                <option value="workspace">Общий — для участников тетради</option>
              </select>
            </label>
            <p className="muted text-sm">
              {draft.visibility === 'private'
                ? 'Доступен вам и владельцу тетради.'
                : 'Доступен всем участникам тетради.'}{' '}
              {draft.base || draft.pending
                ? 'Видимость выбрана при создании.'
                : 'Выберите видимость до первого сохранения.'}
            </p>
          </div>
          <RecipeFields
            value={draft.value}
            onChange={(value) => queue.edit(value)}
            tags={availableTags}
            disabled={!editable || resolving}
            unitSystem={preferences.unitSystem}
            keyboardShortcuts={preferences.keyboardShortcuts}
          />
          <RecipePhotos
            queue={queue}
            editable={editable && !resolving}
            confirmDelete={preferences.confirmDestructiveActions}
          />
          <p className="muted text-sm">
            Локальная копия хранится в этом браузере. Очистка данных сайта удалит её. Для другого
            устройства дождитесь сохранения на сервере.
          </p>
        </>
      )}
      {mode === 'design' && draft.base && (
        <>
          <RecipeTemplates
            recipeId={draft.base.recipe.id}
            recipeRevision={draft.base.recipe.revision}
            value={draft.value}
            editable={
              editable && !resolving && status === 'saved' && !draft.pending && !draft.conflict
            }
          />
          <StickerPacks
            recipeId={draft.base.recipe.id}
            recipeRevision={draft.base.recipe.revision}
            editable={
              editable && !resolving && status === 'saved' && !draft.pending && !draft.conflict
            }
          />
        </>
      )}
      {mode === 'history' && draft.base && (
        <RecipeHistory
          key={draft.base.recipe.id}
          recipeId={draft.base.recipe.id}
          currentRevision={draft.base.recipe.revision}
          canRestore={
            editable &&
            status === 'saved' &&
            !draft.pending &&
            !draft.conflict &&
            (draft.base.recipe.status === 'draft' || draft.base.recipe.status === 'published')
          }
          queue={queue}
        />
      )}
    </>
  );
}
export function RecipeEditor({
  subject,
  writer,
  id,
  source,
}: {
  subject: string;
  writer: boolean;
  id: string;
  source: 'draft' | 'recipe';
}) {
  const { state, error, retry } = useEditor(subject, writer, id, source);
  const density = useSyncExternalStore(subscribeUserSettings, getUserSettings).settings
    .editorDensity;
  return (
    <div className={`recipe-editor recipe-editor-${density}`}>
      {error ? (
        <section className="panel">
          <p role="alert">{error}</p>
          <button type="button" className="button button-secondary" onClick={retry}>
            Повторить открытие
          </button>
        </section>
      ) : state ? (
        <EditorContent {...state} />
      ) : (
        <p role="status">Открываем рецепт…</p>
      )}
    </div>
  );
}
