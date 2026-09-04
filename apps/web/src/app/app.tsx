import { lazy, Suspense } from 'react';
import { NavLink, Route, Routes } from 'react-router';
import { LibraryPage } from '@/pages/library';
import { NotFoundPage } from '@/pages/not-found';
import { UserSettingsSync } from '@/features/user-settings';
import { HelpCenter } from '@/features/help-center';
const SettingsPage = lazy(async () => ({
  default: (await import('@/pages/settings')).SettingsPage,
}));
const RecipePage = lazy(async () => ({ default: (await import('@/pages/recipe')).RecipePage }));
export function App(): React.JSX.Element {
  return (
    <>
      <UserSettingsSync />
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
          <img
            className="brand-icon"
            src={`${import.meta.env.BASE_URL}brand/mark.svg`}
            width="40"
            height="40"
            alt=""
          />
          <span className="brand-wordmark">
            tastory
            <span className="brand-dot" aria-hidden="true">
              .
            </span>
          </span>
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
            <Route path="/drafts/:id" element={<RecipePage source="draft" />} />
            <Route path="/recipes/:id" element={<RecipePage source="recipe" />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>
      <footer className="app-footer" lang="en">
        Every recipe has a story.
      </footer>
      <HelpCenter />
    </>
  );
}
