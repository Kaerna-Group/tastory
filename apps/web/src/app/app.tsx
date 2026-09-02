import { lazy, Suspense } from 'react';
import { NavLink, Route, Routes } from 'react-router';
import { LibraryPage } from '@/pages/library';
import { NotFoundPage } from '@/pages/not-found';
const SettingsPage = lazy(async () => ({
  default: (await import('@/pages/settings')).SettingsPage,
}));
export function App(): React.JSX.Element {
  return (
    <>
      <a
        href="#main"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Перейти к содержанию
      </a>
      <header className="app-header">
        <NavLink to="/" className="brand" aria-label="Tastory — главная">
          tastory<span aria-hidden="true">.</span>
        </NavLink>
        <nav aria-label="Основная навигация">
          <NavLink to="/" end>
            Библиотека
          </NavLink>
          <NavLink to="/settings">Настройки</NavLink>
        </nav>
        <span className="edition">Личная кулинарная тетрадь</span>
      </header>
      <main id="main" className="app-main" tabIndex={-1}>
        <Suspense
          fallback={
            <p role="status" className="py-12">
              Открываем страницу…
            </p>
          }
        >
          <Routes>
            <Route path="/" element={<LibraryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>
      <footer className="app-footer">Сохраняйте вкусные моменты.</footer>
    </>
  );
}
