import { fixture, options, sha256, timestamp, workspace, other } from './journal-fixture';
import { recipeFixture } from './recipe-fixture';
import { applyJournalSchema } from '../services/journal-migration';
import { applyRecipeSchema } from '../services/recipe-migration';
import { createRecipeStore } from '../platform/recipe-store';
import { readWorkspaceDirectory } from '../platform/workspace-directory';
import {
  LEGACY_RECIPE_SCHEMA_FINGERPRINT,
  PHOTO_RECIPE_SCHEMA_FINGERPRINT,
  RECIPE_SCHEMA_FINGERPRINT,
  SETTINGS_RECIPE_SCHEMA_FINGERPRINT,
} from '../schema/recipe-schema';
import { createRecipeReader } from '../services/recipe-reader';
import type { RecipeWriteContext } from '../services/recipe-context';

export function persistenceFixture(initialize = true) {
  const f = fixture();
  applyJournalSchema(f.store, options);
  f.required('Users').push([
    other,
    'author-sub',
    'author@example.test',
    'author@example.test',
    'Author',
    '',
    'active',
    timestamp,
    '',
    '1',
  ]);
  f.required('WorkspaceMembers').push([workspace, other, 'member', 'active', timestamp, '1']);
  const store = createRecipeStore(f.book);
  const migrationOptions = {
    ...options,
    recipeChecksum: sha256(RECIPE_SCHEMA_FINGERPRINT),
    legacyRecipeChecksum: sha256(LEGACY_RECIPE_SCHEMA_FINGERPRINT),
    photoRecipeChecksum: sha256(PHOTO_RECIPE_SCHEMA_FINGERPRINT),
    settingsRecipeChecksum: sha256(SETTINGS_RECIPE_SCHEMA_FINGERPRINT),
  };
  if (initialize) applyRecipeSchema(store, migrationOptions);
  const model = recipeFixture();
  model.value.tagIds = [];
  const context: RecipeWriteContext = {
    session: model.context.session,
    workspaceId: workspace,
    readDirectory: () => readWorkspaceDirectory(f.book),
    store,
    now: () => new Date(timestamp),
    sha256,
  };
  f.fail();
  return {
    ...f,
    store,
    migrationOptions,
    context,
    value: model.value,
    reader: () => createRecipeReader(store, sha256),
    model: () => ({ ...context, reader: createRecipeReader(store, sha256) }),
  };
}
