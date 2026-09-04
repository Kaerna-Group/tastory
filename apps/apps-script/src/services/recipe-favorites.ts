import { recipeSchema } from '@tastory/contracts';
import type { RecipeModelContext } from './recipe-model';
import { authorizeRecipeObject } from './recipe-model';
import { parseWorkspaceDirectory, resolveWorkspaceAccess } from '../auth/workspace-access';
import {
  canonicalRecipeJson,
  encodeRecipeRow,
  readRecipeFavorites,
  recipeFavoriteSchema,
  RecipeStorageError,
} from './recipe-storage';
import type { RecipeStore } from './recipe-storage';

export function setRecipeFavorite(
  context: RecipeModelContext & { store: RecipeStore },
  input: { recipeId: string; favorite: boolean },
  requestId: string,
) {
  const recipe = recipeSchema.parse(
    authorizeRecipeObject(context, { kind: 'recipe', id: input.recipeId, action: 'read' }),
  );
  const actor = resolveWorkspaceAccess(
    parseWorkspaceDirectory(context.readDirectory()),
    context.session.user.id,
    context.workspaceId,
  );
  const expected = recipeFavoriteSchema.parse({
    requestId,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    recipeId: recipe.id,
    isFavorite: input.favorite,
    createdAt: context.now().toISOString(),
  });
  const entries = readRecipeFavorites(context.store);
  const previous = entries.find((entry) => entry.requestId === requestId);
  if (previous) {
    const { createdAt: previousCreatedAt, ...previousPayload } = previous;
    const { createdAt: expectedCreatedAt, ...expectedPayload } = expected;
    void previousCreatedAt;
    void expectedCreatedAt;
    if (canonicalRecipeJson(previousPayload) !== canonicalRecipeJson(expectedPayload))
      throw new RecipeStorageError('OPERATION_MISMATCH');
    return { recipeId: recipe.id, favorite: previous.isFavorite, outcome: 'replayed' as const };
  }
  context.store.writeRows('RecipeFavorites', entries.length + 2, [
    encodeRecipeRow('RecipeFavorites', expected),
  ]);
  context.store.flush();
  const committed = readRecipeFavorites(context.store);
  const saved = committed[committed.length - 1];
  if (!saved || canonicalRecipeJson(saved) !== canonicalRecipeJson(expected))
    throw new RecipeStorageError();
  authorizeRecipeObject(context, { kind: 'recipe', id: input.recipeId, action: 'read' });
  return { recipeId: recipe.id, favorite: expected.isFavorite, outcome: 'committed' as const };
}
