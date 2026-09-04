import { useEffect, useRef, useState } from 'react';
import { requestSessionRecipes } from '@/entities/session';
import type { RecipeData, RecipeAggregate } from '../model/drafts';
import { valueFromAggregate } from '../model/drafts';
import type { RecipeSaveQueue } from '../model/save-queue';
import { RecipeFields } from './recipe-fields';

type PendingRestore = { requestId: string; expectedRevision: number; targetRevision: number };

export function RecipeHistory({
  recipeId,
  currentRevision,
  canRestore,
  queue,
}: {
  recipeId: string;
  currentRevision: number;
  canRestore: boolean;
  queue: RecipeSaveQueue;
}) {
  const [history, setHistory] = useState<Extract<RecipeData, { kind: 'history' }> | null>(null);
  const [version, setVersion] = useState<RecipeAggregate | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const pendingRestore = useRef<PendingRestore | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [],
  );
  async function load(revision?: number, beforeRevision?: number) {
    if (pending.current) return;
    if (revision !== pendingRestore.current?.targetRevision) pendingRestore.current = null;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await requestSessionRecipes(
        revision
          ? { action: 'recipes.version', payload: { recipeId, revision } }
          : {
              action: 'recipes.history',
              payload: { recipeId, ...(beforeRevision ? { beforeRevision } : {}) },
            },
        crypto.randomUUID(),
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (result.kind === 'history') {
        setHistory(result);
        setVersion(null);
        setConfirmRestore(false);
      }
      if (result.kind === 'recipe') {
        setVersion(result.aggregate);
        setConfirmRestore(false);
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'История недоступна.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      pending.current = null;
    }
  }
  async function restore() {
    if (!version || !canRestore || version.recipe.revision >= currentRevision || pending.current)
      return;
    const targetRevision = version.recipe.revision;
    const restore = pendingRestore.current ?? {
      requestId: crypto.randomUUID(),
      expectedRevision: currentRevision,
      targetRevision,
    };
    if (restore.expectedRevision !== currentRevision || restore.targetRevision !== targetRevision)
      return;
    pendingRestore.current = restore;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const receipt = await requestSessionRecipes(
        {
          action: 'recipes.version.restore',
          payload: { recipeId, expectedRevision: currentRevision, targetRevision },
        },
        restore.requestId,
        controller.signal,
      );
      if (receipt.kind !== 'saved' || receipt.outcome === 'cancelled')
        throw new Error('Сервер не подтвердил восстановление версии.');
      const current = await requestSessionRecipes(
        { action: 'recipes.get', payload: { recipeId } },
        crypto.randomUUID(),
        controller.signal,
      );
      if (current.kind !== 'recipe' || current.aggregate.recipe.revision < receipt.revision)
        throw new Error('Не удалось загрузить восстановленную версию.');
      if (controller.signal.aborted) return;
      queue.observeRemote(current.aggregate);
      pendingRestore.current = null;
      setHistory(null);
      setVersion(null);
      setConfirmRestore(false);
      setMessage(`Версия ${targetRevision} восстановлена как версия ${receipt.revision}.`);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Не удалось восстановить версию.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      pending.current = null;
    }
  }
  return (
    <section className="panel" aria-label="История рецепта">
      <h2>История рецепта</h2>
      <button
        className="button button-secondary"
        type="button"
        disabled={busy}
        onClick={() => {
          void load();
        }}
      >
        Показать историю
      </button>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      {history && (
        <>
          <ul>
            {history.versions.map((item) => (
              <li key={item.revision}>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void load(item.revision);
                  }}
                >
                  Версия {item.revision} · {new Date(item.completedAt).toLocaleString('ru')}
                </button>
              </li>
            ))}
          </ul>
          {history.nextBeforeRevision && (
            <button
              className="button button-secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                void load(undefined, history.nextBeforeRevision ?? undefined);
              }}
            >
              Более ранние версии
            </button>
          )}
        </>
      )}
      {version && (
        <>
          <h3>Версия {version.recipe.revision} — просмотр</h3>
          {version.recipe.revision < currentRevision && (
            <div className="recipe-notice">
              {confirmRestore ? (
                <>
                  <p>
                    Версия {version.recipe.revision} станет новой версией {currentRevision + 1}.
                    Текущая версия останется в истории.
                  </p>
                  <div className="recipe-row-actions">
                    <button
                      className="button button-primary"
                      type="button"
                      disabled={busy || !canRestore}
                      onClick={() => {
                        void restore();
                      }}
                    >
                      Подтвердить восстановление
                    </button>
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmRestore(false)}
                    >
                      Отмена
                    </button>
                  </div>
                </>
              ) : (
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={busy || !canRestore}
                  onClick={() => setConfirmRestore(true)}
                >
                  Восстановить как новую версию
                </button>
              )}
              {!canRestore && (
                <p className="muted text-sm">Сначала дождитесь сохранения текущих правок.</p>
              )}
            </div>
          )}
          <RecipeFields
            value={valueFromAggregate(version)}
            tags={version.tags}
            disabled
            onChange={() => {}}
            unitSystem="metric"
            keyboardShortcuts={false}
          />
        </>
      )}
    </section>
  );
}
