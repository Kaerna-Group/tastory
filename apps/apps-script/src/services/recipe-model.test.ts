import { describe, expect, it, vi } from 'vitest';
import { recipeSummarySchema, recipeAggregateSchema } from '@tastory/contracts';
import {
  readRecipeAggregate,
  listRecipeSummaries,
  listRecipeTags,
  authorizeRecipeObject,
  authorizeRecipeTagAssignment,
  authorizeRecipeCreate,
  authorizeRecipeUpdate,
  authorizeTagCreate,
} from './recipe-model';
import { recipeFixture, recipeIds } from '../test-support/recipe-fixture';

function at<T>(items: readonly T[], index = 0): T {
  const item = items[index];
  if (!item) throw new Error('Missing fixture item');
  return item;
}

const targets = [
  { kind: 'recipe', id: recipeIds.recipe },
  { kind: 'ingredient', id: recipeIds.ingredient },
  { kind: 'step', id: recipeIds.step },
  { kind: 'recipeTag', recipeId: recipeIds.recipe, tagId: recipeIds.tag },
];

describe('server recipe model', () => {
  it.each(['author', 'owner'] as const)('%s can read a complete private aggregate', (who) => {
    const f = recipeFixture(who);
    expect(readRecipeAggregate(f.context, f.ids.recipe)).toEqual(f.aggregate);
    expect(listRecipeSummaries(f.context)).toHaveLength(1);
  });
  it.each(['other', 'viewer'] as const)(
    '%s cannot discover a private recipe or its children',
    (who) => {
      const f = recipeFixture(who);
      expect(() => readRecipeAggregate(f.context, f.ids.recipe)).toThrow('ACCESS_DENIED');
      expect(f.reader.getAggregate).not.toHaveBeenCalled();
      expect(listRecipeSummaries(f.context)).toEqual([]);
      for (const target of targets)
        expect(() => authorizeRecipeObject(f.context, { ...target, action: 'read' })).toThrow(
          'ACCESS_DENIED',
        );
      // Tags are a shared workspace dictionary, but reveal no recipe relationships.
      expect(listRecipeTags(f.context)).toEqual(f.aggregate.tags);
    },
  );
  it.each(['other', 'viewer'] as const)(
    '%s reads shared children without seeing private notes',
    (who) => {
      const f = recipeFixture(who);
      f.aggregate.recipe.visibility = 'workspace';
      const result = readRecipeAggregate(f.context, f.ids.recipe);
      expect(result.recipe.notes).toBe('');
      expect(result.ingredients).toEqual(f.aggregate.ingredients);
      expect(recipeAggregateSchema.safeParse(result).success).toBe(true);
      expect(f.aggregate.recipe.notes).toBe('Личный секрет');
      expect(authorizeRecipeObject(f.context, { ...targets[0], action: 'read' })).toMatchObject({
        notes: '',
      });
      for (const target of targets.slice(1))
        expect(authorizeRecipeObject(f.context, { ...target, action: 'read' })).toBeTruthy();
      const summaries = listRecipeSummaries(f.context);
      expect(summaries).toHaveLength(1);
      expect(recipeSummarySchema.safeParse(summaries[0]).success).toBe(true);
      expect(JSON.stringify(summaries)).not.toContain('Личный секрет');
      expect(summaries[0]).not.toHaveProperty('notes');
      expect(summaries[0]).not.toHaveProperty('ingredients');
    },
  );
  it.each(['other', 'viewer'] as const)(
    '%s cannot write shared objects despite a stale owner session',
    (who) => {
      const f = recipeFixture(who);
      f.aggregate.recipe.visibility = 'workspace';
      for (const target of targets)
        expect(() => authorizeRecipeObject(f.context, { ...target, action: 'delete' })).toThrow(
          'ACCESS_DENIED',
        );
      expect(() => authorizeRecipeUpdate(f.context, f.update)).toThrow('ACCESS_DENIED');
      expect(() =>
        authorizeRecipeTagAssignment(f.context, { recipeId: f.ids.recipe, tagId: f.ids.tag }),
      ).toThrow('ACCESS_DENIED');
      expect(() =>
        authorizeRecipeObject(f.context, { kind: 'tag', id: f.ids.tag, action: 'update' }),
      ).toThrow('ACCESS_DENIED');
    },
  );
  it('viewer cannot create recipes or tags even with an owner session claim', () => {
    const f = recipeFixture('viewer');
    expect(() => authorizeRecipeCreate(f.context, { value: f.value })).toThrow('ACCESS_DENIED');
    expect(() => authorizeTagCreate(f.context, { name: 'Новый', colorToken: 'neutral' })).toThrow(
      'ACCESS_DENIED',
    );
  });
  it('uses the internal user ID and workspace from current server membership on creation', () => {
    const f = recipeFixture();
    const result = authorizeRecipeCreate(f.context, { value: f.value });
    expect(result).toMatchObject({
      ownerUserId: f.ids.author,
      workspaceId: f.ids.workspace,
      input: { visibility: 'private' },
    });
    expect(result.ownerUserId).not.toBe(f.context.session.user.id);
    expect(() =>
      authorizeRecipeCreate(f.context, { value: f.value, ownerUserId: f.ids.owner }),
    ).toThrow('RECIPE_INVALID');
    expect(() =>
      authorizeRecipeCreate(f.context, { value: { ...f.value, tagIds: [f.ids.foreign] } }),
    ).toThrow('ACCESS_DENIED');
  });
  it.each(['user', 'membership', 'removed'] as const)(
    'rejects revoked %s on the very next operation',
    (kind) => {
      const f = recipeFixture();
      expect(readRecipeAggregate(f.context, f.ids.recipe)).toBeTruthy();
      if (kind === 'user') at(f.directory.users, 1).status = 'disabled';
      if (kind === 'membership') at(f.directory.members, 1).status = 'disabled';
      if (kind === 'removed') f.directory.members.splice(1, 1);
      expect(() => readRecipeAggregate(f.context, f.ids.recipe)).toThrow('ACCESS_DENIED');
      expect(() => authorizeRecipeUpdate(f.context, f.update)).toThrow('ACCESS_DENIED');
      expect(() => listRecipeTags(f.context)).toThrow('ACCESS_DENIED');
    },
  );
  it('does not cache a previously authorized role', () => {
    const f = recipeFixture();
    expect(authorizeRecipeUpdate(f.context, f.update)).toBeTruthy();
    at(f.directory.members, 1).role = 'viewer';
    expect(() => authorizeRecipeUpdate(f.context, f.update)).toThrow('ACCESS_DENIED');
    expect(readRecipeAggregate(f.context, f.ids.recipe).recipe.notes).toBe('Личный секрет');
  });
  it('fails closed for expired or malformed sessions and expiry during a read', () => {
    const f = recipeFixture();
    for (const expiresAt of ['invalid', '2026-09-03T12:00:00.000Z']) {
      f.context.session.expiresAt = expiresAt;
      expect(() => listRecipeSummaries(f.context)).toThrow('UNAUTHENTICATED');
    }
    f.context.session.expiresAt = '2026-09-03T13:00:00.000Z';
    f.context.now = vi
      .fn()
      .mockReturnValueOnce(new Date('2026-09-03T12:00:00Z'))
      .mockReturnValue(new Date('2026-09-03T13:00:00Z'));
    expect(() => readRecipeAggregate(f.context, f.ids.recipe)).toThrow('UNAUTHENTICATED');
  });
  it('does not treat an internal UUID as an authenticated Google subject', () => {
    const f = recipeFixture();
    f.context.session.user.id = f.ids.author;
    expect(() => listRecipeSummaries(f.context)).toThrow('ACCESS_DENIED');
  });
  it('rejects malformed directories instead of trusting session roles', () => {
    const f = recipeFixture();
    f.context.readDirectory = () => ({ users: [] });
    expect(() => listRecipeSummaries(f.context)).toThrow('AUTH_UNAVAILABLE');
  });
  it('uses identical errors for missing and forbidden objects', () => {
    const f = recipeFixture('other');
    for (const id of [f.ids.recipe, f.ids.foreign])
      expect(() => readRecipeAggregate(f.context, id)).toThrow('ACCESS_DENIED');
    expect(() =>
      authorizeRecipeObject(f.context, { kind: 'ingredient', id: f.ids.foreign, action: 'read' }),
    ).toThrow('ACCESS_DENIED');
  });
  it('rejects invalid IDs and unsupported actions before reading objects', () => {
    const f = recipeFixture();
    expect(() => readRecipeAggregate(f.context, 'not-a-uuid')).toThrow('RECIPE_INVALID');
    expect(() =>
      authorizeRecipeObject(f.context, {
        kind: 'recipe',
        id: f.ids.recipe,
        action: 'transferOwner',
      }),
    ).toThrow('RECIPE_INVALID');
    expect(f.reader.getRecipe).not.toHaveBeenCalled();
  });
  it.each(['ingredient', 'step'] as const)(
    'resolves %s permissions via its stored parent',
    (kind) => {
      const f = recipeFixture();
      const child = kind === 'ingredient' ? at(f.aggregate.ingredients) : at(f.aggregate.steps);
      child.recipeId = f.ids.foreign;
      expect(() =>
        authorizeRecipeObject(f.context, { kind, id: child.id, action: 'read' }),
      ).toThrow('ACCESS_DENIED');
      expect(f.reader.getRecipe).toHaveBeenCalledWith(f.ids.foreign);
      expect(() =>
        authorizeRecipeObject(f.context, {
          kind,
          id: child.id,
          recipeId: f.ids.recipe,
          action: 'read',
        }),
      ).toThrow('RECIPE_INVALID');
    },
  );
  it('rejects a repository returning another ID', () => {
    const f = recipeFixture();
    f.reader.getRecipe.mockReturnValue({ ...f.aggregate.recipe, id: f.ids.foreign });
    expect(() => readRecipeAggregate(f.context, f.ids.recipe)).toThrow('ACCESS_DENIED');
    f.reader.getIngredient.mockReturnValue({ ...f.aggregate.ingredients[0], id: f.ids.foreign });
    expect(() => authorizeRecipeObject(f.context, { ...targets[1], action: 'read' })).toThrow(
      'ACCESS_DENIED',
    );
  });
  it('owner cannot access foreign-workspace recipes or assign foreign tags', () => {
    const f = recipeFixture('owner');
    f.aggregate.recipe.workspaceId = f.ids.foreign;
    f.aggregate.recipe.visibility = 'workspace';
    expect(listRecipeSummaries(f.context)).toEqual([]);
    expect(() => readRecipeAggregate(f.context, f.ids.recipe)).toThrow('ACCESS_DENIED');
    f.aggregate.recipe.workspaceId = f.ids.workspace;
    at(f.aggregate.tags).workspaceId = f.ids.foreign;
    expect(() =>
      authorizeRecipeTagAssignment(f.context, { recipeId: f.ids.recipe, tagId: f.ids.tag }),
    ).toThrow('ACCESS_DENIED');
    expect(listRecipeTags(f.context)).toEqual([]);
  });
  it('checks both ends of a stored recipe/tag relationship', () => {
    const f = recipeFixture();
    f.reader.getRecipeTag.mockReturnValue({ ...f.aggregate.recipeTags[0], tagId: f.ids.foreign });
    expect(() => authorizeRecipeObject(f.context, { ...targets[3], action: 'read' })).toThrow(
      'ACCESS_DENIED',
    );
    f.reader.getRecipeTag.mockReturnValue(null);
    expect(() => authorizeRecipeObject(f.context, { ...targets[3], action: 'read' })).toThrow(
      'ACCESS_DENIED',
    );
  });
  it('rejects corrupt aggregate relations and inconsistent recipe snapshots', () => {
    const f = recipeFixture();
    f.reader.getAggregate.mockReturnValue({
      ...f.aggregate,
      steps: [{ ...f.aggregate.steps[0], recipeId: f.ids.foreign }],
    });
    expect(() => readRecipeAggregate(f.context, f.ids.recipe)).toThrow('RECIPE_UNAVAILABLE');
    f.reader.getAggregate.mockReturnValue({
      ...f.aggregate,
      recipe: { ...f.aggregate.recipe, revision: 2 },
    });
    expect(() => readRecipeAggregate(f.context, f.ids.recipe)).toThrow('RECIPE_UNAVAILABLE');
    f.reader.getRecipe.mockReturnValue({ ...f.aggregate.recipe, status: 'unknown' });
    expect(() => readRecipeAggregate(f.context, f.ids.recipe)).toThrow('RECIPE_UNAVAILABLE');
  });
  it.each(['ownerUserId', 'createdBy', 'assignedBy'] as const)(
    'checks the %s foreign key',
    (field) => {
      const f = recipeFixture();
      if (field === 'ownerUserId') f.aggregate.recipe.ownerUserId = f.ids.foreign;
      if (field === 'createdBy') at(f.aggregate.tags).createdBy = f.ids.foreign;
      if (field === 'assignedBy') at(f.aggregate.recipeTags).assignedBy = f.ids.foreign;
      expect(() => readRecipeAggregate(f.context, f.ids.recipe)).toThrow('RECIPE_UNAVAILABLE');
    },
  );
  it('retains historical recipes after their author is disabled', () => {
    const f = recipeFixture('owner');
    at(f.directory.users, 1).status = 'disabled';
    at(f.directory.members, 1).status = 'disabled';
    expect(readRecipeAggregate(f.context, f.ids.recipe)).toEqual(f.aggregate);
  });
  it('orders children by position without mutating storage', () => {
    const f = recipeFixture();
    f.aggregate.ingredients.unshift({
      ...at(f.aggregate.ingredients),
      id: f.ids.foreign,
      position: 10,
    });
    f.aggregate.steps.unshift({ ...at(f.aggregate.steps), id: f.ids.foreign, position: 10 });
    const result = readRecipeAggregate(f.context, f.ids.recipe);
    expect(result.ingredients.map((i) => i.position)).toEqual([0, 10]);
    expect(result.steps.map((s) => s.position)).toEqual([0, 10]);
    expect(f.aggregate.steps.map((s) => s.position)).toEqual([10, 0]);
  });
  it('author can manage children and owner can manage another author’s recipe', () => {
    for (const who of ['author', 'owner'] as const) {
      const f = recipeFixture(who);
      for (const target of targets)
        expect(authorizeRecipeObject(f.context, { ...target, action: 'delete' })).toBeTruthy();
      expect(
        authorizeRecipeObject(f.context, { kind: 'tag', id: f.ids.tag, action: 'update' }),
      ).toBeTruthy();
      expect(
        authorizeRecipeTagAssignment(f.context, { recipeId: f.ids.recipe, tagId: f.ids.tag }),
      ).toMatchObject({ assignedBy: f.ids[who] });
    }
  });
  it('checks revision only after authorization and accepts only existing child IDs', () => {
    const f = recipeFixture();
    expect(() => authorizeRecipeUpdate(f.context, { ...f.update, expectedRevision: 2 })).toThrow(
      'RECIPE_CONFLICT',
    );
    const input = {
      ...f.update,
      value: {
        ...f.value,
        ingredients: [{ ...f.value.ingredients[0], id: f.ids.ingredient }],
        steps: [{ ...f.value.steps[0], id: f.ids.step }],
      },
    };
    expect(authorizeRecipeUpdate(f.context, input)).toMatchObject({
      actor: { userId: f.ids.author },
    });
    at(input.value.ingredients).id = f.ids.foreign;
    expect(() => authorizeRecipeUpdate(f.context, input)).toThrow('ACCESS_DENIED');
    at(input.value.ingredients).id = f.ids.ingredient;
    at(input.value.steps).id = f.ids.ingredient;
    expect(() => authorizeRecipeUpdate(f.context, input)).toThrow('ACCESS_DENIED');
    f.context.session.user.id = 'other-sub';
    expect(() => authorizeRecipeUpdate(f.context, { ...f.update, expectedRevision: 2 })).toThrow(
      'ACCESS_DENIED',
    );
  });
  it('allows retaining or removing archived tags, but not assigning them anew', () => {
    const f = recipeFixture();
    at(f.aggregate.tags).status = 'archived';
    expect(authorizeRecipeUpdate(f.context, f.update)).toBeTruthy();
    expect(authorizeRecipeObject(f.context, { ...targets[3], action: 'delete' })).toBeTruthy();
    expect(() =>
      authorizeRecipeTagAssignment(f.context, { recipeId: f.ids.recipe, tagId: f.ids.tag }),
    ).toThrow('ACCESS_DENIED');
    expect(() => authorizeRecipeCreate(f.context, { value: f.value })).toThrow('ACCESS_DENIED');
    const storedTag = f.aggregate.tags[0];
    f.reader.getTag.mockReturnValue(storedTag);
    f.aggregate.tags = [];
    f.aggregate.recipeTags = [];
    expect(() => authorizeRecipeUpdate(f.context, f.update)).toThrow('ACCESS_DENIED');
  });
  it('deleted recipes are absent from reads and permit restoration only to managers', () => {
    const f = recipeFixture();
    f.aggregate.recipe.status = 'deleted';
    f.aggregate.recipe.deletedAt = f.aggregate.recipe.updatedAt;
    expect(listRecipeSummaries(f.context)).toEqual([]);
    expect(() => readRecipeAggregate(f.context, f.ids.recipe)).toThrow('ACCESS_DENIED');
    expect(() => authorizeRecipeUpdate(f.context, f.update)).toThrow('ACCESS_DENIED');
    expect(authorizeRecipeObject(f.context, { ...targets[0], action: 'restore' })).toEqual(
      f.aggregate.recipe,
    );
  });
  it('normalizes tag names and rejects duplicates including archived names', () => {
    const f = recipeFixture();
    expect(
      authorizeTagCreate(f.context, { name: '  На   ужин  ', colorToken: 'accent' }),
    ).toMatchObject({
      name: 'На   ужин',
      normalizedName: 'на ужин',
      createdBy: f.ids.author,
      workspaceId: f.ids.workspace,
    });
    for (const status of ['active', 'archived'] as const) {
      at(f.aggregate.tags).status = status;
      expect(() =>
        authorizeTagCreate(f.context, { name: ' СУПЫ ', colorToken: 'neutral' }),
      ).toThrow('RECIPE_CONFLICT');
    }
  });
  it('rejects duplicate records in collection reads', () => {
    const f = recipeFixture();
    f.reader.listRecipes.mockReturnValue([f.aggregate.recipe, f.aggregate.recipe]);
    expect(() => listRecipeSummaries(f.context)).toThrow('RECIPE_UNAVAILABLE');
    f.reader.listTags.mockReturnValue([f.aggregate.tags[0], f.aggregate.tags[0]]);
    expect(() => listRecipeTags(f.context)).toThrow('RECIPE_UNAVAILABLE');
    f.reader.listTags.mockReturnValue([
      f.aggregate.tags[0],
      { ...f.aggregate.tags[0], id: f.ids.foreign },
    ]);
    expect(() => listRecipeTags(f.context)).toThrow('RECIPE_UNAVAILABLE');
  });
});
