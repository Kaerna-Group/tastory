import { Link } from 'react-router';
import { useSyncExternalStore } from 'react';
import { getSession, subscribeSession } from '@/entities/session';
import { RecipeLibrary } from '@/features/recipe-notebook';
import { GoogleSignIn } from '@/features/google-sign-in';
export function LibraryPage(): React.JSX.Element {
  const session = useSyncExternalStore(subscribeSession, getSession);
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">Место для вкусных историй</p>
        <h1>Ваша кулинарная тетрадь</h1>
        <p className="muted">
          Любимые блюда, маленькие секреты и рецепты, к которым хочется возвращаться.
        </p>
      </div>
      {session.user ? (
        <RecipeLibrary
          key={session.user.id}
          subject={session.user.id}
          writer={session.user.role !== 'viewer'}
          owner={session.user.role === 'owner'}
        />
      ) : (
        <>
          <section className="notebook" aria-labelledby="empty-title">
            <span className="notebook-tab" aria-hidden="true">
              01
            </span>
            <img
              className="book-mark"
              src={`${import.meta.env.BASE_URL}brand/mark.svg`}
              width="64"
              height="64"
              alt=""
            />
            <p className="eyebrow">Первая страница</p>
            <h2 id="empty-title">Всё начинается с одного рецепта</h2>
            <p className="muted mx-auto max-w-lg">
              Войдите, чтобы собрать любимые рецепты, открыть свою тетрадь и продолжить локальные
              черновики.
            </p>
            <span className="stage-label">Ваши рецепты · автоматическое сохранение</span>
          </section>
          <GoogleSignIn />
        </>
      )}
      <div className="library-footer">
        <p className="muted text-sm">Tastory · начало вашей коллекции</p>
        <Link className="text-link" to="/settings">
          Аккаунт и настройки <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </>
  );
}
