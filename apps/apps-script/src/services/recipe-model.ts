import { z } from 'zod';
import {
  recipeSchema,
  recipeIngredientSchema,
  recipeStepSchema,
  tagSchema,
  recipeTagSchema,
  recipeAggregateSchema,
  recipeCreateInputSchema,
  recipeUpdateInputSchema,
  tagInputSchema,
  normalizeTagName,
} from '@tastory/contracts';
import type { AuthData, Recipe, RecipeAggregate, RecipeSummary, Tag } from '@tastory/contracts';
import {
  canCreateRecipe,
  canAccessRecipe,
  canReadRecipe,
  canReadRecipeNotes,
  canAccessTag,
  canAssignRecipeTag,
} from '@tastory/domain';
import type { RecipeActor } from '@tastory/domain';
import { AuthError } from '../auth/google-token';
import { parseWorkspaceDirectory, resolveWorkspaceAccess } from '../auth/workspace-access';
import type { WorkspaceDirectory } from '../auth/workspace-access';

export class RecipeModelError extends Error {
  constructor(public readonly code: 'RECIPE_INVALID' | 'RECIPE_UNAVAILABLE' | 'RECIPE_CONFLICT') {
    super(code);
  }
}

// Storage adapters return untrusted rows. R-02 will supply the Sheets implementation.
// Write callers must resolve membership, authorize and commit within the same lock;
// the returned objects are not reusable authorization grants.
export type RecipeModelReader = {
  getRecipe: (id: string) => unknown;
  getIngredient: (id: string) => unknown;
  getStep: (id: string) => unknown;
  getTag: (id: string) => unknown;
  getRecipeTag: (recipeId: string, tagId: string) => unknown;
  getAggregate: (recipeId: string) => unknown;
  listRecipes: (workspaceId: string) => readonly unknown[];
  listTags: (workspaceId: string) => readonly unknown[];
  isRecipeFavorite: (workspaceId: string, userId: string, recipeId: string) => boolean;
};
export type RecipeModelContext = {
  session: AuthData;
  workspaceId: string;
  readDirectory: () => unknown;
  reader: RecipeModelReader;
  now: () => Date;
};
type AccessContext = {
  actor: RecipeActor;
  directory: WorkspaceDirectory;
  reader: RecipeModelReader;
};

const recipeIdSchema = z.uuid();
const objectActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('recipe'),
    id: z.uuid(),
    action: z.enum([
      'read',
      'update',
      'publish',
      'changeVisibility',
      'archive',
      'restore',
      'delete',
    ]),
  }),
  z.strictObject({
    kind: z.literal('ingredient'),
    id: z.uuid(),
    action: z.enum(['read', 'update', 'delete']),
  }),
  z.strictObject({
    kind: z.literal('step'),
    id: z.uuid(),
    action: z.enum(['read', 'update', 'delete']),
  }),
  z.strictObject({
    kind: z.literal('tag'),
    id: z.uuid(),
    action: z.enum(['read', 'update', 'archive', 'restore']),
  }),
  z.strictObject({
    kind: z.literal('recipeTag'),
    recipeId: z.uuid(),
    tagId: z.uuid(),
    action: z.enum(['read', 'delete']),
  }),
]);
const assignmentSchema = z.strictObject({ recipeId: z.uuid(), tagId: z.uuid() });

function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new RecipeModelError('RECIPE_INVALID');
  return parsed.data;
}
function parseStored<T>(schema: z.ZodType<T>, value: unknown): T {
  if (value === null || value === undefined) throw new AuthError('ACCESS_DENIED');
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new RecipeModelError('RECIPE_UNAVAILABLE');
  return parsed.data;
}
function requireAccess(allowed: boolean): void {
  // Missing and forbidden IDs have the same externally visible error.
  if (!allowed) throw new AuthError('ACCESS_DENIED');
}
function run<T>(context: RecipeModelContext, operation: (access: AccessContext) => T): T {
  const assertLive = () => {
    const expiry = Date.parse(context.session.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= context.now().getTime())
      throw new AuthError('UNAUTHENTICATED');
  };
  assertLive();
  const directory = parseWorkspaceDirectory(context.readDirectory());
  // AuthData.user.id is Google sub, NOT Users.user_id. Never trust the session role.
  const actor = resolveWorkspaceAccess(directory, context.session.user.id, context.workspaceId);
  const result = operation({ actor, directory, reader: context.reader });
  assertLive();
  return result;
}
function requireUser(access: AccessContext, userId: string, workspaceId: string): void {
  // Historical authors may be disabled; the acting user must be active (resolved above).
  if (!access.directory.members.some((m) => m.user_id === userId && m.workspace_id === workspaceId))
    throw new RecipeModelError('RECIPE_UNAVAILABLE');
}
function loadRecipe(access: AccessContext, id: string): Recipe {
  const recipe = parseStored(recipeSchema, access.reader.getRecipe(id));
  requireAccess(recipe.id === id && recipe.workspaceId === access.actor.workspaceId);
  requireUser(access, recipe.ownerUserId, recipe.workspaceId);
  return recipe;
}
function loadTag(access: AccessContext, id: string): Tag {
  const tag = parseStored(tagSchema, access.reader.getTag(id));
  requireAccess(tag.id === id && canAccessTag(access.actor, tag, 'read'));
  requireUser(access, tag.createdBy, tag.workspaceId);
  return tag;
}
function loadAggregate(access: AccessContext, recipe: Recipe): RecipeAggregate {
  const aggregate = parseStored(recipeAggregateSchema, access.reader.getAggregate(recipe.id));
  if (JSON.stringify(aggregate.recipe) !== JSON.stringify(recipe))
    throw new RecipeModelError('RECIPE_UNAVAILABLE');
  for (const tag of aggregate.tags) {
    requireAccess(canAccessTag(access.actor, tag, 'read'));
    requireUser(access, tag.createdBy, tag.workspaceId);
  }
  for (const link of aggregate.recipeTags) requireUser(access, link.assignedBy, recipe.workspaceId);
  return {
    ...aggregate,
    ingredients: [...aggregate.ingredients].sort((a, b) => a.position - b.position),
    steps: [...aggregate.steps].sort((a, b) => a.position - b.position),
    photos: [...aggregate.photos].sort((a, b) => a.position - b.position),
  };
}
function visibleRecipe(access: AccessContext, recipe: Recipe): Recipe {
  return canReadRecipeNotes(access.actor, recipe) ? recipe : { ...recipe, notes: '' };
}

export function readRecipeAggregate(
  context: RecipeModelContext,
  inputId: unknown,
): RecipeAggregate {
  return run(context, (access) => {
    const recipe = loadRecipe(access, parseInput(recipeIdSchema, inputId));
    requireAccess(canReadRecipe(access.actor, recipe));
    const aggregate = loadAggregate(access, recipe);
    return { ...aggregate, recipe: visibleRecipe(access, recipe) };
  });
}

export function listRecipeSummaries(context: RecipeModelContext): RecipeSummary[] {
  return run(context, (access) => {
    const recipes = access.reader
      .listRecipes(access.actor.workspaceId)
      .map((value) => parseStored(recipeSchema, value));
    if (new Set(recipes.map((recipe) => recipe.id)).size !== recipes.length)
      throw new RecipeModelError('RECIPE_UNAVAILABLE');
    return recipes
      .filter((recipe) => canReadRecipe(access.actor, recipe))
      .map((recipe) => {
        requireUser(access, recipe.ownerUserId, recipe.workspaceId);
        const aggregate = loadAggregate(access, recipe);
        const {
          id,
          workspaceId,
          ownerUserId,
          title,
          description,
          servings,
          prepMinutes,
          cookMinutes,
          visibility,
          status,
          createdAt,
          updatedAt,
          revision,
        } = recipe;
        return {
          id,
          workspaceId,
          ownerUserId,
          title,
          description,
          servings,
          prepMinutes,
          cookMinutes,
          visibility,
          status,
          ingredientNames: aggregate.ingredients.map((ingredient) => ingredient.name),
          tags: aggregate.tags.map(({ id, name, colorToken }) => ({ id, name, colorToken })),
          coverPhotoId: aggregate.photos.find((photo) => photo.kind === 'cover')?.id ?? null,
          favorite: access.reader.isRecipeFavorite(
            access.actor.workspaceId,
            access.actor.userId,
            recipe.id,
          ),
          createdAt,
          updatedAt,
          revision,
        };
      });
  });
}

export function listRecipeTags(context: RecipeModelContext): Tag[] {
  return run(context, (access) => {
    const tags = access.reader
      .listTags(access.actor.workspaceId)
      .map((value) => parseStored(tagSchema, value));
    const visible = tags.filter((tag) => canAccessTag(access.actor, tag, 'read'));
    if (
      new Set(visible.map((tag) => tag.id)).size !== visible.length ||
      new Set(visible.map((tag) => tag.normalizedName)).size !== visible.length
    )
      throw new RecipeModelError('RECIPE_UNAVAILABLE');
    for (const tag of visible) requireUser(access, tag.createdBy, tag.workspaceId);
    return visible;
  });
}

// An ingredient/step's parent always comes from storage, never from the caller.
export function authorizeRecipeObject(context: RecipeModelContext, input: unknown) {
  return run(context, (access) => {
    const target = parseInput(objectActionSchema, input);
    if (target.kind === 'recipe') {
      const recipe = loadRecipe(access, target.id);
      requireAccess(canAccessRecipe(access.actor, recipe, target.action));
      return target.action === 'read' ? visibleRecipe(access, recipe) : recipe;
    }
    if (target.kind === 'tag') {
      const tag = loadTag(access, target.id);
      requireAccess(canAccessTag(access.actor, tag, target.action));
      return tag;
    }
    if (target.kind === 'recipeTag') {
      const recipe = loadRecipe(access, target.recipeId);
      requireAccess(
        canAccessRecipe(access.actor, recipe, target.action === 'read' ? 'read' : 'update'),
      );
      const link = parseStored(
        recipeTagSchema,
        access.reader.getRecipeTag(target.recipeId, target.tagId),
      );
      requireAccess(link.recipeId === recipe.id && link.tagId === target.tagId);
      loadTag(access, link.tagId);
      requireUser(access, link.assignedBy, recipe.workspaceId);
      return link;
    }
    const child =
      target.kind === 'ingredient'
        ? parseStored(recipeIngredientSchema, access.reader.getIngredient(target.id))
        : parseStored(recipeStepSchema, access.reader.getStep(target.id));
    requireAccess(child.id === target.id);
    const recipe = loadRecipe(access, child.recipeId);
    requireAccess(
      canAccessRecipe(access.actor, recipe, target.action === 'read' ? 'read' : 'update'),
    );
    return child;
  });
}

export function authorizeRecipeTagAssignment(context: RecipeModelContext, input: unknown) {
  return run(context, (access) => {
    const target = parseInput(assignmentSchema, input);
    const recipe = loadRecipe(access, target.recipeId);
    requireAccess(canAccessRecipe(access.actor, recipe, 'update'));
    const tag = loadTag(access, target.tagId);
    requireAccess(canAssignRecipeTag(access.actor, recipe, tag));
    return { recipe, tag, assignedBy: access.actor.userId };
  });
}

export function authorizeRecipeCreate(context: RecipeModelContext, input: unknown) {
  return run(context, (access) => {
    requireAccess(canCreateRecipe(access.actor, access.actor.workspaceId));
    const value = parseInput(recipeCreateInputSchema, input);
    const tags = value.value.tagIds.map((id) => loadTag(access, id));
    requireAccess(tags.every((tag) => tag.status === 'active'));
    return {
      input: value,
      workspaceId: access.actor.workspaceId,
      ownerUserId: access.actor.userId,
      tags,
    };
  });
}

export function authorizeRecipeUpdate(context: RecipeModelContext, input: unknown) {
  return run(context, (access) => {
    const value = parseInput(recipeUpdateInputSchema, input);
    const recipe = loadRecipe(access, value.recipeId);
    requireAccess(canAccessRecipe(access.actor, recipe, 'update'));
    if (recipe.revision !== value.expectedRevision) throw new RecipeModelError('RECIPE_CONFLICT');
    const current = loadAggregate(access, recipe);
    for (const [incoming, stored] of [
      [value.value.ingredients, current.ingredients],
      [value.value.steps, current.steps],
    ] as const) {
      const ids = new Set(stored.map((child) => child.id));
      requireAccess(incoming.every((child) => child.id === undefined || ids.has(child.id)));
    }
    const existingTags = new Set(current.recipeTags.map((link) => link.tagId));
    const tags = value.value.tagIds.map((id) => loadTag(access, id));
    requireAccess(tags.every((tag) => tag.status === 'active' || existingTags.has(tag.id)));
    return { input: value, current, tags, actor: access.actor };
  });
}

export function authorizeTagCreate(context: RecipeModelContext, input: unknown) {
  return run(context, (access) => {
    requireAccess(canCreateRecipe(access.actor, access.actor.workspaceId));
    const value = parseInput(tagInputSchema, input);
    const normalizedName = normalizeTagName(value.name);
    for (const stored of access.reader.listTags(access.actor.workspaceId)) {
      const tag = parseStored(tagSchema, stored);
      if (tag.workspaceId === access.actor.workspaceId && tag.normalizedName === normalizedName)
        throw new RecipeModelError('RECIPE_CONFLICT');
    }
    return {
      ...value,
      normalizedName,
      workspaceId: access.actor.workspaceId,
      createdBy: access.actor.userId,
    };
  });
}
