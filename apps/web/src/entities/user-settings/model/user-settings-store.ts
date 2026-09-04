import type { UserSettings } from '@tastory/contracts';
export type { UserSettingsValue } from '@tastory/contracts';

export type UserSettingsState = Readonly<{
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error';
  settings: UserSettings;
  message: string;
  subject: string | null;
}>;

export function defaultUserSettings(displayName = 'Повар'): UserSettings {
  return {
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
  };
}

let snapshot: UserSettingsState = {
  status: 'idle',
  settings: defaultUserSettings(),
  message: '',
  subject: null,
};
const listeners = new Set<() => void>();
const update = (next: UserSettingsState) => {
  snapshot = next;
  listeners.forEach((listener) => listener());
};

export const getUserSettings = () => snapshot;
export function subscribeUserSettings(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function resetUserSettings(subject: string | null, displayName = 'Повар') {
  update({
    status: subject ? 'loading' : 'idle',
    settings: defaultUserSettings(displayName),
    message: '',
    subject,
  });
}
export function setUserSettingsState(
  state: Pick<UserSettingsState, 'status' | 'settings' | 'message' | 'subject'>,
) {
  update(state);
}
