import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/shared/api';
import { recipeAggregateSchema } from '@tastory/contracts';
import type { RecipeAggregate, RecipeData, RecipeDraftValue } from '@tastory/contracts';
import { RecipeSaveQueue } from './save-queue';
import { forgetUnsaved, listUnsaved } from './recovery-memory';
import type { RecipeRequest } from './save-queue';
import {
  bindSavedIds,
  copyValue,
  draftKey,
  draftScope,
  emptyValue,
  listDrafts,
  newDraft,
  readDraft,
  rebaseValue,
  valueFromAggregate,
  writeDraft,
  writeValue,
} from './drafts';

class MemoryStorage {
  values = new Map<string, string>();
  fail = false;
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.fail) throw new Error('QuotaExceeded');
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
const scope = draftScope('server-a', 'chef');
function content(title = 'Суп'): RecipeDraftValue {
  return {
    ...emptyValue(),
    content: { ...emptyValue().content, title },
    ingredients: [
      {
        key: crypto.randomUUID(),
        sectionTitle: '',
        position: 0,
        name: 'Соль',
        quantityValue: null,
        quantityText: 'по вкусу',
        unit: '',
        note: '',
        isOptional: false,
      },
    ],
    steps: [
      {
        key: crypto.randomUUID(),
        sectionTitle: '',
        position: 0,
        body: 'Варить',
        durationSeconds: null,
      },
    ],
  };
}
function aggregate(value = content(), revision = 1): RecipeAggregate {
  const id = '11111111-1111-4111-8111-111111111111';
  const audit = { revision, createdAt: '2026-09-03T10:00:00Z', updatedAt: '2026-09-03T11:00:00Z' };
  const parsed = writeValue(value);
  if (!parsed.success) throw new Error('fixture');
  return recipeAggregateSchema.parse({
    recipe: {
      ...parsed.data.content,
      ...audit,
      id,
      workspaceId: '22222222-2222-4222-8222-222222222222',
      ownerUserId: '33333333-3333-4333-8333-333333333333',
      visibility: 'private',
      status: 'draft',
      deletedAt: null,
    },
    ingredients: parsed.data.ingredients.map((row) => ({
      ...row,
      ...audit,
      id: row.id ?? crypto.randomUUID(),
      recipeId: id,
    })),
    steps: parsed.data.steps.map((row) => ({
      ...row,
      ...audit,
      id: row.id ?? crypto.randomUUID(),
      recipeId: id,
    })),
    photos: [],
    tags: [],
    recipeTags: [],
  });
}
function setup(base: RecipeAggregate | null = null) {
  const storage = new MemoryStorage();
  const draft = newDraft(scope, crypto.randomUUID(), base);
  let remote = base;
  const receipts = new Map<string, RecipeData>();
  const request = vi.fn<RecipeRequest>(async (command, id) => {
    if (command.action === 'recipes.get' && remote)
      return {
        kind: 'recipe',
        aggregate: remote,
        permissions: { edit: true, archive: true, restore: false },
      };
    if (receipts.has(id)) return receipts.get(id) as RecipeData;
    if (command.action === 'recipes.create' || command.action === 'recipes.updateContent') {
      if (
        command.action === 'recipes.updateContent' &&
        command.payload.expectedRevision !== remote?.recipe.revision
      )
        throw new ApiClientError('RECIPE_CONFLICT', 'Другая версия.');
      remote = aggregate(
        {
          ...command.payload.value,
          ingredients: command.payload.value.ingredients.map((row) => ({
            ...row,
            key: row.id ?? crypto.randomUUID(),
          })),
          steps: command.payload.value.steps.map((row) => ({
            ...row,
            key: row.id ?? crypto.randomUUID(),
          })),
        },
        (remote?.recipe.revision ?? 0) + 1,
      );
      const saved: RecipeData = {
        kind: 'saved',
        entityId: remote.recipe.id,
        entityType: 'recipe',
        operationId: id,
        revision: remote.recipe.revision,
        outcome: 'committed',
      };
      receipts.set(id, saved);
      return saved;
    }
    if (command.action === 'recipes.operations.list') return { kind: 'operations', operations: [] };
    throw new Error('unexpected command');
  });
  writeDraft(storage, draft);
  const queue = new RecipeSaveQueue(storage, draft, request);
  const read = () => {
    const saved = readDraft(storage, scope, draft.id);
    if (!saved) throw new Error('missing draft');
    return saved;
  };
  return {
    storage,
    draft,
    request,
    queue,
    read,
    receipts,
    remote: () => remote,
    setRemote: (value: RecipeAggregate) => {
      remote = value;
    },
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  listUnsaved().forEach((draft) => forgetUnsaved(draftKey(draft.scope, draft.id)));
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('local recipe drafts', () => {
  it('preserves unfinished fields, scopes accounts and servers, and retains damaged records', () => {
    const f = setup();
    const value = content('');
    value.content.sourceUrl = 'https:';
    value.content.servings = -1;
    const step = value.steps[0];
    if (step) step.body = '';
    f.queue.setOnline(false);
    f.queue.edit(value);
    expect(f.read().value).toEqual(value);
    expect(writeValue(value).success).toBe(false);
    expect(listDrafts(f.storage, draftScope('server-a', 'another')).drafts).toEqual([]);
    expect(listDrafts(f.storage, draftScope('server-b', 'chef')).drafts).toEqual([]);
    const damaged = draftKey(scope, crypto.randomUUID());
    f.storage.setItem(damaged, '{broken');
    expect(listDrafts(f.storage, scope)).toMatchObject({
      drafts: [expect.any(Object)],
      damaged: 1,
    });
    expect(f.storage.getItem(damaged)).toBe('{broken');
    const raw = JSON.stringify(f.read());
    f.storage.setItem(
      draftKey(scope, f.draft.id),
      raw.replace('"scope":', '"credential":"secret","scope":'),
    );
    expect(() => f.read()).toThrow();
    f.queue.dispose();
  });
  it('prepares new copies without server IDs and removes deleted IDs on explicit rebase', () => {
    const base = aggregate(),
      value = valueFromAggregate(base);
    expect(copyValue(value).ingredients[0]?.id).toBeUndefined();
    expect(copyValue(value).steps[0]?.id).toBeUndefined();
    const remote = { ...base, ingredients: [], steps: [] };
    expect(rebaseValue(value, remote).ingredients[0]?.id).toBeUndefined();
    expect(rebaseValue(value, base)).toEqual(value);
    expect(bindSavedIds(content(), emptyValue(), remote).ingredients[0]?.id).toBeUndefined();
  });
});

describe('serialized durable autosave', () => {
  it('requires an explicit fresh request after a confirmed cancellation instead of retrying forever', async () => {
    const f = setup();
    f.request.mockRejectedValueOnce(new ApiClientError('RECIPE_CANCELLED', 'Отменено'));
    f.queue.edit(content());
    await f.queue.flush();
    const firstId = f.request.mock.calls[0]?.[1];
    expect(f.read().pending).toBeNull();
    expect(f.queue.getSnapshot().message).toContain('отменена');
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.request).toHaveBeenCalledTimes(1);
    f.queue.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.request.mock.calls[1]?.[1]).not.toBe(firstId);
    expect(f.queue.getSnapshot().status).toBe('saved');
    f.queue.dispose();
  });
  it('debounces typing and persists the exact operation before sending', async () => {
    const f = setup();
    const transport = f.request.getMockImplementation();
    f.request.mockImplementation(async (command, id, signal) => {
      if (command.action === 'recipes.create')
        expect(f.read().pending).toMatchObject({ requestId: id, command });
      if (!transport) throw new Error('fixture');
      return transport(command, id, signal);
    });
    f.queue.edit(content('С'));
    await vi.advanceTimersByTimeAsync(500);
    f.queue.edit(content('Суп'));
    await vi.advanceTimersByTimeAsync(899);
    expect(f.request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.receipts.size).toBe(1);
    expect(f.remote()?.recipe.title).toBe('Суп');
    expect(f.queue.getSnapshot().status).toBe('saved');
    expect(f.read().pending).toBeNull();
    f.queue.dispose();
  });
  it('serializes edits during a request and binds new child IDs before the next update', async () => {
    const f = setup();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transport = f.request.getMockImplementation();
    let mutations = 0;
    f.request.mockImplementation(async (command, id, signal) => {
      if (command.action === 'recipes.create') {
        mutations++;
        await gate;
      }
      if (command.action === 'recipes.updateContent') {
        mutations++;
        expect(command.payload.value.ingredients[0]?.id).toBe(f.remote()?.ingredients[0]?.id);
        expect(command.payload.expectedRevision).toBe(1);
      }
      if (!transport) throw new Error('fixture');
      return transport(command, id, signal);
    });
    const value = content();
    f.queue.edit(value);
    const flush = f.queue.flush();
    f.queue.edit({ ...value, content: { ...value.content, title: 'После отправки' } });
    await f.queue.flush();
    expect(mutations).toBe(1);
    release?.();
    await flush;
    expect(mutations).toBe(2);
    expect(f.remote()?.recipe.title).toBe('После отправки');
    expect(f.read().savedVersion).toBe(2);
    f.queue.dispose();
  });
  it.each(['receipt', 'read'] as const)(
    'replays the same command after reload when the %s is lost',
    async (lost) => {
      const f = setup();
      const transport = f.request.getMockImplementation();
      let fail = true;
      f.request.mockImplementation(async (command, id, signal) => {
        if (!transport) throw new Error('fixture');
        const result = await transport(command, id, signal);
        if (
          fail &&
          ((lost === 'receipt' && command.action === 'recipes.create') ||
            (lost === 'read' && command.action === 'recipes.get'))
        )
          throw new ApiClientError('TRANSPORT_ERROR', 'offline');
        return result;
      });
      f.queue.edit(content());
      await f.queue.flush();
      const pending = f.read().pending;
      expect(pending).not.toBeNull();
      expect(f.receipts.size).toBe(1);
      f.queue.dispose();
      fail = false;
      const recovered = new RecipeSaveQueue(f.storage, f.read(), f.request);
      const newer = f.read().value;
      recovered.edit({ ...newer, content: { ...newer.content, title: 'После перезагрузки' } });
      await recovered.flush();
      const creates = f.request.mock.calls.filter(
        ([command]) => command.action === 'recipes.create',
      );
      expect(creates).toHaveLength(2);
      expect(creates[0]?.slice(0, 2)).toEqual(creates[1]?.slice(0, 2));
      expect(f.remote()?.recipe.revision).toBe(2);
      expect(f.remote()?.recipe.title).toBe('После перезагрузки');
      recovered.dispose();
    },
  );
  it('keeps offline edits and validation errors local then resumes automatically', async () => {
    const f = setup();
    f.queue.setOnline(false);
    f.queue.edit(content(''));
    await f.queue.flush();
    expect(f.request).not.toHaveBeenCalled();
    f.queue.setOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.queue.getSnapshot().status).toBe('invalid');
    expect(f.request).not.toHaveBeenCalled();
    f.queue.edit(content());
    await vi.advanceTimersByTimeAsync(900);
    expect(f.queue.getSnapshot().status).toBe('saved');
    f.queue.dispose();
  });
  it('never sends an operation that could not be stored', async () => {
    const f = setup();
    f.queue.edit(content());
    f.storage.fail = true;
    await f.queue.flush();
    expect(f.request).not.toHaveBeenCalled();
    expect(f.queue.getSnapshot().status).toBe('storage-error');
    f.storage.fail = false;
    f.queue.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.receipts.size).toBe(1);
    f.queue.dispose();
  });
  it('keeps newer text in memory if a local write fails during the network request', async () => {
    const f = setup();
    const transport = f.request.getMockImplementation();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.request.mockImplementation(async (command, id, signal) => {
      if (command.action === 'recipes.create') await gate;
      if (!transport) throw new Error();
      return transport(command, id, signal);
    });
    const value = content();
    f.queue.edit(value);
    const flush = f.queue.flush();
    f.storage.fail = true;
    f.queue.edit({ ...value, content: { ...value.content, title: 'Не терять' } });
    release?.();
    await flush;
    expect(f.queue.getSnapshot().status).toBe('storage-error');
    expect(f.queue.getSnapshot().draft.value.content.title).toBe('Не терять');
    expect(
      JSON.parse(f.storage.getItem(draftKey(scope, f.draft.id)) ?? 'null').pending,
    ).not.toBeNull();
    f.storage.fail = false;
    f.queue.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.remote()?.recipe.title).toBe('Не терять');
    expect(f.remote()?.recipe.revision).toBe(2);
    f.queue.dispose();
  });
  it('retains a failed local write across in-app navigation and retries it durably', async () => {
    const f = setup();
    f.storage.fail = true;
    f.queue.edit(content('В памяти'));
    f.queue.dispose();
    expect(listDrafts(f.storage, scope).drafts[0]?.value.content.title).toBe('В памяти');
    const reopened = new RecipeSaveQueue(f.storage, f.read(), f.request);
    expect(reopened.getSnapshot().status).toBe('storage-error');
    await reopened.flush();
    expect(f.request).not.toHaveBeenCalled();
    f.storage.fail = false;
    reopened.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.remote()?.recipe.title).toBe('В памяти');
    reopened.dispose();
  });
  it('pauses on permanent errors and aborts requests on disposal without deleting the pending command', async () => {
    const f = setup();
    f.request.mockRejectedValue(new ApiClientError('RECIPE_PENDING', 'Другая операция.'));
    f.queue.edit(content());
    await f.queue.flush();
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.read().pending).not.toBeNull();
    const signal = f.request.mock.calls[0]?.[2];
    f.queue.dispose();
    expect(signal?.aborted).toBe(true);
    f.queue.edit(content('ignored'));
    expect(f.read().value.content.title).toBe('Суп');
  });
  it('stops sending and editing when access becomes read-only', async () => {
    const f = setup(aggregate());
    f.queue.setEditable(false);
    f.queue.edit(content('ignored'));
    await f.queue.flush();
    expect(f.request).not.toHaveBeenCalled();
    expect(f.read().value.content.title).toBe('Суп');
    f.queue.dispose();
  });
  it.each(['mine', 'server'] as const)(
    'retains both versions and resolves a conflict with %s explicitly',
    async (choice) => {
      const f = setup(aggregate());
      f.queue.edit(content('Мой текст'));
      f.setRemote(aggregate(content('Серверный текст'), 2));
      await f.queue.flush();
      expect(f.queue.getSnapshot().status).toBe('conflict');
      expect(f.read().pending).not.toBeNull();
      await f.queue.resolveConflict(choice);
      await vi.advanceTimersByTimeAsync(0);
      expect(f.remote()?.recipe.title).toBe(choice === 'mine' ? 'Мой текст' : 'Серверный текст');
      const backup = listDrafts(f.storage, scope).drafts.find((draft) => draft.id !== f.draft.id);
      expect(backup?.value.content.title).toBe('Мой текст');
      expect(backup?.base).toBeNull();
      expect(backup?.pending).toBeNull();
      expect(f.read().conflict).toBeNull();
      f.queue.dispose();
    },
  );
  it('does not discard a conflict when the safety copy cannot be saved', async () => {
    const f = setup(aggregate());
    f.queue.edit(content('local'));
    f.queue.observeRemote(aggregate(content('remote'), 2));
    f.storage.fail = true;
    await f.queue.resolveConflict('server');
    expect(f.queue.getSnapshot().draft.value.content.title).toBe('local');
    expect(f.read().conflict?.recipe.title).toBe('remote');
    expect(f.request).not.toHaveBeenCalled();
    f.queue.dispose();
  });
  it('refreshes a clean cached recipe but protects local edits and pending operations', async () => {
    const f = setup(aggregate());
    f.queue.observeRemote(aggregate(content('Fresh'), 2));
    expect(f.read().value.content.title).toBe('Fresh');
    f.queue.edit(content('Local'));
    f.queue.observeRemote(aggregate(content('Remote'), 3));
    expect(f.read().value.content.title).toBe('Local');
    expect(f.read().conflict?.recipe.title).toBe('Remote');
    await f.queue.flush();
    expect(f.request).not.toHaveBeenCalled();
    f.queue.dispose();
  });
  it('does not bind child IDs from a later server revision after replay', async () => {
    const f = setup();
    const transport = f.request.getMockImplementation();
    f.request.mockImplementation(async (command, id, signal) => {
      if (!transport) throw new Error();
      const result = await transport(command, id, signal);
      if (command.action === 'recipes.create') f.setRemote(aggregate(content('Другой автор'), 2));
      return result;
    });
    f.queue.edit(content());
    await f.queue.flush();
    expect(f.read().conflict?.recipe.revision).toBe(2);
    expect(f.read().value.ingredients[0]?.id).toBeUndefined();
    expect(f.read().pending).toBeNull();
    f.queue.dispose();
  });
  it('cancels only its own prepared operation before resolving', async () => {
    const f = setup(aggregate());
    f.queue.edit(content('local'));
    f.setRemote(aggregate(content('remote'), 2));
    await f.queue.flush();
    const pending = f.read().pending;
    if (!pending) throw new Error('fixture');
    const transport = f.request.getMockImplementation();
    f.request.mockImplementation(async (command, id, signal) => {
      if (command.action === 'recipes.operations.list')
        return {
          kind: 'operations',
          operations: [
            {
              operationId: pending.requestId,
              entityId: f.draft.base?.recipe.id ?? '',
              action: 'recipes.updateContent',
              startedAt: new Date().toISOString(),
              canResume: false,
            },
          ],
        };
      if (command.action === 'recipes.operations.cancel')
        return {
          kind: 'saved',
          operationId: pending.requestId,
          entityType: 'recipe',
          entityId: f.draft.base?.recipe.id ?? '',
          revision: 2,
          outcome: 'cancelled',
        };
      if (!transport) throw new Error();
      return transport(command, id, signal);
    });
    await f.queue.resolveConflict('server');
    expect(
      f.request.mock.calls.find(([command]) => command.action === 'recipes.operations.cancel')?.[0],
    ).toMatchObject({ payload: { operationId: pending.requestId } });
    f.queue.dispose();
  });
});
