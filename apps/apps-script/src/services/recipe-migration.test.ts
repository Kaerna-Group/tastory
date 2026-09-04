import { afterEach, describe, expect, it, vi } from 'vitest';
import { persistenceFixture } from '../test-support/recipe-persistence-fixture';
import { applyRecipeSchema, planRecipeSchema } from './recipe-migration';
import { planJournalSchema, applyJournalSchema } from './journal-migration';
import { RECIPE_TABLES } from '../schema/recipe-schema';
import { readWorkspaceDirectory } from '../platform/workspace-directory';
import { inspectCurrentSchema } from '../platform/current-schema';
import { mutateRecipe } from './recipe-mutations';
import { randomUUID } from 'node:crypto';

afterEach(() => vi.unstubAllGlobals());
describe('recipe migration 005', () => {
  it('plans all tables before writing, preserves v2 tables and is idempotent', () => {
    const f = persistenceFixture(false);
    const users = structuredClone(f.required('Users'));
    const oldMigration = structuredClone(f.required('SchemaMigrations'));
    expect(planRecipeSchema(f.store, f.migrationOptions).alreadyApplied).toBe(false);
    expect(f.count()).toBe(0);
    applyRecipeSchema(f.store, f.migrationOptions);
    expect(f.required('Users')).toEqual(users);
    expect(f.required('SchemaMigrations').slice(0, oldMigration.length)).toEqual(oldMigration);
    expect(inspectCurrentSchema(f.book, 'private-drive')).toEqual({
      schemaVersion: 6,
      tablesChecked: 17,
    });
    for (const table of RECIPE_TABLES) expect(f.required(table.name)).toEqual([[...table.columns]]);
    const writes = f.count();
    expect(applyRecipeSchema(f.store, f.migrationOptions).alreadyApplied).toBe(true);
    expect(applyJournalSchema(f.store.journal, f.migrationOptions).alreadyApplied).toBe(true);
    expect(f.count()).toBe(writes);
    expect(readWorkspaceDirectory(f.book).users).toHaveLength(3);
  });
  it('continues safely after every interrupted schema write and flush', () => {
    const measured = persistenceFixture(false);
    applyRecipeSchema(measured.store, measured.migrationOptions);
    const boundaries = measured.count();
    for (const after of [false, true])
      for (let index = 1; index <= boundaries; index++) {
        const f = persistenceFixture(false);
        f.fail(index, after);
        expect(() => applyRecipeSchema(f.store, f.migrationOptions)).toThrow();
        f.fail();
        applyRecipeSchema(f.store, f.migrationOptions);
        expect(planRecipeSchema(f.store, f.migrationOptions).alreadyApplied).toBe(true);
        expect(
          f.required('SchemaMigrations').filter((row) => row[0] === '003-recipe-storage'),
        ).toHaveLength(1);
        expect(readWorkspaceDirectory(f.book).users).toHaveLength(3);
      }
  });
  it('upgrades an existing schema 4 book by adding only RecipeFavorites', () => {
    const f = persistenceFixture();
    const before = new Map(
      [...f.sheets]
        .filter(([name]) => name !== 'RecipeFavorites')
        .map(([name, rows]) => [name, structuredClone(rows)]),
    );
    f.sheets.delete('RecipeFavorites');
    const migrations = f.required('SchemaMigrations');
    const current = migrations.findIndex((row) => row[0] === '005-recipe-library');
    if (current < 0) throw new Error('fixture');
    migrations.splice(current, 1);
    const version = f.required('Meta').find((row) => row[0] === 'schema_version');
    if (!version) throw new Error('fixture');
    version[1] = '4';
    expect(planRecipeSchema(f.store, f.migrationOptions)).toMatchObject({
      fromVersion: 4,
      alreadyApplied: false,
    });
    applyRecipeSchema(f.store, f.migrationOptions);
    for (const [name, rows] of before) {
      if (name === 'Meta' || name === 'SchemaMigrations') continue;
      expect(f.sheets.get(name)).toEqual(rows);
    }
    const favorites = RECIPE_TABLES.find((table) => table.name === 'RecipeFavorites');
    if (!favorites) throw new Error('fixture');
    expect(f.required('RecipeFavorites')).toEqual([[...favorites.columns]]);
  });
  it('upgrades an existing schema 3 book by adding photos and favorites', () => {
    const f = persistenceFixture();
    const before = new Map(
      [...f.sheets]
        .filter(([name]) => name !== 'RecipePhotos' && name !== 'RecipeFavorites')
        .map(([name, rows]) => [name, structuredClone(rows)]),
    );
    f.sheets.delete('RecipePhotos');
    f.sheets.delete('RecipeFavorites');
    const migrations = f.required('SchemaMigrations');
    const current = migrations.findIndex((row) => row[0] === '004-recipe-photos');
    if (current < 0) throw new Error('fixture');
    migrations.splice(current, 1);
    const library = migrations.findIndex((row) => row[0] === '005-recipe-library');
    if (library < 0) throw new Error('fixture');
    migrations.splice(library, 1);
    const version = f.required('Meta').find((row) => row[0] === 'schema_version');
    if (!version) throw new Error('fixture');
    version[1] = '3';
    expect(planRecipeSchema(f.store, f.migrationOptions)).toMatchObject({
      fromVersion: 3,
      alreadyApplied: false,
    });
    applyRecipeSchema(f.store, f.migrationOptions);
    for (const [name, rows] of before) {
      if (name === 'Meta' || name === 'SchemaMigrations') continue;
      expect(f.sheets.get(name)).toEqual(rows);
    }
    const photos = RECIPE_TABLES.find((table) => table.name === 'RecipePhotos');
    if (!photos) throw new Error('fixture');
    expect(f.required('RecipePhotos')).toEqual([[...photos.columns]]);
    const favorites = RECIPE_TABLES.find((table) => table.name === 'RecipeFavorites');
    if (!favorites) throw new Error('fixture');
    expect(f.required('RecipeFavorites')).toEqual([[...favorites.columns]]);
  });
  it('rejects header conflicts and foreign data without writing', () => {
    const f = persistenceFixture(false);
    f.sheets.set('RecipeSteps', [['wrong-header']]);
    expect(() => applyRecipeSchema(f.store, f.migrationOptions)).toThrow();
    expect(f.count()).toBe(0);
    const table = RECIPE_TABLES.find((table) => table.name === 'RecipeSteps');
    if (!table) throw new Error('fixture');
    f.sheets.set('RecipeSteps', [[...table.columns], table.columns.map(() => '"foreign"')]);
    expect(() => applyRecipeSchema(f.store, f.migrationOptions)).toThrow();
    expect(f.count()).toBe(0);
  });
  it('rejects checksum changes, missing tables, missing/unknown migration records and maintenance mode', () => {
    const f = persistenceFixture();
    expect(() =>
      planRecipeSchema(f.store, { ...f.migrationOptions, recipeChecksum: 'b'.repeat(64) }),
    ).toThrow();
    expect(() =>
      planJournalSchema(f.store.journal, { ...f.migrationOptions, recipeChecksum: 'b'.repeat(64) }),
    ).toThrow();
    f.sheets.delete('Recipes');
    expect(() => planRecipeSchema(f.store, f.migrationOptions)).toThrow();
    f.required('SchemaMigrations').pop();
    expect(() => planJournalSchema(f.store.journal, f.migrationOptions)).toThrow();
    const g = persistenceFixture();
    g.required('SchemaMigrations').push([
      '004-unknown',
      'unknown',
      'a'.repeat(64),
      '2026-09-03T12:00:00Z',
      'system',
      'applied',
    ]);
    expect(() => planRecipeSchema(g.store, g.migrationOptions)).toThrow();
    const h = persistenceFixture(false);
    const maintenance = h.required('Meta').find((row) => row[0] === 'maintenance_mode');
    if (!maintenance) throw new Error('fixture');
    maintenance[1] = 'true';
    expect(() => applyRecipeSchema(h.store, h.migrationOptions)).toThrow();
    expect(h.count()).toBe(0);
  });
  it('never changes existing recipe versions when the migration is repeated', () => {
    const f = persistenceFixture();
    mutateRecipe(
      f.context,
      { action: 'recipes.create', payload: { value: f.value, visibility: 'private' } },
      randomUUID(),
    );
    const before = structuredClone([...f.sheets]);
    f.fail();
    applyRecipeSchema(f.store, f.migrationOptions);
    expect([...f.sheets]).toEqual(before);
    expect(f.count()).toBe(0);
  });
});
