import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { templateSchema } from '@tastory/contracts';
import { other, timestamp } from '../test-support/journal-fixture';
import { persistenceFixture } from '../test-support/recipe-persistence-fixture';
import { publishTemplateMutation, readTemplateState } from './template-storage';

const now = () => new Date(timestamp);

describe('durable template storage', () => {
  it('publishes once, replays the same request and rejects a changed retry', () => {
    const f = persistenceFixture();
    const requestId = randomUUID();
    const template = templateSchema.parse({
      id: requestId,
      workspaceId: f.context.workspaceId,
      ownerUserId: other,
      kind: 'custom',
      name: 'Семейная страница',
      description: 'Личный шаблон',
      category: 'dish',
      layout: 'notebook',
      visibility: 'private',
      status: 'active',
      sourceTemplateId: null,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const operation = {
      requestId,
      workspaceId: f.context.workspaceId,
      userId: other,
      action: 'templates.create' as const,
      entityId: template.id,
      payloadHash: 'a'.repeat(64),
      startedAt: timestamp,
    };
    expect(
      publishTemplateMutation(f.store, operation, [{ table: 'Templates', value: template }], now),
    ).toBe('committed');
    expect(
      publishTemplateMutation(f.store, operation, [{ table: 'Templates', value: template }], now),
    ).toBe('replayed');
    expect(readTemplateState(f.store).templates.get(template.id)).toMatchObject({
      name: 'Семейная страница',
    });
    expect(() =>
      publishTemplateMutation(
        f.store,
        { ...operation, payloadHash: 'b'.repeat(64) },
        [{ table: 'Templates', value: template }],
        now,
      ),
    ).toThrow('TEMPLATE_CONFLICT');
  });
});
