import { z } from 'zod';
import {
  recipeCommandSchema,
  recipeAggregateSchema,
  tagSchema,
  recipeSchema,
} from '@tastory/contracts';
import type { RecipeMutation, RecipeReceipt, RecipeData } from '@tastory/contracts';
import { canCreateRecipe, canManageRecipe, canAssignRecipeTag } from '@tastory/domain';
import type { RecipeActor } from '@tastory/domain';
import { AuthError } from '../auth/google-token';
import { parseWorkspaceDirectory, resolveWorkspaceAccess } from '../auth/workspace-access';
import type { RecipeModelContext } from './recipe-model';
import { createRecipeReader } from './recipe-reader';
import type { RecipeWriteContext } from './recipe-context';
export type { RecipeWriteContext } from './recipe-context';
import {
  aggregateSnapshot,
  planRecipeMutation,
  planRecipeVersionRestore,
  recipeObjectId,
} from './recipe-write-plan';
import { readRecipeVersion } from './recipe-history';
import {
  RecipeStorageError,
  recipeRows,
  readRecipeOperations,
  recipeOperationSchema,
  encodeRecipeRow,
  snapshotForOperation,
  dataTables,
  countFields,
  canonicalRecipeJson,
  canonicalRecipeSnapshotJson,
  emptyRecipeSnapshot,
} from './recipe-storage';
import type { RecipeOperation, RecipeSnapshot } from './recipe-storage';
import { RECIPE_OPERATION_LIMIT, RECIPE_ROW_LIMIT } from '../schema/recipe-schema';
function actor(context: RecipeWriteContext): RecipeActor {
  const expires = Date.parse(context.session.expiresAt);
  if (!Number.isFinite(expires) || expires <= context.now().getTime())
    throw new AuthError('UNAUTHENTICATED');
  return resolveWorkspaceAccess(
    parseWorkspaceDirectory(context.readDirectory()),
    context.session.user.id,
    context.workspaceId,
  );
}
function modelContext(context: RecipeWriteContext): RecipeModelContext {
  return { ...context, reader: createRecipeReader(context.store, context.sha256) };
}
function authorizeOperation(
  context: RecipeWriteContext,
  op: RecipeOperation,
  requireOriginalActor: boolean,
) {
  const user = actor(context);
  if (
    user.workspaceId !== op.workspaceId ||
    !canCreateRecipe(user, op.workspaceId) ||
    (requireOriginalActor
      ? user.userId !== op.userId
      : user.userId !== op.userId && user.role !== 'owner')
  )
    throw new AuthError('ACCESS_DENIED');
  const reader = createRecipeReader(context.store, context.sha256);
  if (op.entityType === 'recipe') {
    const current = reader.getRecipe(op.entityId);
    if (current) {
      if (!canManageRecipe(user, recipeSchema.parse(current))) throw new AuthError('ACCESS_DENIED');
    } else if (op.baseRevision !== 0) throw new RecipeStorageError();
  }
  return user;
}
function receipt(op: RecipeOperation, outcome: RecipeReceipt['outcome']): RecipeReceipt {
  return {
    operationId: op.requestId,
    entityId: op.entityId,
    entityType: op.entityType,
    revision: op.revision,
    outcome,
  };
}
function validateSnapshot(
  context: RecipeWriteContext,
  op: RecipeOperation,
  snapshot: RecipeSnapshot,
) {
  if (context.sha256(canonicalRecipeSnapshotJson(snapshot)) !== op.snapshotHash)
    throw new RecipeStorageError();
  const reader = createRecipeReader(context.store, context.sha256);
  if (op.entityType === 'tag') {
    const tag = tagSchema.parse(snapshot.Tags[0]);
    if (
      tag.id !== op.entityId ||
      tag.workspaceId !== op.workspaceId ||
      tag.createdBy !== op.userId ||
      tag.revision !== op.revision
    )
      throw new RecipeStorageError();
    if (
      reader
        .listTags(op.workspaceId)
        .some((other) => tagSchema.parse(other).normalizedName === tag.normalizedName)
    )
      throw new RecipeStorageError('RECIPE_CONFLICT');
    if (op.beforeHash !== context.sha256(canonicalRecipeSnapshotJson(emptyRecipeSnapshot())))
      throw new RecipeStorageError();
    const directory = parseWorkspaceDirectory(context.readDirectory());
    if (
      !directory.members.some(
        (member) => member.user_id === tag.createdBy && member.workspace_id === tag.workspaceId,
      )
    )
      throw new RecipeStorageError();
    return;
  }
  const tags = snapshot.RecipeTags.map((link) => reader.getTag(String(link.tagId)));
  const aggregate = recipeAggregateSchema.parse({
    recipe: snapshot.Recipes[0],
    ingredients: snapshot.RecipeIngredients,
    steps: snapshot.RecipeSteps,
    photos: snapshot.RecipePhotos,
    recipeTags: snapshot.RecipeTags,
    tags,
  });
  if (
    aggregate.recipe.id !== op.entityId ||
    aggregate.recipe.workspaceId !== op.workspaceId ||
    aggregate.recipe.revision !== op.revision
  )
    throw new RecipeStorageError();
  const previous = reader.getAggregate(op.entityId);
  const before = previous
    ? aggregateSnapshot(recipeAggregateSchema.parse(previous))
    : emptyRecipeSnapshot();
  if (op.beforeHash !== context.sha256(canonicalRecipeSnapshotJson(before)))
    throw new RecipeStorageError('RECIPE_CONFLICT');
  const user = actor(context);
  const directory = parseWorkspaceDirectory(context.readDirectory());
  const authors = [
    aggregate.recipe.ownerUserId,
    ...aggregate.recipeTags.map((link) => link.assignedBy),
    ...aggregate.tags.map((tag) => tag.createdBy),
  ];
  if (
    authors.some(
      (id) =>
        !directory.members.some(
          (member) => member.user_id === id && member.workspace_id === op.workspaceId,
        ),
    )
  )
    throw new RecipeStorageError();
  const oldLinks = new Set(
    previous ? recipeAggregateSchema.parse(previous).recipeTags.map((link) => link.tagId) : [],
  );
  for (const tag of aggregate.tags) {
    if (!oldLinks.has(tag.id) && !canAssignRecipeTag(user, aggregate.recipe, tag))
      throw new AuthError('ACCESS_DENIED');
  }
}
function latestRevision(context: RecipeWriteContext, op: RecipeOperation) {
  return (
    readRecipeOperations(context.store)
      .filter(
        (entry) =>
          entry.entityId === op.entityId &&
          entry.entityType === op.entityType &&
          entry.workspaceId === op.workspaceId &&
          entry.state.startsWith('committed@'),
      )
      .slice(-1)[0]?.revision ?? 0
  );
}
function commit(context: RecipeWriteContext, op: RecipeOperation): RecipeReceipt {
  authorizeOperation(context, op, false);
  if (latestRevision(context, op) !== op.baseRevision)
    throw new RecipeStorageError('RECIPE_CONFLICT');
  const snapshot = snapshotForOperation(context.store, op);
  validateSnapshot(context, op, snapshot);
  const operations = recipeRows(context.store, 'RecipeOperations');
  const index = operations.findIndex((candidate) => candidate.requestId === op.requestId);
  if (index < 0 || operations[index]?.state !== 'started') throw new RecipeStorageError();
  authorizeOperation(context, op, false);
  const state = `committed@${context.now().toISOString()}`;
  // Validate the final receipt before the single publication write (including clock monotonicity).
  recipeOperationSchema.parse({ ...op, state });
  context.store.writeState('RecipeOperations', index + 2, state);
  context.store.flush();
  if (recipeRows(context.store, 'RecipeOperations')[index]?.state !== state)
    throw new RecipeStorageError();
  return receipt(op, 'committed');
}

export function mutateRecipe(
  context: RecipeWriteContext,
  input: RecipeMutation,
  requestId: string,
): RecipeReceipt {
  const user = actor(context);
  if (!canCreateRecipe(user, user.workspaceId)) throw new AuthError('ACCESS_DENIED');
  if (!z.uuid().safeParse(requestId).success) throw new RecipeStorageError('OPERATION_MISMATCH');
  const command = recipeCommandSchema.parse(input);
  if (
    command.action !== 'recipes.create' &&
    command.action !== 'recipes.updateContent' &&
    command.action !== 'recipes.archive' &&
    command.action !== 'recipes.restore' &&
    command.action !== 'recipes.version.restore' &&
    command.action !== 'recipes.photos.add' &&
    command.action !== 'recipes.photos.delete' &&
    command.action !== 'tags.create'
  )
    throw new RecipeStorageError('OPERATION_MISMATCH');
  const payloadHash = context.sha256(
    canonicalRecipeJson({
      version: 1,
      command,
      userId: user.userId,
      workspaceId: user.workspaceId,
    }),
  );
  let operations = readRecipeOperations(context.store);
  let op = operations.find((entry) => entry.requestId === requestId);
  if (op) {
    if (
      op.payloadHash !== payloadHash ||
      op.userId !== user.userId ||
      op.workspaceId !== user.workspaceId ||
      op.action !== command.action
    )
      throw new RecipeStorageError('OPERATION_MISMATCH');
    authorizeOperation(context, op, true);
    if (op.state.startsWith('committed@')) return receipt(op, 'replayed');
    if (op.state.startsWith('cancelled@')) throw new RecipeStorageError('RECIPE_CANCELLED');
  }
  const entityId =
    op?.entityId ??
    (command.action === 'recipes.create' || command.action === 'tags.create'
      ? recipeObjectId(requestId, 'entity', context.sha256)
      : command.payload.recipeId);
  const entityType = command.action === 'tags.create' ? 'tag' : 'recipe';
  // Reserve an entity until publication/cancellation; tag creation reserves the shared dictionary.
  if (
    operations.some(
      (entry) =>
        entry.requestId !== requestId &&
        entry.workspaceId === user.workspaceId &&
        entry.state === 'started' &&
        ((entry.entityId === entityId && entry.entityType === entityType) ||
          (entry.entityType === 'tag' && entityType === 'tag')),
    )
  )
    throw new RecipeStorageError('RECIPE_PENDING');
  const timestamp = op?.startedAt ?? context.now().toISOString();
  const plan =
    command.action === 'recipes.version.restore'
      ? planRecipeVersionRestore(
          modelContext(context),
          command,
          timestamp,
          readRecipeVersion(context, command.payload.recipeId, command.payload.targetRevision),
        )
      : planRecipeMutation(
          modelContext(context),
          command,
          { requestId, entityId, timestamp },
          context.sha256,
        );
  const counts = Object.fromEntries(
    dataTables.flatMap((table) => {
      const field = countFields[table as keyof typeof countFields];
      return field ? [[field, plan.snapshot[table].length]] : [];
    }),
  );
  const expected = recipeOperationSchema.parse({
    requestId,
    workspaceId: user.workspaceId,
    userId: user.userId,
    action: command.action,
    entityId,
    entityType,
    baseRevision: plan.baseRevision,
    revision: plan.baseRevision + 1,
    payloadHash,
    beforeHash: context.sha256(canonicalRecipeSnapshotJson(plan.before)),
    snapshotHash: context.sha256(canonicalRecipeSnapshotJson(plan.snapshot)),
    ...counts,
    startedAt: timestamp,
    state: 'started',
  });
  if (op && canonicalRecipeJson(op) !== canonicalRecipeJson(expected))
    throw new RecipeStorageError('OPERATION_MISMATCH');
  // Validate every encoded field and capacity before creating a pending operation.
  const encoded = new Map(
    dataTables.map((table) => [
      table,
      plan.snapshot[table].map((record) =>
        encodeRecipeRow(table, { versionId: requestId, ...record }),
      ),
    ]),
  );
  const operationRow = encodeRecipeRow('RecipeOperations', expected);
  const activeCount = recipeRows(context.store, 'RecipeOperations').length;
  if (!op && activeCount >= RECIPE_OPERATION_LIMIT) throw new RecipeStorageError('RECIPE_LIMIT');
  for (const table of dataTables) {
    const rows = recipeRows(context.store, table);
    const ownCount = rows.filter((row) => row.versionId === requestId).length;
    if (rows.length + plan.snapshot[table].length - ownCount > RECIPE_ROW_LIMIT)
      throw new RecipeStorageError('RECIPE_LIMIT');
  }
  if (!op) {
    actor(context);
    context.store.writeRows('RecipeOperations', activeCount + 2, [operationRow]);
    context.store.flush();
    operations = readRecipeOperations(context.store);
    op = operations.find((entry) => entry.requestId === requestId);
    if (!op || canonicalRecipeJson(op) !== canonicalRecipeJson(expected))
      throw new RecipeStorageError();
  }
  for (const table of dataTables) {
    const rows = recipeRows(context.store, table);
    const own = rows.filter((row) => row.versionId === requestId);
    const wanted = encoded.get(table) ?? [];
    if (
      own.length > wanted.length ||
      own.some(
        (row, index) =>
          canonicalRecipeJson(encodeRecipeRow(table, row)) !== canonicalRecipeJson(wanted[index]),
      )
    )
      throw new RecipeStorageError();
    if (own.length < wanted.length) {
      authorizeOperation(context, op, true);
      // Bound each Sheets request; a retry verifies and continues the durable prefix.
      for (let offset = own.length; offset < wanted.length; offset += 25) {
        authorizeOperation(context, op, true);
        context.store.writeRows(
          table,
          rows.length + 2 + offset - own.length,
          wanted.slice(offset, offset + 25),
        );
        context.store.flush();
      }
    }
  }
  return commit(context, op);
}

export function resumeRecipeOperation(
  context: RecipeWriteContext,
  requestId: string,
): RecipeReceipt {
  actor(context);
  const op = readRecipeOperations(context.store).find((entry) => entry.requestId === requestId);
  if (!op) throw new AuthError('ACCESS_DENIED');
  authorizeOperation(context, op, false);
  if (op.state.startsWith('committed@')) return receipt(op, 'replayed');
  if (op.state.startsWith('cancelled@')) throw new RecipeStorageError('RECIPE_CANCELLED');
  return commit(context, op);
}
export function cancelRecipeOperation(
  context: RecipeWriteContext,
  requestId: string,
): RecipeReceipt {
  actor(context);
  const operations = readRecipeOperations(context.store);
  const op = operations.find((entry) => entry.requestId === requestId);
  const index = recipeRows(context.store, 'RecipeOperations').findIndex(
    (entry) => entry.requestId === requestId,
  );
  if (!op) throw new AuthError('ACCESS_DENIED');
  authorizeOperation(context, op, false);
  if (op.state.startsWith('committed@')) throw new RecipeStorageError('RECIPE_CONFLICT');
  if (op.state === 'started') {
    const state = `cancelled@${context.now().toISOString()}`;
    recipeOperationSchema.parse({ ...op, state });
    context.store.writeState('RecipeOperations', index + 2, state);
    context.store.flush();
    if (recipeRows(context.store, 'RecipeOperations')[index]?.state !== state)
      throw new RecipeStorageError();
  }
  return receipt(op, 'cancelled');
}
export function listRecipeOperations(
  context: RecipeWriteContext,
): Extract<RecipeData, { kind: 'operations' }> {
  const user = actor(context);
  if (!canCreateRecipe(user, user.workspaceId)) throw new AuthError('ACCESS_DENIED');
  const operations = readRecipeOperations(context.store)
    .filter(
      (op) =>
        op.workspaceId === user.workspaceId &&
        op.state === 'started' &&
        (op.userId === user.userId || user.role === 'owner'),
    )
    .map((op) => {
      let canResume = false;
      try {
        const snapshot = snapshotForOperation(context.store, op);
        canResume = context.sha256(canonicalRecipeSnapshotJson(snapshot)) === op.snapshotHash;
      } catch (error) {
        if (!(error instanceof RecipeStorageError) || error.code !== 'RECIPE_PENDING') throw error;
      }
      return {
        operationId: op.requestId,
        entityId: op.entityId,
        action: op.action,
        startedAt: op.startedAt,
        canResume,
      };
    });
  actor(context);
  return { kind: 'operations', operations };
}
