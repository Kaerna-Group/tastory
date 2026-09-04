import type { AuthData, UserSettingsCommand, UserSettingsData } from '@tastory/contracts';
import { AuthError } from '../auth/google-token';
import { resolveWorkspaceAccess, sheetsAuthConfigSchema } from '../auth/workspace-access';
import { planRecipeSchema } from '../services/recipe-migration';
import { RecipeStorageError } from '../services/recipe-storage';
import { manageUserSettings, UserSettingsError } from '../services/user-settings';
import { journalMigrationOptions } from './current-schema';
import { createRecipeStore } from './recipe-store';
import { runtimeEnvironment } from './runtime-environment';
import { readWorkspaceDirectory, SHEETS_AUTH_CONFIG_KEY } from './workspace-directory';

export function userSettings(
  command: UserSettingsCommand,
  requestId: string,
  session: AuthData,
): UserSettingsData {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new UserSettingsError();
  try {
    const assertLive = () => {
      if (
        !Number.isFinite(Date.parse(session.expiresAt)) ||
        Date.parse(session.expiresAt) <= Date.now()
      )
        throw new AuthError('UNAUTHENTICATED');
    };
    assertLive();
    const properties = PropertiesService.getScriptProperties();
    const config = sheetsAuthConfigSchema.safeParse(
      JSON.parse(properties.getProperty(SHEETS_AUTH_CONFIG_KEY) ?? 'null'),
    );
    const spreadsheetId = properties.getProperty('SPREADSHEET_ID');
    if (!runtimeEnvironment(properties.getProperty('APP_ENV')) || !spreadsheetId || !config.success)
      throw new UserSettingsError('SETTINGS_NOT_READY');
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const actor = resolveWorkspaceAccess(
      readWorkspaceDirectory(spreadsheet),
      session.user.id,
      config.data.workspaceId,
    );
    const store = createRecipeStore(spreadsheet);
    if (
      !planRecipeSchema(
        store,
        journalMigrationOptions(properties.getProperty('DRIVE_FOLDER_ID') ?? ''),
      ).alreadyApplied
    )
      throw new UserSettingsError('SETTINGS_NOT_READY');
    return manageUserSettings(
      store,
      command,
      requestId,
      { workspaceId: actor.workspaceId, userId: actor.userId, displayName: session.user.name },
      () => new Date(),
      assertLive,
    );
  } catch (error) {
    if (error instanceof AuthError || error instanceof UserSettingsError) throw error;
    if (error instanceof RecipeStorageError)
      throw new UserSettingsError(
        error.code === 'RECIPE_NOT_READY' ? 'SETTINGS_NOT_READY' : 'SETTINGS_UNAVAILABLE',
      );
    throw new UserSettingsError();
  } finally {
    lock.releaseLock();
  }
}
