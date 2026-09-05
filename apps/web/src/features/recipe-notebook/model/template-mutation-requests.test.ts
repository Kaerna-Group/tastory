import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/shared/api';
import {
  BUILTIN_RECIPE_TEMPLATES,
  DEFAULT_RECIPE_THEME,
  RECIPE_DESIGN_VERSION,
  RECIPE_LAYOUT_ALGORITHM_VERSION,
  RECIPE_LAYOUT_VERSION,
} from '@tastory/contracts';
import type { TemplateCommand, TemplateData } from '@tastory/contracts';
import { TemplateMutationRequests, templateMutationScope } from './template-mutation-requests';

const request1 = '00000000-0000-4000-8000-000000000001';
const request2 = '00000000-0000-4000-8000-000000000002';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const create = (name = 'Завтрак') =>
  ({
    action: 'templates.create',
    payload: {
      name,
      description: 'Сохранённые поля',
      layout: 'hearth',
      visibility: 'private',
    },
  }) as const;
const design = (name = 'Страница А') => ({
  action: 'recipes.design.save' as const,
  payload: {
    recipeId: request2,
    expectedRevision: 1 as const,
    value: {
      version: RECIPE_DESIGN_VERSION,
      layout: 'hearth' as const,
      layoutVersion: RECIPE_LAYOUT_VERSION,
      layoutAlgorithmVersion: RECIPE_LAYOUT_ALGORITHM_VERSION,
      theme: { ...DEFAULT_RECIPE_THEME, name },
      elements: [],
    },
  },
});

function saved(outcome: 'committed' | 'replayed'): TemplateData {
  const source = BUILTIN_RECIPE_TEMPLATES[0];
  if (!source) throw new Error('fixture');
  return {
    kind: 'template',
    template: {
      ...source,
      id: request1,
      workspaceId: request2,
      kind: 'custom',
      ownerUserId: request2,
      sourceTemplateId: source.id,
    },
    authorName: 'Повар',
    canManage: true,
    canCopy: false,
    outcome,
  };
}

describe('TemplateMutationRequests', () => {
  it('replays a completed write after a lost response and reload without duplicating it', async () => {
    const storage = new MemoryStorage();
    const ids: string[] = [];
    const receipts = new Set<string>();
    let writes = 0;
    const request = async (_command: TemplateCommand, requestId: string) => {
      ids.push(requestId);
      if (receipts.has(requestId)) return saved('replayed');
      receipts.add(requestId);
      writes += 1;
      throw new ApiClientError('TRANSPORT_ERROR', 'Ответ потерян.', requestId);
    };
    const scope = templateMutationScope('https://api.example.test', 'chef-sub');
    const first = new TemplateMutationRequests(storage, scope, request, () => request1);

    await expect(first.execute(create())).rejects.toThrow('Ответ потерян');
    const afterReload = new TemplateMutationRequests(storage, scope, request, () => request2);
    await expect(afterReload.execute(create())).resolves.toMatchObject({ outcome: 'replayed' });
    expect(ids).toEqual([request1, request1]);
    expect(writes).toBe(1);
    expect(afterReload.pending()).toEqual([]);
  });

  it('keeps entered fields for an unknown result but never stores a credential', async () => {
    const storage = new MemoryStorage();
    const scope = templateMutationScope('https://api.example.test', 'chef-sub');
    const requests = new TemplateMutationRequests(
      storage,
      scope,
      async () => {
        throw new DOMException('Unmounted', 'AbortError');
      },
      () => request1,
    );

    await expect(requests.execute(create('Семейный ужин'))).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(requests.pending('templates.create')).toMatchObject([
      {
        requestId: request1,
        command: {
          payload: { name: 'Семейный ужин', description: 'Сохранённые поля' },
        },
      },
    ]);
    expect([...storage.values.values()].join('')).not.toContain('credential');
    expect([...storage.values.values()].join('')).not.toContain('private-token');
  });

  it('uses a new id for a new intent and clears a known rejection', async () => {
    const storage = new MemoryStorage();
    const uuid = vi.fn().mockReturnValueOnce(request1).mockReturnValueOnce(request2);
    const request = vi
      .fn()
      .mockRejectedValueOnce(new ApiClientError('TRANSPORT_ERROR', 'unknown'))
      .mockRejectedValueOnce(new ApiClientError('TEMPLATE_CONFLICT', 'known'));
    const requests = new TemplateMutationRequests(storage, 'scope', request, uuid);

    await expect(requests.execute(create('Завтрак'))).rejects.toThrow('unknown');
    await expect(requests.execute(create('Ужин'))).rejects.toThrow('known');
    expect(request.mock.calls.map((call) => call[1])).toEqual([request1, request2]);
    expect(requests.pending()).toMatchObject([{ requestId: request1 }]);
  });

  it('does not replay another account pending command', async () => {
    const storage = new MemoryStorage();
    const request = vi.fn().mockRejectedValue(new ApiClientError('TRANSPORT_ERROR', 'unknown'));
    const chef = new TemplateMutationRequests(
      storage,
      templateMutationScope('api', 'chef-sub'),
      request,
      () => request1,
    );
    await expect(chef.execute(create())).rejects.toThrow('unknown');

    const viewerRequest = vi.fn().mockResolvedValue(saved('committed'));
    const viewer = new TemplateMutationRequests(
      storage,
      templateMutationScope('api', 'viewer-sub'),
      viewerRequest,
      () => request2,
    );
    await viewer.execute(create());
    expect(viewerRequest).toHaveBeenCalledWith(create(), request2, undefined);
    expect(chef.pending()).toMatchObject([{ requestId: request1 }]);
  });

  it('keeps a conflicting local design and supersedes it only for a new intent', async () => {
    const storage = new MemoryStorage();
    const uuid = vi.fn().mockReturnValueOnce(request1).mockReturnValueOnce(request2);
    const request = vi.fn().mockRejectedValue(new ApiClientError('TEMPLATE_CONFLICT', 'conflict'));
    const requests = new TemplateMutationRequests(storage, 'scope', request, uuid);

    await expect(requests.execute(design())).rejects.toThrow('conflict');
    expect(requests.pending()).toMatchObject([{ requestId: request1, command: design() }]);
    const reloaded = new TemplateMutationRequests(storage, 'scope', request, uuid);
    await expect(reloaded.execute(design())).rejects.toThrow('conflict');
    expect(request.mock.calls.map((call) => call[1])).toEqual([request1, request1]);

    await expect(reloaded.execute(design('Страница Б'))).rejects.toThrow('conflict');
    expect(request.mock.calls.at(-1)?.[1]).toBe(request2);
    expect(reloaded.pending()).toMatchObject([
      { requestId: request2, command: { payload: { value: { theme: { name: 'Страница Б' } } } } },
    ]);
    reloaded.discardRecipeDesign(request2);
    expect(reloaded.pending()).toEqual([]);
  });
});
