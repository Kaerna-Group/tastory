import type {
  RecipeAggregate,
  RecipeCommand,
  RecipeData,
  RecipeDraftValue,
  RecipeLocalDraft,
} from '@tastory/contracts';
import { ApiClientError } from '@/shared/api';
import {
  bindSavedIds,
  copyValue,
  newDraft,
  rebaseValue,
  valueFromAggregate,
  writeDraft,
  writeValue,
  isDraftVolatile,
} from './drafts';
import type { DraftStorage } from './drafts';

export type RecipeRequest = (
  command: RecipeCommand,
  requestId: string,
  signal?: AbortSignal,
) => Promise<RecipeData>;
export type QueueStatus =
  'local' | 'saving' | 'saved' | 'offline' | 'invalid' | 'conflict' | 'error' | 'storage-error';
export type QueueSnapshot = {
  editable: boolean;
  draft: RecipeLocalDraft;
  status: QueueStatus;
  message: string;
  backupId: string | null;
};
const messages = {
  local: 'Сохранено на устройстве. Ожидает отправки.',
  saving: 'Сохранено на устройстве. Отправляем на сервер…',
  saved: 'Сохранено на сервере и на устройстве.',
  offline: 'Нет соединения. Правки сохранены на устройстве.',
  invalid:
    'Черновик на устройстве. Заполните название, ингредиенты и шаги; проверьте ссылку и числа.',
  conflict: 'На сервере есть другая версия. Выберите, как продолжить.',
  error: 'Не удалось сохранить на сервере. Локальная копия сохранена.',
  'storage-error':
    'Не удалось записать на устройство. Оставьте страницу открытой и скачайте копию.',
};

export class RecipeSaveQueue {
  private snapshot: QueueSnapshot;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller = new AbortController();
  private running = false;
  private disposed = false;
  private online = true;
  private retryDelay = 1000;
  private blocked = false;
  private canEdit = true;
  private durable = true;
  private autosaveDelay = 900;
  constructor(
    private storage: DraftStorage,
    draft: RecipeLocalDraft,
    private request: RecipeRequest,
    private uuid = () => crypto.randomUUID(),
  ) {
    this.durable = !isDraftVolatile(draft.scope, draft.id);
    const status = !this.durable
      ? 'storage-error'
      : draft.conflict
        ? 'conflict'
        : draft.pending || draft.editVersion !== draft.savedVersion
          ? 'local'
          : 'saved';
    this.snapshot = { draft, status, message: messages[status], backupId: null, editable: true };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private report(status: QueueStatus, message = messages[status]) {
    this.snapshot = { ...this.snapshot, status, message };
    this.listeners.forEach((listener) => listener());
  }
  private persist(draft: RecipeLocalDraft) {
    this.snapshot = { ...this.snapshot, draft };
    try {
      writeDraft(this.storage, draft);
      this.durable = true;
      return true;
    } catch {
      this.durable = false;
      this.report('storage-error');
      return false;
    }
  }
  edit(value: RecipeDraftValue, visibility = this.snapshot.draft.visibility) {
    if (this.disposed || !this.canEdit) return;
    const draft = this.snapshot.draft;
    if (
      !this.persist({
        ...draft,
        value,
        visibility: draft.base || draft.pending ? draft.visibility : visibility,
        editVersion: draft.editVersion + 1,
        updatedAt: new Date().toISOString(),
      })
    )
      return;
    if (draft.conflict) this.report('conflict');
    else if (!this.blocked) {
      this.report(this.online ? (this.running ? 'saving' : 'local') : 'offline');
      this.schedule(this.autosaveDelay);
    } else this.report('error', this.snapshot.message);
  }
  setAutosaveDelay(delay: 500 | 900 | 2000) {
    this.autosaveDelay = delay;
  }
  setOnline(online: boolean) {
    this.online = online;
    if (online) {
      this.retryDelay = 1000;
      this.schedule(0);
    } else if (
      !this.snapshot.draft.conflict &&
      this.durable &&
      (this.snapshot.draft.pending ||
        this.snapshot.draft.editVersion !== this.snapshot.draft.savedVersion)
    )
      this.report('offline');
  }
  setEditable(canEdit: boolean) {
    this.canEdit = canEdit;
    this.snapshot = { ...this.snapshot, editable: canEdit };
    this.listeners.forEach((listener) => listener());
    if (!canEdit) {
      clearTimeout(this.timer);
      this.controller.abort();
    }
  }
  observeRemote(remote: RecipeAggregate) {
    const draft = this.snapshot.draft;
    if (
      this.disposed ||
      draft.pending ||
      !draft.base ||
      draft.base.recipe.id !== remote.recipe.id ||
      draft.base.recipe.revision === remote.recipe.revision
    )
      return;
    if (draft.editVersion === draft.savedVersion) {
      if (
        this.persist({
          ...draft,
          base: remote,
          value: valueFromAggregate(remote),
          visibility: remote.recipe.visibility,
          conflict: null,
        })
      )
        this.report('saved');
    } else if (this.persist({ ...draft, conflict: remote })) this.report('conflict');
  }
  private schedule(delay: number) {
    clearTimeout(this.timer);
    if (
      !this.disposed &&
      this.online &&
      this.canEdit &&
      !this.blocked &&
      !this.snapshot.draft.conflict
    )
      this.timer = setTimeout(() => {
        void this.flush();
      }, delay);
  }
  retry() {
    this.blocked = false;
    if (this.persist(this.snapshot.draft)) {
      this.report(this.snapshot.draft.conflict ? 'conflict' : 'local');
      this.schedule(0);
    }
  }
  async flush() {
    clearTimeout(this.timer);
    if (
      this.running ||
      this.disposed ||
      !this.online ||
      !this.canEdit ||
      this.blocked ||
      this.snapshot.draft.conflict
    )
      return;
    if (!this.durable && !this.persist(this.snapshot.draft)) return;
    this.running = true;
    try {
      while (!this.disposed && this.online && this.canEdit) {
        let draft = this.snapshot.draft;
        if (!draft.pending) {
          if (draft.editVersion === draft.savedVersion) {
            this.report('saved');
            break;
          }
          const parsed = writeValue(draft.value);
          if (!parsed.success) {
            this.report('invalid');
            break;
          }
          const command: NonNullable<RecipeLocalDraft['pending']>['command'] = draft.base
            ? {
                action: 'recipes.updateContent',
                payload: {
                  recipeId: draft.base.recipe.id,
                  expectedRevision: draft.base.recipe.revision,
                  value: parsed.data,
                },
              }
            : {
                action: 'recipes.create',
                payload: { visibility: draft.visibility, value: parsed.data },
              };
          draft = {
            ...draft,
            pending: {
              requestId: this.uuid(),
              command,
              value: draft.value,
              editVersion: draft.editVersion,
            },
          };
          // Never send until the exact request and its stable ID are durable.
          if (!this.persist(draft)) break;
        }
        const pending = draft.pending;
        if (!pending) break;
        if (!this.persist(this.snapshot.draft)) break;
        this.report('saving');
        const receipt = await this.request(
          pending.command,
          pending.requestId,
          this.controller.signal,
        );
        if (this.disposed) return;
        if (receipt.kind !== 'saved' || receipt.outcome === 'cancelled')
          throw new ApiClientError('INVALID_RESPONSE', 'Не удалось подтвердить сохранение.');
        const result = await this.request(
          { action: 'recipes.get', payload: { recipeId: receipt.entityId } },
          this.uuid(),
          this.controller.signal,
        );
        if (this.disposed) return;
        if (result.kind !== 'recipe' || result.aggregate.recipe.revision < receipt.revision)
          throw new ApiClientError('INVALID_RESPONSE', 'Не удалось загрузить сохранённую версию.');
        const current = this.snapshot.draft;
        const remote = result.aggregate;
        if (remote.recipe.revision !== receipt.revision) {
          if (this.persist({ ...current, pending: null, conflict: remote }))
            this.report('conflict');
          break;
        }
        const value = bindSavedIds(current.value, pending.value, remote);
        if (
          !this.persist({
            ...current,
            base: remote,
            value,
            pending: null,
            savedVersion: pending.editVersion,
          })
        )
          break;
        this.retryDelay = 1000;
        if (!result.permissions?.edit) {
          this.setEditable(false);
          this.report(
            'error',
            'Право редактирования не подтверждено. Ваши правки остались на устройстве.',
          );
          break;
        }
      }
    } catch (error) {
      if (this.disposed) return;
      if (error instanceof ApiClientError && error.code === 'RECIPE_CANCELLED') {
        this.blocked = true;
        if (this.persist({ ...this.snapshot.draft, pending: null }))
          this.report(
            'error',
            'Предыдущая операция отменена. Копия сохранена на устройстве. Нажмите «Повторить сохранение», чтобы отправить правки новым запросом.',
          );
        return;
      }
      if (
        error instanceof ApiClientError &&
        error.code === 'RECIPE_CONFLICT' &&
        this.snapshot.draft.base
      ) {
        try {
          const result = await this.request(
            { action: 'recipes.get', payload: { recipeId: this.snapshot.draft.base.recipe.id } },
            this.uuid(),
            this.controller.signal,
          );
          if (!this.disposed && result.kind === 'recipe') {
            if (this.persist({ ...this.snapshot.draft, conflict: result.aggregate }))
              this.report('conflict');
            return;
          }
        } catch {
          /* The durable original request can be retried after connectivity returns. */
        }
      }
      if (this.disposed) return;
      const transient =
        !(error instanceof ApiClientError) ||
        ['TRANSPORT_ERROR', 'RECIPE_UNAVAILABLE', 'INVALID_RESPONSE'].includes(error.code);
      this.blocked = !transient;
      if (this.durable)
        this.report(
          this.online ? 'error' : 'offline',
          error instanceof ApiClientError
            ? `${error.message} Правки остаются на устройстве.`
            : messages[this.online ? 'error' : 'offline'],
        );
      if (transient) {
        this.schedule(this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, 30000);
      }
    } finally {
      this.running = false;
    }
  }
  async resolveConflict(choice: 'mine' | 'server') {
    const draft = this.snapshot.draft;
    if (!draft.conflict || this.running || this.disposed || !this.online) return;
    this.running = true;
    try {
      // A rejected write may have prepared rows. Release only our own known reservation.
      if (draft.pending) {
        const operations = await this.request(
          { action: 'recipes.operations.list', payload: {} },
          this.uuid(),
          this.controller.signal,
        );
        if (operations.kind !== 'operations') throw new Error('Не удалось проверить очередь.');
        if (operations.operations.some((op) => op.operationId === draft.pending?.requestId))
          await this.request(
            {
              action: 'recipes.operations.cancel',
              payload: { operationId: draft.pending.requestId },
            },
            this.uuid(),
            this.controller.signal,
          );
      }
      if (this.disposed) return;
      const current = this.snapshot.draft;
      const remote = draft.conflict;
      // Both choices retain the local text as a separate, unsent private draft.
      const backup = {
        ...newDraft(draft.scope, this.uuid()),
        value: copyValue(current.value),
        editVersion: 1,
      };
      writeDraft(this.storage, backup);
      this.snapshot = { ...this.snapshot, backupId: backup.id };
      if (
        !this.persist({
          ...current,
          base: remote,
          visibility: remote.recipe.visibility,
          value:
            choice === 'mine' ? rebaseValue(current.value, remote) : valueFromAggregate(remote),
          pending: null,
          conflict: null,
          editVersion: current.editVersion + 1,
          savedVersion: choice === 'server' ? current.editVersion + 1 : current.savedVersion,
        })
      )
        return;
      this.blocked = false;
      this.setEditable(
        this.canEdit && (remote.recipe.status === 'draft' || remote.recipe.status === 'published'),
      );
      this.report(choice === 'mine' ? 'local' : 'saved');
      this.schedule(0);
    } catch (error) {
      this.report(
        'conflict',
        error instanceof ApiClientError
          ? error.message
          : 'Не удалось завершить выбор версии. Обе копии сохранены; попробуйте снова.',
      );
    } finally {
      this.running = false;
    }
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.controller.abort();
    this.listeners.clear();
  }
}
