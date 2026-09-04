import { recipeLocalDraftSchema, recipeWriteContentSchema } from '@tastory/contracts';
import type { RecipeAggregate, RecipeDraftValue, RecipeLocalDraft } from '@tastory/contracts';
import { forgetUnsaved, listUnsaved, readUnsaved, rememberUnsaved } from './recovery-memory';
export type {
  RecipeDraftValue,
  RecipeLocalDraft,
  RecipeAggregate,
  Tag,
  RecipeSummary,
  RecipeData,
  RecipePhoto,
} from '@tastory/contracts';

export const DRAFT_PREFIX = 'tastory.recipe-draft.v1:';
export const draftKey = (scope: string, id: string) =>
  `${DRAFT_PREFIX}${encodeURIComponent(scope)}:${id}`;
export const draftScope = (apiUrl: string, subject: string) => JSON.stringify([apiUrl, subject]);
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export function readDraft(
  storage: DraftStorage,
  scope: string,
  id: string,
): RecipeLocalDraft | null {
  const memory = readUnsaved(draftKey(scope, id));
  if (memory) return memory;
  const raw = storage.getItem(draftKey(scope, id));
  if (raw === null) return null;
  const draft = recipeLocalDraftSchema.parse(JSON.parse(raw));
  if (draft.scope !== scope || draft.id !== id) throw new Error('Повреждена локальная копия.');
  return draft;
}
export function writeDraft(storage: DraftStorage, draft: RecipeLocalDraft) {
  // A single atomic replacement contains both the editable copy and the exact queued request.
  const serialized = JSON.stringify(recipeLocalDraftSchema.parse(draft));
  const key = draftKey(draft.scope, draft.id);
  try {
    storage.setItem(key, serialized);
    forgetUnsaved(key);
  } catch (error) {
    rememberUnsaved(key, draft);
    throw error;
  }
}
export function listDrafts(storage: DraftStorage, scope: string) {
  const drafts: RecipeLocalDraft[] = [];
  let damaged = 0;
  const prefix = `${DRAFT_PREFIX}${encodeURIComponent(scope)}:`;
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix)) continue;
    try {
      const draft = readDraft(storage, scope, key.slice(prefix.length));
      if (draft) drafts.push(draft);
    } catch {
      damaged++;
    }
  }
  for (const draft of listUnsaved())
    if (draft.scope === scope && !drafts.some((item) => item.id === draft.id)) drafts.push(draft);
  return { drafts: drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), damaged };
}
export const isDraftVolatile = (scope: string, id: string) =>
  Boolean(readUnsaved(draftKey(scope, id)));
export function removeDraft(storage: DraftStorage, scope: string, id: string) {
  const key = draftKey(scope, id);
  storage.removeItem(key);
  forgetUnsaved(key);
}
export function emptyValue(): RecipeDraftValue {
  return {
    content: {
      title: '',
      description: '',
      servings: null,
      prepMinutes: null,
      cookMinutes: null,
      sourceUrl: '',
      notes: '',
    },
    ingredients: [],
    steps: [],
    tagIds: [],
  };
}
export function valueFromAggregate(aggregate: RecipeAggregate): RecipeDraftValue {
  const { title, description, servings, prepMinutes, cookMinutes, sourceUrl, notes } =
    aggregate.recipe;
  return {
    content: { title, description, servings, prepMinutes, cookMinutes, sourceUrl, notes },
    ingredients: aggregate.ingredients.map(
      ({
        id,
        sectionTitle,
        position,
        name,
        quantityValue,
        quantityText,
        unit,
        note,
        isOptional,
      }) => ({
        key: id,
        id,
        sectionTitle,
        position,
        name,
        quantityValue,
        quantityText,
        unit,
        note,
        isOptional,
      }),
    ),
    steps: aggregate.steps.map(({ id, sectionTitle, position, body, durationSeconds }) => ({
      key: id,
      id,
      sectionTitle,
      position,
      body,
      durationSeconds,
    })),
    tagIds: aggregate.recipeTags.map((link) => link.tagId),
  };
}
export function newDraft(
  scope: string,
  id: string,
  base: RecipeAggregate | null = null,
  defaultVisibility: 'private' | 'workspace' = 'private',
): RecipeLocalDraft {
  return {
    version: 1,
    id,
    scope,
    updatedAt: new Date().toISOString(),
    editVersion: 0,
    savedVersion: base ? 0 : -1,
    visibility: base?.recipe.visibility ?? defaultVisibility,
    value: base ? valueFromAggregate(base) : emptyValue(),
    base,
    pending: null,
    conflict: null,
  };
}
export function writeValue(value: RecipeDraftValue) {
  return recipeWriteContentSchema.safeParse({
    content: value.content,
    ingredients: value.ingredients.map(({ key, ...row }, position) => {
      void key;
      return { ...row, position };
    }),
    steps: value.steps.map(({ key, ...row }, position) => {
      void key;
      return { ...row, position };
    }),
    tagIds: value.tagIds,
  });
}
export function copyValue(value: RecipeDraftValue): RecipeDraftValue {
  return {
    ...value,
    ingredients: value.ingredients.map(({ id, ...row }) => {
      void id;
      return row;
    }),
    steps: value.steps.map(({ id, ...row }) => {
      void id;
      return row;
    }),
  };
}
// Bind server-assigned child IDs by the submitted order, keeping keys and newer edits intact.
export function bindSavedIds(
  current: RecipeDraftValue,
  sent: RecipeDraftValue,
  saved: RecipeAggregate,
): RecipeDraftValue {
  const ingredients = new Map(
    sent.ingredients.map((row, index) => [row.key, saved.ingredients[index]?.id]),
  );
  const steps = new Map(sent.steps.map((row, index) => [row.key, saved.steps[index]?.id]));
  return {
    ...current,
    ingredients: current.ingredients.map((row) => {
      const id = ingredients.get(row.key);
      return id ? { ...row, id } : row;
    }),
    steps: current.steps.map((row) => {
      const id = steps.get(row.key);
      return id ? { ...row, id } : row;
    }),
  };
}
export function rebaseValue(value: RecipeDraftValue, remote: RecipeAggregate): RecipeDraftValue {
  const ingredients = new Set(remote.ingredients.map((row) => row.id));
  const steps = new Set(remote.steps.map((row) => row.id));
  return {
    ...value,
    ingredients: value.ingredients.map(({ id, ...row }) =>
      id && ingredients.has(id) ? { ...row, id } : row,
    ),
    steps: value.steps.map(({ id, ...row }) => (id && steps.has(id) ? { ...row, id } : row)),
    tagIds: value.tagIds,
  };
}
