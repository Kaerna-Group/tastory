import { ThemeSwitch } from '@/features/theme-switch';
import { ConnectionStatus } from '@/features/connection-status';
import { GoogleSignIn } from '@/features/google-sign-in';
import { PhotoProbe } from '@/features/photo-probe';
import { ConcurrencyProbe } from '@/features/concurrency-probe';
export function SettingsPage(): React.JSX.Element {
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">По вашему вкусу</p>
        <h1>Настройки тетради</h1>
        <p className="muted">Выберите удобный внешний вид и проверьте подключение.</p>
      </div>
      <div className="settings-grid">
        <GoogleSignIn />
        <PhotoProbe />
        <section className="panel" aria-labelledby="theme-title">
          <h2 id="theme-title">Внешний вид</h2>
          <p className="muted mb-6">
            Тёплая светлая бумага или спокойная темная тема. Ваш выбор сохранится в этом браузере.
          </p>
          <ThemeSwitch />
        </section>
        <ConnectionStatus />
        <ConcurrencyProbe />
      </div>
    </>
  );
}
