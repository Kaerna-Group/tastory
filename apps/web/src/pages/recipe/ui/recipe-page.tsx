import { useSyncExternalStore } from 'react';
import { Link, useParams } from 'react-router';
import { getSession, subscribeSession } from '@/entities/session';
import { RecipeEditor } from '@/features/recipe-notebook';
import { GoogleSignIn } from '@/features/google-sign-in';
import { getThemePreferences, subscribeThemePreferences, themeCssVariables } from '@/shared/theme';
import type { CSSProperties } from 'react';

export function RecipePage({ source }: { source: 'draft' | 'recipe' }) {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const theme = useSyncExternalStore(subscribeThemePreferences, getThemePreferences).page;
  const { id } = useParams();
  return (
    <div
      className="recipe-page-theme"
      data-paper={theme.paper}
      data-mode={theme.mode}
      style={{ ...themeCssVariables(theme), colorScheme: theme.mode } as CSSProperties}
    >
      <div className="page-heading">
        <Link to="/" className="text-link">
          ← В библиотеку
        </Link>
        <p className="eyebrow mt-5">Вкусные истории</p>
        <h1>Ваш рецепт</h1>
        <p className="muted">Записывайте по шагам. Мы бережно сохраним каждую правку.</p>
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
