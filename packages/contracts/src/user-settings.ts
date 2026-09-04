import { z } from 'zod';
import { recipeVisibilitySchema } from './recipe';

export const userSettingsValueSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(80),
  unitSystem: z.enum(['metric', 'imperial']),
  temperatureUnit: z.enum(['celsius', 'fahrenheit']),
  defaultVisibility: recipeVisibilitySchema,
  editorDensity: z.enum(['comfortable', 'compact']),
  autosaveDelay: z.union([z.literal(500), z.literal(900), z.literal(2000)]),
  keyboardShortcuts: z.boolean(),
  confirmDestructiveActions: z.boolean(),
});

export const userSettingsSchema = userSettingsValueSchema.extend({
  revision: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
  updatedAt: z.iso.datetime().nullable(),
});

export const userSettingsCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('user.settings.get'), payload: z.strictObject({}) }),
  z.strictObject({
    action: z.literal('user.settings.update'),
    payload: z.strictObject({
      expectedRevision: z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER - 1),
      value: userSettingsValueSchema,
    }),
  }),
]);

export const userSettingsDataSchema = z.strictObject({
  kind: z.literal('userSettings'),
  settings: userSettingsSchema,
  outcome: z.enum(['read', 'committed', 'replayed']),
});

export type UserSettingsValue = z.infer<typeof userSettingsValueSchema>;
export type UserSettings = z.infer<typeof userSettingsSchema>;
export type UserSettingsCommand = z.infer<typeof userSettingsCommandSchema>;
export type UserSettingsData = z.infer<typeof userSettingsDataSchema>;
