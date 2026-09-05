import { z } from 'zod';
import {
  DEFAULT_RECIPE_THEME,
  recipeTemplateSchema,
  recipeDesignSchema,
  recipeDesignValueSchema,
  recipeThemeSchema,
  templateLayoutSchema,
  templateMutationActions,
  templateSchema,
} from '@tastory/contracts';
import type { RecipeDesign, RecipeTemplate, RecipeTemplateRecord } from '@tastory/contracts';
import { canonicalRecipeJson, encodeRecipeRow, recipeRows } from './recipe-storage';
import type { RecipeStore } from './recipe-storage';

export class TemplateStorageError extends Error {
  constructor(
    public readonly code:
      | 'TEMPLATE_NOT_READY'
      | 'TEMPLATE_INVALID'
      | 'TEMPLATE_UNAVAILABLE'
      | 'TEMPLATE_CONFLICT'
      | 'TEMPLATE_LIMIT' = 'TEMPLATE_UNAVAILABLE',
  ) {
    super(code);
  }
}

const terminal = z.string().refine((value) => {
  const [state, date] = value.split('@');
  return state === 'committed' && z.iso.datetime().safeParse(date).success;
});
const operationSchema = z.strictObject({
  requestId: z.uuid(),
  workspaceId: z.uuid(),
  userId: z.uuid(),
  action: z.enum(templateMutationActions),
  entityId: z.uuid(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  startedAt: z.iso.datetime(),
  state: z.union([z.literal('started'), terminal]),
});
const versionedTemplate = templateSchema.safeExtend({ versionId: z.uuid() });
const storedPresentationSchema = z.strictObject({
  version: z.literal(1),
  layout: templateLayoutSchema,
  theme: recipeThemeSchema,
});
const {
  layout: _layout,
  theme: _theme,
  ...storedRecipeTemplateFields
} = recipeTemplateSchema.shape;
void _layout;
void _theme;
const storedRecipeTemplateSchema = z.strictObject({
  ...storedRecipeTemplateFields,
  versionId: z.uuid(),
  layout: z.string(),
});
const storedRecipeDesignSchema = z.strictObject({
  versionId: z.uuid(),
  id: z.uuid(),
  recipeId: z.uuid(),
  revision: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER - 1),
  recipeTemplateRevision: z.number().int().positive().nullable(),
  sourceTemplateId: z.uuid().nullable(),
  sourceTemplateRevision: z.number().int().positive().nullable(),
  document: z.string().min(2).max(20000),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type TemplateOperation = z.infer<typeof operationSchema>;

function decodeRecipeTemplate(row: z.infer<typeof storedRecipeTemplateSchema>) {
  const legacyLayout = templateLayoutSchema.safeParse(row.layout);
  let presentation: z.infer<typeof storedPresentationSchema>;
  if (legacyLayout.success)
    presentation = { version: 1, layout: legacyLayout.data, theme: DEFAULT_RECIPE_THEME };
  else {
    try {
      presentation = storedPresentationSchema.parse(JSON.parse(row.layout));
    } catch {
      throw new TemplateStorageError();
    }
  }
  return recipeTemplateSchema.extend({ versionId: z.uuid() }).parse({
    ...row,
    layout: presentation.layout,
    theme: presentation.theme,
  });
}

function encodeRecipeTemplate(value: RecipeTemplate) {
  return {
    ...value,
    theme: undefined,
    layout: canonicalRecipeJson({ version: 1, layout: value.layout, theme: value.theme }),
  };
}

function decodeRecipeDesign(row: z.infer<typeof storedRecipeDesignSchema>) {
  let value: z.infer<typeof recipeDesignValueSchema>;
  try {
    value = recipeDesignValueSchema.parse(JSON.parse(row.document));
  } catch {
    throw new TemplateStorageError();
  }
  const { document: _document, ...fields } = row;
  void _document;
  return recipeDesignSchema.extend({ versionId: z.uuid() }).parse({ ...fields, value });
}

function encodeRecipeDesign(value: RecipeDesign) {
  const { value: document, ...fields } = value;
  return { ...fields, document: canonicalRecipeJson(document) };
}

function latest<T extends { id: string; revision: number; versionId: string }>(
  rows: T[],
  committed: Set<string>,
) {
  const result = new Map<string, T>();
  for (const row of rows) {
    if (!committed.has(row.versionId)) continue;
    const previous = result.get(row.id);
    if (previous && row.revision !== previous.revision + 1) throw new TemplateStorageError();
    result.set(row.id, row);
  }
  return result;
}

export function readTemplateOperations(store: RecipeStore): TemplateOperation[] {
  const parsed = z.array(operationSchema).safeParse(recipeRows(store, 'TemplateOperations'));
  if (
    !parsed.success ||
    new Set(parsed.data.map((item) => item.requestId)).size !== parsed.data.length
  )
    throw new TemplateStorageError();
  return parsed.data;
}

export function readTemplateState(store: RecipeStore) {
  const operations = readTemplateOperations(store);
  const committed = new Set(
    operations.filter((item) => item.state.startsWith('committed@')).map((item) => item.requestId),
  );
  const templates = z.array(versionedTemplate).safeParse(recipeRows(store, 'Templates'));
  const applied = z
    .array(storedRecipeTemplateSchema)
    .safeParse(recipeRows(store, 'RecipeTemplates'));
  const designs = z.array(storedRecipeDesignSchema).safeParse(recipeRows(store, 'RecipeDesigns'));
  if (!templates.success || !applied.success || !designs.success) throw new TemplateStorageError();
  return {
    operations,
    templates: latest(templates.data, committed),
    applied: latest(applied.data.map(decodeRecipeTemplate), committed),
    designs: latest(designs.data.map(decodeRecipeDesign), committed),
  };
}

type TemplateWrite =
  | { table: 'Templates'; value: RecipeTemplateRecord }
  | { table: 'RecipeTemplates'; value: RecipeTemplate }
  | { table: 'RecipeDesigns'; value: RecipeDesign };

export function publishTemplateMutation(
  store: RecipeStore,
  operation: Omit<TemplateOperation, 'state'>,
  writes: TemplateWrite[],
  now: () => Date,
) {
  const operations = readTemplateOperations(store);
  const existing = operations.find((item) => item.requestId === operation.requestId);
  if (existing) {
    if (
      existing.workspaceId !== operation.workspaceId ||
      existing.userId !== operation.userId ||
      existing.action !== operation.action ||
      existing.entityId !== operation.entityId ||
      existing.payloadHash !== operation.payloadHash
    )
      throw new TemplateStorageError('TEMPLATE_CONFLICT');
    if (existing.state.startsWith('committed@')) return 'replayed' as const;
  } else {
    store.writeRows('TemplateOperations', operations.length + 2, [
      encodeRecipeRow('TemplateOperations', { ...operation, state: 'started' }),
    ]);
    store.flush();
  }
  for (const table of ['Templates', 'RecipeTemplates', 'RecipeDesigns'] as const) {
    const planned = writes.filter((item) => item.table === table);
    if (!planned.length) continue;
    const rows = recipeRows(store, table);
    const present = new Set(
      rows.filter((row) => row.versionId === operation.requestId).map((row) => String(row.id)),
    );
    const missing = planned.filter((item) => !present.has(item.value.id));
    if (present.size + missing.length !== planned.length) throw new TemplateStorageError();
    if (missing.length)
      store.writeRows(
        table,
        rows.length + 2,
        missing.map((item) =>
          encodeRecipeRow(
            table,
            table === 'RecipeTemplates'
              ? {
                  versionId: operation.requestId,
                  ...encodeRecipeTemplate(item.value as RecipeTemplate),
                }
              : table === 'RecipeDesigns'
                ? {
                    versionId: operation.requestId,
                    ...encodeRecipeDesign(item.value as RecipeDesign),
                  }
                : { versionId: operation.requestId, ...item.value },
          ),
        ),
      );
  }
  store.flush();
  const index = readTemplateOperations(store).findIndex(
    (item) => item.requestId === operation.requestId,
  );
  if (index < 0) throw new TemplateStorageError();
  store.writeState('TemplateOperations', index + 2, `committed@${now().toISOString()}`);
  store.flush();
  return 'committed' as const;
}
