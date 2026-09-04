import {
  recipeSchema,
  recipeAggregateSchema,
  recipePhotoSchema,
  tagSchema,
} from '@tastory/contracts';
import type {
  RecipeAggregate,
  RecipeMutation,
  RecipeCreateInput,
  RecipeUpdateInput,
} from '@tastory/contracts';
import {
  authorizeRecipeCreate,
  authorizeRecipeUpdate,
  authorizeRecipeObject,
  authorizeTagCreate,
} from './recipe-model';
import type { RecipeModelContext } from './recipe-model';
import { emptyRecipeSnapshot, canonicalRecipeJson, RecipeStorageError } from './recipe-storage';
import type { RecipeSnapshot } from './recipe-storage';

export function recipeObjectId(
  requestId: string,
  name: string,
  sha256: (text: string) => string,
): string {
  const hash = sha256(`${requestId}:${name}`);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new RecipeStorageError();
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export function aggregateSnapshot(aggregate: RecipeAggregate): RecipeSnapshot {
  return {
    Recipes: [aggregate.recipe],
    RecipeIngredients: [...aggregate.ingredients].sort((a, b) => a.position - b.position),
    RecipeSteps: [...aggregate.steps].sort((a, b) => a.position - b.position),
    RecipePhotos: [...aggregate.photos].sort((a, b) =>
      `${a.kind}:${a.stepId ?? ''}:${String(a.position).padStart(3, '0')}`.localeCompare(
        `${b.kind}:${b.stepId ?? ''}:${String(b.position).padStart(3, '0')}`,
      ),
    ),
    RecipeTags: [...aggregate.recipeTags].sort((a, b) => a.tagId.localeCompare(b.tagId)),
    Tags: [],
  };
}
export function planRecipeVersionRestore(
  context: RecipeModelContext,
  command: Extract<RecipeMutation, { action: 'recipes.version.restore' }>,
  timestamp: string,
  target: RecipeAggregate,
) {
  const recipe = recipeSchema.parse(
    authorizeRecipeObject(context, {
      kind: 'recipe',
      id: command.payload.recipeId,
      action: 'update',
    }),
  );
  if (
    recipe.revision !== command.payload.expectedRevision ||
    target.recipe.id !== recipe.id ||
    target.recipe.workspaceId !== recipe.workspaceId ||
    target.recipe.revision !== command.payload.targetRevision ||
    target.recipe.revision >= recipe.revision
  )
    throw new RecipeStorageError('RECIPE_CONFLICT');
  if (target.recipe.visibility !== recipe.visibility)
    authorizeRecipeObject(context, {
      kind: 'recipe',
      id: recipe.id,
      action: 'changeVisibility',
    });
  const current = recipeAggregateSchema.parse(context.reader.getAggregate(recipe.id));
  const after = recipeAggregateSchema.parse({
    ...target,
    recipe: {
      ...target.recipe,
      ownerUserId: current.recipe.ownerUserId,
      status: current.recipe.status,
      createdAt: current.recipe.createdAt,
      updatedAt: timestamp,
      revision: current.recipe.revision + 1,
      deletedAt: null,
    },
  });
  return {
    snapshot: aggregateSnapshot(after),
    before: aggregateSnapshot(current),
    baseRevision: current.recipe.revision,
  };
}
type PlanIdentity = { requestId: string; entityId: string; timestamp: string };
export function planRecipeMutation(
  context: RecipeModelContext,
  command: RecipeMutation,
  identity: PlanIdentity,
  sha256: (text: string) => string,
) {
  const { requestId, entityId, timestamp } = identity;
  const audit = { createdAt: timestamp, updatedAt: timestamp, revision: 1 };
  if (command.action === 'tags.create') {
    const input = authorizeTagCreate(context, command.payload);
    const tag = tagSchema.parse({ ...input, id: entityId, status: 'active', ...audit });
    return {
      snapshot: { ...emptyRecipeSnapshot(), Tags: [tag] },
      before: emptyRecipeSnapshot(),
      baseRevision: 0,
    };
  }
  if (command.action === 'recipes.archive' || command.action === 'recipes.restore') {
    const action = command.action === 'recipes.archive' ? 'archive' : 'restore';
    const recipe = recipeSchema.parse(
      authorizeRecipeObject(context, { kind: 'recipe', id: command.payload.recipeId, action }),
    );
    if (recipe.revision !== command.payload.expectedRevision)
      throw new RecipeStorageError('RECIPE_CONFLICT');
    const current = recipeAggregateSchema.parse(context.reader.getAggregate(recipe.id));
    const after = recipeAggregateSchema.parse({
      ...current,
      recipe: {
        ...recipe,
        status: action === 'archive' ? 'archived' : 'draft',
        deletedAt: null,
        revision: recipe.revision + 1,
        updatedAt: timestamp,
      },
    });
    return {
      snapshot: aggregateSnapshot(after),
      before: aggregateSnapshot(current),
      baseRevision: recipe.revision,
    };
  }
  if (command.action === 'recipes.photos.add' || command.action === 'recipes.photos.delete') {
    const recipe = recipeSchema.parse(
      authorizeRecipeObject(context, {
        kind: 'recipe',
        id: command.payload.recipeId,
        action: 'update',
      }),
    );
    if (recipe.revision !== command.payload.expectedRevision)
      throw new RecipeStorageError('RECIPE_CONFLICT');
    const current = recipeAggregateSchema.parse(context.reader.getAggregate(recipe.id));
    let photos = [...current.photos];
    if (command.action === 'recipes.photos.delete') {
      if (!photos.some((photo) => photo.id === command.payload.photoId))
        throw new RecipeStorageError('RECIPE_CONFLICT');
      photos = photos.filter((photo) => photo.id !== command.payload.photoId);
      const positions = new Map<string, number>();
      photos = photos
        .sort((a, b) => a.position - b.position)
        .map((photo) => {
          const group = `${photo.kind}:${photo.stepId ?? ''}`;
          const position = positions.get(group) ?? 0;
          positions.set(group, position + 1);
          return position === photo.position
            ? photo
            : { ...photo, position, updatedAt: timestamp, revision: photo.revision + 1 };
        });
    } else {
      const { photo, target } = command.payload;
      if (photo.uploadId !== requestId || photos.some((item) => item.id === photo.uploadId))
        throw new RecipeStorageError('OPERATION_MISMATCH');
      const stepId = target.kind === 'step' ? target.stepId : null;
      if (stepId && !current.steps.some((step) => step.id === stepId))
        throw new RecipeStorageError('RECIPE_CONFLICT');
      if (target.kind === 'cover') {
        const galleryEnd =
          Math.max(
            -1,
            ...photos.filter((item) => item.kind === 'gallery').map((item) => item.position),
          ) + 1;
        photos = photos.map((item) =>
          item.kind === 'cover'
            ? {
                ...item,
                kind: 'gallery' as const,
                position: galleryEnd,
                updatedAt: timestamp,
                revision: item.revision + 1,
              }
            : item,
        );
      } else {
        const expected = photos.filter(
          (item) => item.kind === target.kind && item.stepId === stepId,
        ).length;
        if (target.position !== expected) throw new RecipeStorageError('RECIPE_CONFLICT');
      }
      photos.push(
        recipePhotoSchema.parse({
          id: photo.uploadId,
          recipeId: recipe.id,
          kind: target.kind,
          stepId,
          position: target.position,
          width: photo.width,
          height: photo.height,
          bytes: photo.imageBytes,
          thumbnailBytes: photo.thumbnailBytes,
          imageDigest: sha256(photo.imageBase64),
          thumbnailDigest: sha256(photo.thumbnailBase64),
          ...audit,
        }),
      );
    }
    const after = recipeAggregateSchema.parse({
      ...current,
      recipe: { ...recipe, revision: recipe.revision + 1, updatedAt: timestamp },
      photos,
    });
    return {
      snapshot: aggregateSnapshot(after),
      before: aggregateSnapshot(current),
      baseRevision: recipe.revision,
    };
  }
  let current: RecipeAggregate | null;
  let ownerUserId: string;
  let workspaceId: string;
  let assignedBy: string;
  let tags: RecipeAggregate['tags'];
  let value: RecipeCreateInput['value'] | RecipeUpdateInput['value'];
  let visibility: 'private' | 'workspace';
  if (command.action === 'recipes.create') {
    const authorized = authorizeRecipeCreate(context, command.payload);
    current = null;
    ({ ownerUserId, workspaceId, tags } = authorized);
    assignedBy = ownerUserId;
    value = authorized.input.value;
    visibility = authorized.input.visibility;
  } else {
    const authorized = authorizeRecipeUpdate(context, command.payload);
    current = authorized.current;
    ({ ownerUserId, workspaceId, visibility } = current.recipe);
    assignedBy = authorized.actor.userId;
    tags = authorized.tags;
    value = authorized.input.value;
  }
  const child = (
    input: Record<string, unknown>,
    stored: Record<string, unknown> | undefined,
    name: string,
  ) => {
    const { id: inputId, ...fields } = input;
    const id = inputId ?? recipeObjectId(requestId, name, sha256);
    if (stored) {
      const comparable = Object.fromEntries(Object.keys(fields).map((key) => [key, stored[key]]));
      if (canonicalRecipeJson(fields) === canonicalRecipeJson(comparable)) return stored;
    }
    return {
      ...fields,
      id,
      recipeId: entityId,
      createdAt: stored?.createdAt ?? timestamp,
      updatedAt: timestamp,
      revision: stored ? Number(stored.revision) + 1 : 1,
    };
  };
  const aggregate = recipeAggregateSchema.parse({
    recipe: {
      ...value.content,
      id: entityId,
      workspaceId,
      ownerUserId,
      visibility,
      status: current?.recipe.status ?? 'draft',
      createdAt: current?.recipe.createdAt ?? timestamp,
      updatedAt: timestamp,
      revision: (current?.recipe.revision ?? 0) + 1,
      deletedAt: null,
    },
    ingredients: value.ingredients.map((input, index) =>
      child(
        input,
        current?.ingredients.find((item) => item.id === input.id),
        `ingredient:${index}`,
      ),
    ),
    steps: value.steps.map((input, index) =>
      child(
        input,
        current?.steps.find((item) => item.id === input.id),
        `step:${index}`,
      ),
    ),
    photos:
      current?.photos.filter(
        (photo) =>
          photo.kind !== 'step' ||
          value.steps.some((step) => step.id !== undefined && step.id === photo.stepId),
      ) ?? [],
    recipeTags: value.tagIds.map(
      (tagId) =>
        current?.recipeTags.find((link) => link.tagId === tagId) ?? {
          recipeId: entityId,
          tagId,
          assignedBy,
          ...audit,
        },
    ),
    tags,
  });
  return {
    snapshot: aggregateSnapshot(aggregate),
    before: current ? aggregateSnapshot(current) : emptyRecipeSnapshot(),
    baseRevision: current?.recipe.revision ?? 0,
  };
}
