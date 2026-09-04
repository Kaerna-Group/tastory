import { useEffect, useSyncExternalStore } from 'react';
import { getSession, requestSessionSettings, subscribeSession } from '@/entities/session';
import { getUserSettings, resetUserSettings, setUserSettingsState } from '@/entities/user-settings';

export function UserSettingsSync(): null {
  const session = useSyncExternalStore(subscribeSession, getSession);
  useEffect(() => {
    const user = session.status === 'signed-in' ? session.user : null;
    resetUserSettings(user?.id ?? null, user?.name);
    if (!user) return;
    const controller = new AbortController();
    void requestSessionSettings(
      { action: 'user.settings.get', payload: {} },
      crypto.randomUUID(),
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted && getUserSettings().subject === user.id)
          setUserSettingsState({
            status: 'ready',
            settings: data.settings,
            message: '',
            subject: user.id,
          });
      })
      .catch(() => {
        if (!controller.signal.aborted && getUserSettings().subject === user.id)
          setUserSettingsState({
            ...getUserSettings(),
            status: 'error',
            message:
              'Синхронизация настроек временно недоступна. Используются безопасные значения.',
          });
      });
    return () => controller.abort();
  }, [session.status, session.user]);
  return null;
}
