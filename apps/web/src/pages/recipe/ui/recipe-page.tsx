import { useSyncExternalStore } from 'react';
import { Link, useParams } from 'react-router';
import { getSession, subscribeSession } from '@/entities/session';
import { RecipeEditor } from '@/features/recipe-notebook';
import { GoogleSignIn } from '@/features/google-sign-in';

export function RecipePage({ source }: { source: 'draft' | 'recipe' }) {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const { id } = useParams();
  return (
    <div className="recipe-page-shell">
      <div className="recipe-page-heading">
        <Link to="/" className="text-link">
          ← В библиотеку
        </Link>
        <h1 className="sr-only">Рецепт Tastory</h1>
        <p className="muted text-sm">Книжная страница и её содержание</p>
      </div>
      {session.user && id ? (
        <RecipeEditor
          key={`${session.user.id}:${source}:${id}`}
          subject={session.user.id}
          writer={session.user.role !== 'viewer'}
          id={id}
          source={source}
        />
      ) : (
        <>
          <p className="recipe-notice">
            Войдите в аккаунт, чтобы открыть рецепт и восстановить локальный черновик.
          </p>
          <GoogleSignIn />
        </>
      )}
    </div>
  );
}
