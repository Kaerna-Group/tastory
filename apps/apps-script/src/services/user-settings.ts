import { z } from 'zod';
import {
  userSettingsCommandSchema,
  userSettingsSchema,
  userSettingsValueSchema,
} from '@tastory/contracts';
import type {
  UserSettings,
  UserSettingsCommand,
  UserSettingsData,
  UserSettingsValue,
} from '@tastory/contracts';
import { canonicalRecipeJson, encodeRecipeRow, recipeRows } from './recipe-storage';
import type { RecipeStore } from './recipe-storage';

export class UserSettingsError extends Error {
  constructor(
    public readonly code:
      | 'SETTINGS_NOT_READY'
      | 'SETTINGS_CONFLICT'
      | 'SETTINGS_UNAVAILABLE'
      | 'OPERATION_MISMATCH' = 'SETTINGS_UNAVAILABLE',
  ) {
    super(code);
  }
}

const rowSchema = userSettingsValueSchema.extend({
  requestId: z.uuid(),
  workspaceId: z.uuid(),
  userId: z.uuid(),
  baseRevision: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
  revision: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER - 1),
  updatedAt: z.iso.datetime(),
});
type SettingsRow = z.infer<typeof rowSchema>;

export function defaultUserSettings(displayName: string): UserSettings {
  return userSettingsSchema.parse({
    displayName: displayName.trim().slice(0, 80) || 'Повар',
    unitSystem: 'metric',
    temperatureUnit: 'celsius',
    defaultVisibility: 'private',
    editorDensity: 'comfortable',
    autosaveDelay: 900,
    keyboardShortcuts: true,
    confirmDestructiveActions: true,
    revision: 0,
    updatedAt: null,
  });
}

function rows(store: RecipeStore, workspaceId: string, userId: string): SettingsRow[] {
  const parsed = z.array(rowSchema).safeParse(recipeRows(store, 'UserSettings'));
  if (!parsed.success) throw new UserSettingsError();
  const all = parsed.data;
  if (new Set(all.map((row) => row.requestId)).size !== all.length) throw new UserSettingsError();
  const own = all
    .filter((row) => row.workspaceId === workspaceId && row.userId === userId)
    .sort((a, b) => a.revision - b.revision);
  own.forEach((row, index) => {
    if (row.baseRevision !== index || row.revision !== index + 1) throw new UserSettingsError();
  });
  return own;
}

function publicSettings(row: SettingsRow): UserSettings {
  const { requestId, workspaceId, userId, baseRevision, ...settings } = row;
  void requestId;
  void workspaceId;
  void userId;
  void baseRevision;
  return userSettingsSchema.parse(settings);
}

function valueOf(row: SettingsRow): UserSettingsValue {
  const settings = publicSettings(row);
  const { revision, updatedAt, ...value } = settings;
  void revision;
  void updatedAt;
  return value;
}

export function manageUserSettings(
  store: RecipeStore,
  input: UserSettingsCommand,
  requestId: string,
  identity: { workspaceId: string; userId: string; displayName: string },
  now: () => Date,
  beforeWrite: () => void,
): UserSettingsData {
  const command = userSettingsCommandSchema.parse(input);
  const history = rows(store, identity.workspaceId, identity.userId);
  const current = history.at(-1);
  if (command.action === 'user.settings.get')
    return {
      kind: 'userSettings',
      settings: current ? publicSettings(current) : defaultUserSettings(identity.displayName),
      outcome: 'read',
    };

  const previousRequest = recipeRows(store, 'UserSettings').find(
    (row) => row.requestId === requestId,
  );
  if (previousRequest) {
    const parsed = rowSchema.safeParse(previousRequest);
    if (
      !parsed.success ||
      parsed.data.workspaceId !== identity.workspaceId ||
      parsed.data.userId !== identity.userId ||
      parsed.data.baseRevision !== command.payload.expectedRevision ||
      canonicalRecipeJson(valueOf(parsed.data)) !== canonicalRecipeJson(command.payload.value)
    )
      throw new UserSettingsError('OPERATION_MISMATCH');
    return { kind: 'userSettings', settings: publicSettings(parsed.data), outcome: 'replayed' };
  }

  const revision = current?.revision ?? 0;
  if (command.payload.expectedRevision !== revision)
    throw new UserSettingsError('SETTINGS_CONFLICT');
  const next = rowSchema.parse({
    ...command.payload.value,
    requestId,
    workspaceId: identity.workspaceId,
    userId: identity.userId,
    baseRevision: revision,
    revision: revision + 1,
    updatedAt: now().toISOString(),
  });
  beforeWrite();
  const table = store.read('UserSettings');
  if (!table) throw new UserSettingsError('SETTINGS_NOT_READY');
  store.writeRows('UserSettings', table.rowCount + 1, [encodeRecipeRow('UserSettings', next)]);
  store.flush();
  beforeWrite();
  const saved = rows(store, identity.workspaceId, identity.userId).at(-1);
  if (!saved || canonicalRecipeJson(saved) !== canonicalRecipeJson(next))
    throw new UserSettingsError();
  return { kind: 'userSettings', settings: publicSettings(saved), outcome: 'committed' };
}
