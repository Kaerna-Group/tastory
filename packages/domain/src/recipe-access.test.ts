import { describe, expect, it } from 'vitest';
import {
  canCreateRecipe,
  canReadRecipe,
  canReadRecipeNotes,
  canAccessRecipe,
  canAccessTag,
  canAssignRecipeTag,
} from './recipe-access';
import type {
  RecipeActor,
  RecipeAccess,
  RecipeAction,
  RecipeRole,
  TagAccess,
} from './recipe-access';

const recipe: RecipeAccess = {
  id: 'recipe',
  workspaceId: 'book',
  ownerUserId: 'author',
  visibility: 'private',
  status: 'draft',
};
const tag: TagAccess = { id: 'tag', workspaceId: 'book', createdBy: 'author', status: 'active' };
const actor = (role: RecipeRole, userId = 'other'): RecipeActor => ({
  userId,
  workspaceId: 'book',
  role,
});
const actions: RecipeAction[] = [
  'update',
  'publish',
  'changeVisibility',
  'archive',
  'restore',
  'delete',
];

describe('recipe object permissions', () => {
  it.each([
    ['owner', 'other', true, true],
    ['member', 'author', true, true],
    ['member', 'other', false, false],
    ['viewer', 'author', true, false],
    ['viewer', 'other', false, false],
  ] as const)('%s/%s has private read=%s write=%s', (role, userId, read, write) => {
    const user = actor(role, userId);
    expect(canReadRecipe(user, recipe)).toBe(read);
    expect(canAccessRecipe(user, recipe, 'read')).toBe(read);
    expect(canAccessRecipe(user, recipe, 'update')).toBe(write);
    expect(canReadRecipeNotes(user, recipe)).toBe(read);
    expect(canReadRecipe(user, { ...recipe, visibility: 'workspace' })).toBe(true);
  });
  it.each(['owner', 'member', 'viewer'] as const)('never crosses workspaces for %s', (role) => {
    const outsider = { ...actor(role, 'author'), workspaceId: 'different' };
    expect(canCreateRecipe(outsider, 'book')).toBe(false);
    for (const action of ['read', ...actions] as const)
      expect(canAccessRecipe(outsider, recipe, action)).toBe(false);
    for (const action of ['read', 'update', 'archive', 'restore'] as const)
      expect(canAccessTag(outsider, tag, action)).toBe(false);
    expect(canAssignRecipeTag(outsider, recipe, tag)).toBe(false);
  });
  it('viewer cannot write even their own recipes or tags in any lifecycle state', () => {
    const viewer = actor('viewer', 'author');
    expect(canCreateRecipe(viewer, 'book')).toBe(false);
    for (const status of ['draft', 'published', 'archived', 'deleted'] as const)
      for (const action of actions)
        expect(canAccessRecipe(viewer, { ...recipe, status }, action)).toBe(false);
    for (const action of ['update', 'archive', 'restore'] as const)
      expect(canAccessTag(viewer, tag, action)).toBe(false);
  });
  it.each([
    ['draft', ['update', 'publish', 'changeVisibility', 'archive', 'delete']],
    ['published', ['update', 'changeVisibility', 'archive', 'delete']],
    ['archived', ['restore', 'delete']],
    ['deleted', ['restore']],
  ] as const)('restricts transitions from %s', (status, allowed) => {
    for (const action of actions)
      expect(canAccessRecipe(actor('member', 'author'), { ...recipe, status }, action)).toBe(
        (allowed as readonly string[]).includes(action),
      );
    expect(canReadRecipe(actor('owner'), { ...recipe, status })).toBe(status !== 'deleted');
  });
  it('keeps notes private when a recipe is shared', () => {
    const shared = { ...recipe, visibility: 'workspace' as const };
    expect(canReadRecipeNotes(actor('member'), shared)).toBe(false);
    expect(canReadRecipeNotes(actor('viewer'), shared)).toBe(false);
    expect(canReadRecipeNotes(actor('member', 'author'), shared)).toBe(true);
    expect(canReadRecipeNotes(actor('owner'), shared)).toBe(true);
  });
  it('separates shared tag reading, management and assignment permissions', () => {
    expect(canAccessTag(actor('member'), tag, 'read')).toBe(true);
    expect(canAccessTag(actor('member'), tag, 'update')).toBe(false);
    expect(canAccessTag(actor('owner'), tag, 'archive')).toBe(true);
    expect(canAccessTag(actor('member', 'author'), tag, 'update')).toBe(true);
    expect(canAccessTag(actor('member', 'author'), tag, 'restore')).toBe(false);
    expect(canAccessTag(actor('owner'), { ...tag, status: 'archived' }, 'restore')).toBe(true);
    expect(canAccessTag(actor('owner'), { ...tag, status: 'archived' }, 'update')).toBe(false);
    expect(
      canAssignRecipeTag(actor('member', 'author'), recipe, { ...tag, createdBy: 'other' }),
    ).toBe(true);
    expect(
      canAssignRecipeTag(actor('member', 'author'), recipe, { ...tag, status: 'archived' }),
    ).toBe(false);
    expect(canAssignRecipeTag(actor('member'), { ...recipe, visibility: 'workspace' }, tag)).toBe(
      false,
    );
  });
  it('denies unsupported runtime actions', () => {
    expect(canAccessRecipe(actor('owner'), recipe, 'unknown' as RecipeAction)).toBe(false);
    expect(canAccessTag(actor('owner'), tag, 'unknown' as 'read')).toBe(false);
  });
});
