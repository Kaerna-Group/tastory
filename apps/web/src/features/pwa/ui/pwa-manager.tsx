import { useEffect, useState } from 'react';

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};
const DISMISSED_KEY = 'tastory.pwa-install-dismissed.v1';

function wasDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY) === 'yes';
  } catch {
    return false;
  }
}

export function PwaManager(): React.JSX.Element | null {
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

    let registration: ServiceWorkerRegistration | null = null;
    let active = true;
    const checkForUpdate = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void registration?.update();
    };
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
        updateViaCache: 'none',
      })
      .then((value) => {
        if (!active) return;
        registration = value;
      })
      .catch(() => undefined);
    document.addEventListener('visibilitychange', checkForUpdate);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', checkForUpdate);
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD || window.matchMedia('(display-mode: standalone)').matches) return;
    const offer = (event: Event) => {
      event.preventDefault();
      if (!wasDismissed()) setInstallPrompt(event as InstallPrompt);
    };
    const installed = () => {
      setInstallPrompt(null);
      try {
        localStorage.setItem(DISMISSED_KEY, 'yes');
      } catch {
        // Installation remains complete even if this optional marker cannot be saved.
      }
    };
    window.addEventListener('beforeinstallprompt', offer);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', offer);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  if (!installPrompt) return null;
  const close = () => {
    setInstallPrompt(null);
    try {
      localStorage.setItem(DISMISSED_KEY, 'yes');
    } catch {
      // The invitation simply may reappear in a later session.
    }
  };
  const install = async () => {
    try {
      await installPrompt.prompt();
      await installPrompt.userChoice;
    } finally {
      setInstallPrompt(null);
    }
  };
  return (
    <aside className="pwa-install-prompt" aria-label="Установка Tastory">
      <div>
        <strong>Добавить Tastory на устройство</strong>
        <p>Кулинарная книга будет открываться как обычное приложение.</p>
      </div>
      <button type="button" className="button button-secondary" onClick={() => void install()}>
        Установить
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Закрыть приглашение установить Tastory"
        onClick={close}
      >
        ×
      </button>
    </aside>
  );
}
