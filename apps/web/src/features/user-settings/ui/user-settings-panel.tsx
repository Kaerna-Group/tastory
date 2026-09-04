import { useState, useSyncExternalStore } from 'react';
import { getSession, requestSessionSettings, subscribeSession } from '@/entities/session';
import {
  getUserSettings,
  setUserSettingsState,
  subscribeUserSettings,
} from '@/entities/user-settings';
import type { UserSettingsValue } from '@/entities/user-settings';
import { ApiClientError } from '@/shared/api';

const valueOf = (settings: ReturnType<typeof getUserSettings>['settings']): UserSettingsValue => ({
  displayName: settings.displayName,
  unitSystem: settings.unitSystem,
  temperatureUnit: settings.temperatureUnit,
  defaultVisibility: settings.defaultVisibility,
  editorDensity: settings.editorDensity,
  autosaveDelay: settings.autosaveDelay,
  keyboardShortcuts: settings.keyboardShortcuts,
  confirmDestructiveActions: settings.confirmDestructiveActions,
});

export function UserSettingsPanel(): React.JSX.Element {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const state = useSyncExternalStore(subscribeUserSettings, getUserSettings);
  const [form, setForm] = useState(() => valueOf(state.settings));
  const [source, setSource] = useState(state.settings);
  if (source !== state.settings) {
    setSource(state.settings);
    setForm(valueOf(state.settings));
  }
  const disabled =
    session.status !== 'signed-in' || state.status === 'loading' || state.status === 'saving';
  const change = <K extends keyof UserSettingsValue>(key: K, value: UserSettingsValue[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    if (!state.subject) return;
    const storageKey = `tastory.settings.pending.${state.subject}`;
    const stored = localStorage.getItem(storageKey);
    let requestId = crypto.randomUUID();
    if (stored) {
      try {
        const pending = JSON.parse(stored) as {
          requestId?: string;
          revision?: number;
          value?: unknown;
        };
        if (
          pending.revision === state.settings.revision &&
          JSON.stringify(pending.value) === JSON.stringify(form) &&
          pending.requestId &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            pending.requestId,
          )
        )
          requestId = pending.requestId as typeof requestId;
      } catch {
        localStorage.removeItem(storageKey);
      }
    }
    localStorage.setItem(
      storageKey,
      JSON.stringify({ requestId, revision: state.settings.revision, value: form }),
    );
    setUserSettingsState({ ...state, status: 'saving', message: 'Сохраняем настройки…' });
    try {
      const data = await requestSessionSettings(
        {
          action: 'user.settings.update',
          payload: { expectedRevision: state.settings.revision, value: form },
        },
        requestId,
      );
      localStorage.removeItem(storageKey);
      setUserSettingsState({
        status: 'ready',
        settings: data.settings,
        message: 'Настройки сохранены во всей тетради.',
        subject: state.subject,
      });
    } catch (error) {
      setUserSettingsState({
        ...state,
        status: 'error',
        message:
          error instanceof ApiClientError ? error.message : 'Не удалось сохранить настройки.',
      });
    }
  };

  return (
    <section className="panel settings-preferences" aria-labelledby="preferences-title">
      <h2 id="preferences-title">Профиль и редактор</h2>
      <p className="muted mb-6">
        Эти параметры связаны с вашим входом и работают на всех устройствах.
      </p>
      <div className="settings-form">
        <label>
          Имя в Tastory
          <input
            value={form.displayName}
            maxLength={80}
            disabled={disabled}
            onChange={(event) => change('displayName', event.target.value)}
          />
        </label>
        <label>
          Единицы
          <select
            value={form.unitSystem}
            disabled={disabled}
            onChange={(event) =>
              change('unitSystem', event.target.value as UserSettingsValue['unitSystem'])
            }
          >
            <option value="metric">Метрические: г, кг, мл</option>
            <option value="imperial">Американские: oz, lb, cup</option>
          </select>
        </label>
        <label>
          Температура
          <select
            value={form.temperatureUnit}
            disabled={disabled}
            onChange={(event) =>
              change('temperatureUnit', event.target.value as UserSettingsValue['temperatureUnit'])
            }
          >
            <option value="celsius">Цельсий, °C</option>
            <option value="fahrenheit">Фаренгейт, °F</option>
          </select>
        </label>
        <label>
          Новый рецепт
          <select
            value={form.defaultVisibility}
            disabled={disabled}
            onChange={(event) =>
              change(
                'defaultVisibility',
                event.target.value as UserSettingsValue['defaultVisibility'],
              )
            }
          >
            <option value="private">Личный</option>
            <option value="workspace">Общий для тетради</option>
          </select>
        </label>
        <label>
          Плотность редактора
          <select
            value={form.editorDensity}
            disabled={disabled}
            onChange={(event) =>
              change('editorDensity', event.target.value as UserSettingsValue['editorDensity'])
            }
          >
            <option value="comfortable">Просторная</option>
            <option value="compact">Компактная</option>
          </select>
        </label>
        <label>
          Автосохранение
          <select
            value={form.autosaveDelay}
            disabled={disabled}
            onChange={(event) =>
              change(
                'autosaveDelay',
                Number(event.target.value) as UserSettingsValue['autosaveDelay'],
              )
            }
          >
            <option value={500}>Через 0,5 секунды</option>
            <option value={900}>Через 0,9 секунды</option>
            <option value={2000}>Через 2 секунды</option>
          </select>
        </label>
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={form.keyboardShortcuts}
          disabled={disabled}
          onChange={(event) => change('keyboardShortcuts', event.target.checked)}
        />{' '}
        Использовать горячие клавиши
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={form.confirmDestructiveActions}
          disabled={disabled}
          onChange={(event) => change('confirmDestructiveActions', event.target.checked)}
        />{' '}
        Спрашивать перед удалением файлов
      </label>
      <div className="settings-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={disabled || !form.displayName.trim()}
          onClick={() => void save()}
        >
          Сохранить настройки
        </button>
        {state.message && (
          <p role="status" className={state.status === 'error' ? 'error-text' : 'muted'}>
            {state.message}
          </p>
        )}
      </div>
    </section>
  );
}
