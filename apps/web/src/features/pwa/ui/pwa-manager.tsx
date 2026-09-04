import { useEffect, useRef, useState } from 'react';
import { getReloadBlockers } from '@/shared/update-safety';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function PwaManager(): React.JSX.Element | null {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [message, setMessage] = useState('');
  const reloadOnChange = useRef(false);

  useEffect(() => {
    const updateConnection = () => setOnline(navigator.onLine);
    const offerInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const installed = () => setInstallPrompt(null);
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    window.addEventListener('beforeinstallprompt', offerInstall);
    window.addEventListener('appinstalled', installed);

    if (!import.meta.env.PROD || !('serviceWorker' in navigator))
      return () => {
        window.removeEventListener('online', updateConnection);
        window.removeEventListener('offline', updateConnection);
        window.removeEventListener('beforeinstallprompt', offerInstall);
        window.removeEventListener('appinstalled', installed);
      };

    let registration: ServiceWorkerRegistration | null = null;
    let active = true;
    let updateFound: (() => void) | null = null;
    const controllerChanged = () => {
      if (reloadOnChange.current) window.location.reload();
    };
    const checkWaiting = (worker: ServiceWorker | null) => {
      if (active && worker?.state === 'installed' && navigator.serviceWorker.controller)
        setWaiting(worker);
    };
    const checkForUpdate = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void registration?.update();
    };
    navigator.serviceWorker.addEventListener('controllerchange', controllerChanged);
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
        updateViaCache: 'none',
      })
      .then((value) => {
        if (!active) return;
        registration = value;
        if (value.waiting && navigator.serviceWorker.controller) setWaiting(value.waiting);
        updateFound = () => {
          const worker = value.installing;
          worker?.addEventListener('statechange', () => checkWaiting(worker));
        };
        value.addEventListener('updatefound', updateFound);
      })
      .catch(() => {
        if (active)
          setMessage('Не удалось подготовить офлайн-доступ. Повторим при следующем входе.');
      });
    document.addEventListener('visibilitychange', checkForUpdate);

    return () => {
      active = false;
      if (registration && updateFound) registration.removeEventListener('updatefound', updateFound);
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
      window.removeEventListener('beforeinstallprompt', offerInstall);
      window.removeEventListener('appinstalled', installed);
      navigator.serviceWorker.removeEventListener('controllerchange', controllerChanged);
      document.removeEventListener('visibilitychange', checkForUpdate);
    };
  }, []);

  async function install(): Promise<void> {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome !== 'accepted')
      setMessage('Установку можно запустить позже из меню браузера.');
    setInstallPrompt(null);
  }

  function update(): void {
    if (!waiting) return;
    if (getReloadBlockers().length > 0) {
      setMessage('Обновление отложено: сначала сохраните или скачайте аварийную копию рецепта.');
      return;
    }
    reloadOnChange.current = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
  }

  if (online && !installPrompt && !waiting && !message) return null;
  return (
    <aside className="pwa-status" aria-label="Состояние приложения">
      {!online && <p role="status">Нет сети. Доступны локальные черновики и недавние рецепты.</p>}
      {message && <p role="status">{message}</p>}
      <div className="pwa-status-actions">
        {installPrompt && (
          <button type="button" className="button button-secondary" onClick={() => void install()}>
            Установить приложение
          </button>
        )}
        {waiting && (
          <button type="button" className="button button-primary" onClick={update}>
            Обновить приложение
          </button>
        )}
        {message && (
          <button type="button" className="text-link" onClick={() => setMessage('')}>
            Закрыть
          </button>
        )}
      </div>
    </aside>
  );
}
