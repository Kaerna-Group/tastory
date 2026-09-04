import { useEffect, useState } from 'react';
import { requestSessionRecipes } from '@/entities/session';
import { env } from '@/shared/config';
import { ApiClientError } from '@/shared/api';
import { draftKey, draftScope, newDraft, readDraft, writeDraft } from './drafts';
import type { RecipeLocalDraft, Tag } from './drafts';
import { RecipeSaveQueue } from './save-queue';

type EditorState = { queue: RecipeSaveQueue; editable: boolean; tags: Tag[]; recovered: boolean };
export function useEditor(
  subject: string,
  writer: boolean,
  id: string,
  source: 'draft' | 'recipe',
) {
  const [state, setState] = useState<EditorState | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let release: (() => void) | undefined;
    let queue: RecipeSaveQueue | undefined;
    const controller = new AbortController();
    const scope = draftScope(env.apiUrl || 'mock', subject);
    const connection = () => queue?.setOnline(navigator.onLine);
    const unload = (event: BeforeUnloadEvent) => {
      if (queue?.getSnapshot().status === 'storage-error') event.preventDefault();
    };
    // An exclusive browser lock prevents two tabs from replacing one local draft.
    async function open() {
      if (!navigator.locks)
        throw new Error(
          'Браузер не поддерживает защиту черновика от одновременного редактирования. Откройте тетрадь в современной версии браузера.',
        );
      await navigator.locks.request(draftKey(scope, id), { ifAvailable: true }, async (lock) => {
        if (!active) return;
        if (!lock)
          throw new Error(
            'Этот черновик открыт в другой вкладке. Закройте его там и повторите открытие.',
          );
        setState(null);
        setError('');
        let draft: RecipeLocalDraft | null = readDraft(localStorage, scope, id);
        const recovered = draft !== null;
        let editable = writer;
        let tags: Tag[] = [];
        if (!draft && source === 'recipe') {
          const result = await requestSessionRecipes(
            { action: 'recipes.get', payload: { recipeId: id } },
            crypto.randomUUID(),
            controller.signal,
          );
          if (!active || result.kind !== 'recipe') return;
          draft = newDraft(scope, id, result.aggregate);
          editable = writer && result.permissions?.edit === true;
        }
        if (!draft) {
          if (source === 'draft')
            throw new Error(
              'Локальный черновик не найден в этом аккаунте и браузере. Вернитесь в библиотеку.',
            );
          return;
        }
        if (editable && !recovered) writeDraft(localStorage, draft);
        queue = new RecipeSaveQueue(localStorage, draft, requestSessionRecipes);
        queue.setEditable(editable);
        queue.setOnline(false);
        if (!active) {
          queue.dispose();
          return;
        }
        setState({ queue, editable, tags, recovered });
        // Network lookup is independent of local recovery. Offline edits remain possible.
        void (async () => {
          if (draft.base && !draft.pending) {
            const result = await requestSessionRecipes(
              { action: 'recipes.get', payload: { recipeId: draft.base.recipe.id } },
              crypto.randomUUID(),
              controller.signal,
            );
            if (!active) return;
            editable = writer && result.kind === 'recipe' && result.permissions?.edit === true;
            queue?.setEditable(editable);
            if (result.kind === 'recipe') queue?.observeRemote(result.aggregate);
          }
          const result = await requestSessionRecipes(
            { action: 'tags.list', payload: {} },
            crypto.randomUUID(),
            controller.signal,
          );
          if (result.kind === 'tags') tags = result.tags;
        })()
          .catch((error) => {
            if (active && error instanceof ApiClientError && error.code === 'ACCESS_DENIED')
              editable = false;
          })
          .finally(() => {
            if (!active || !queue) return;
            queue.setEditable(editable);
            setState({ queue, editable, tags, recovered });
            connection();
          });
        window.addEventListener('online', connection);
        window.addEventListener('offline', connection);
        window.addEventListener('beforeunload', unload);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      });
    }
    void open().catch((error) => {
      if (active)
        setError(
          error instanceof Error && ['SyntaxError', 'ZodError'].includes(error.name)
            ? 'Локальная копия повреждена или создана другой версией приложения. Она оставлена в браузере без изменений.'
            : error instanceof Error
              ? error.message
              : 'Не удалось открыть черновик.',
        );
    });
    return () => {
      active = false;
      controller.abort();
      queue?.dispose();
      release?.();
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
      window.removeEventListener('beforeunload', unload);
    };
  }, [subject, writer, id, source, attempt]);
  return { state, error, retry: () => setAttempt((value) => value + 1) };
}
