export type RecipeRole = 'owner' | 'member' | 'viewer';
export type RecipeVisibility = 'private' | 'workspace';
export type RecipeStatus = 'draft' | 'published' | 'archived' | 'deleted';
export type RecipeActor = Readonly<{
  userId: string;
  workspaceId: string;
  role: RecipeRole;
}>;
export type RecipeAccess = Readonly<{
  id: string;
  workspaceId: string;
  ownerUserId: string;
  visibility: RecipeVisibility;
  status: RecipeStatus;
}>;
export type TagAccess = Readonly<{
  id: string;
  workspaceId: string;
  createdBy: string;
  status: 'active' | 'archived';
}>;
export type RecipeAction =
  'read' | 'update' | 'publish' | 'changeVisibility' | 'archive' | 'restore' | 'delete';
export type TagAction = 'read' | 'update' | 'archive' | 'restore';

// Actors must be resolved from current, active server-side membership for every operation.
export function canCreateRecipe(actor: RecipeActor, workspaceId: string): boolean {
  return actor.workspaceId === workspaceId && (actor.role === 'owner' || actor.role === 'member');
}

export function canManageRecipe(actor: RecipeActor, recipe: RecipeAccess): boolean {
  return (
    canCreateRecipe(actor, recipe.workspaceId) &&
    (actor.role === 'owner' || recipe.ownerUserId === actor.userId)
  );
}

export function canReadRecipe(actor: RecipeActor, recipe: RecipeAccess): boolean {
  return (
    actor.workspaceId === recipe.workspaceId &&
    ['owner', 'member', 'viewer'].includes(actor.role) &&
    recipe.status !== 'deleted' &&
    (recipe.visibility === 'workspace' ||
      recipe.ownerUserId === actor.userId ||
      actor.role === 'owner')
  );
}

export function canReadRecipeNotes(actor: RecipeActor, recipe: RecipeAccess): boolean {
  return (
    canReadRecipe(actor, recipe) && (recipe.ownerUserId === actor.userId || actor.role === 'owner')
  );
}

export function canAccessRecipe(
  actor: RecipeActor,
  recipe: RecipeAccess,
  action: RecipeAction,
): boolean {
  if (action === 'read') return canReadRecipe(actor, recipe);
  if (!canManageRecipe(actor, recipe)) return false;
  switch (action) {
    case 'update':
    case 'changeVisibility':
      return recipe.status === 'draft' || recipe.status === 'published';
    case 'publish':
      return recipe.status === 'draft';
    case 'archive':
      return recipe.status === 'draft' || recipe.status === 'published';
    case 'restore':
      return recipe.status === 'archived' || recipe.status === 'deleted';
    case 'delete':
      return recipe.status !== 'deleted';
    default:
      return false;
  }
}

export function canAccessTag(actor: RecipeActor, tag: TagAccess, action: TagAction): boolean {
  if (actor.workspaceId !== tag.workspaceId) return false;
  if (action === 'read') return ['owner', 'member', 'viewer'].includes(actor.role);
  if (
    !canCreateRecipe(actor, tag.workspaceId) ||
    (actor.role !== 'owner' && actor.userId !== tag.createdBy)
  )
    return false;
  switch (action) {
    case 'update':
    case 'archive':
      return tag.status === 'active';
    case 'restore':
      return tag.status === 'archived';
    default:
      return false;
  }
}

export function canAssignRecipeTag(
  actor: RecipeActor,
  recipe: RecipeAccess,
  tag: TagAccess,
): boolean {
  return (
    canAccessRecipe(actor, recipe, 'update') &&
    canAccessTag(actor, tag, 'read') &&
    tag.status === 'active'
  );
}
