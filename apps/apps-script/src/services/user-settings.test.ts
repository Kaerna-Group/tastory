import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { persistenceFixture } from '../test-support/recipe-persistence-fixture';
import { other, workspace } from '../test-support/journal-fixture';
import { manageUserSettings } from './user-settings';

const value = {
  displayName: 'Уля',
  unitSystem: 'metric' as const,
  temperatureUnit: 'celsius' as const,
  defaultVisibility: 'workspace' as const,
  editorDensity: 'compact' as const,
  autosaveDelay: 500 as const,
  keyboardShortcuts: true,
  confirmDestructiveActions: false,
};

describe('user settings', () => {
  it('keeps defaults per user and appends an idempotent revision', () => {
    const f = persistenceFixture();
    const identity = { workspaceId: workspace, userId: other, displayName: 'Author' };
    const initial = manageUserSettings(
      f.store,
      { action: 'user.settings.get', payload: {} },
      randomUUID(),
      identity,
      f.context.now,
      () => {},
    );
    expect(initial).toMatchObject({
      outcome: 'read',
      settings: { displayName: 'Author', revision: 0, defaultVisibility: 'private' },
    });

    const requestId = randomUUID();
    const command = {
      action: 'user.settings.update' as const,
      payload: { expectedRevision: 0, value },
    };
    const saved = manageUserSettings(
      f.store,
      command,
      requestId,
      identity,
      f.context.now,
      () => {},
    );
    expect(saved).toMatchObject({ outcome: 'committed', settings: { ...value, revision: 1 } });
    expect(
      manageUserSettings(f.store, command, requestId, identity, f.context.now, () => {}),
    ).toMatchObject({ outcome: 'replayed', settings: { revision: 1 } });
    expect(() =>
      manageUserSettings(
        f.store,
        { ...command, payload: { expectedRevision: 0, value: { ...value, displayName: 'Иное' } } },
        requestId,
        identity,
        f.context.now,
        () => {},
      ),
    ).toThrow('OPERATION_MISMATCH');
    expect(() =>
      manageUserSettings(f.store, command, randomUUID(), identity, f.context.now, () => {}),
    ).toThrow('SETTINGS_CONFLICT');
  });
});
