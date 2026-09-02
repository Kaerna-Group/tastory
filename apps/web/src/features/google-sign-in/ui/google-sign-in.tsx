import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getSession, subscribeSession, signIn, signOut, recheckSession } from '@/entities/session';
import { env } from '@/shared/config';
import {
  loadGoogleIdentity,
  listenGoogleCredential,
  disableGoogleAutoSelect,
} from '@/shared/google-identity';

export function GoogleSignIn(): React.JSX.Element {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const button = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const configured = env.apiMode === 'apps-script' && Boolean(env.googleClientId);
  useEffect(() => {
    if (!configured || session.status !== 'signed-out') return;
    let active = true;
    let stopListening: (() => void) | undefined;
    const container = button.current;
    void loadGoogleIdentity()
      .then((api) => {
        if (!active || !container) return;
        stopListening = listenGoogleCredential(api, env.googleClientId, (credential) => {
          if (active) void signIn(credential);
        });
        api.renderButton(container, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          locale: 'ru',
          width: 240,
        });
      })
      .catch(() => {
        if (active)
          setLoadError('Кнопка Google не загрузилась. Проверьте соединение и попробуйте снова.');
      });
    return () => {
      active = false;
      stopListening?.();
      container?.replaceChildren();
    };
  }, [configured, session.status, attempt]);
  return (
    <section className="panel" aria-labelledby="account-title">
      <h2 id="account-title">Ваш аккаунт</h2>
      <p className="muted mb-6">Войдите через Google с адресом, на который вас пригласили.</p>
      {!configured ? (
        <p className="muted">Вход Google ещё настраивается. Здесь появится кнопка входа.</p>
      ) : session.status === 'signed-in' && session.user ? (
        <>
          <p className="font-semibold">{session.user.name}</p>
          <p className="muted">{session.user.email}</p>
          <p className="muted text-sm">
            {{ owner: 'Владелец', member: 'Участник', viewer: 'Читатель' }[session.user.role]}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                void recheckSession();
              }}
            >
              Проверить доступ
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                disableGoogleAutoSelect();
                signOut();
              }}
            >
              Выйти
            </button>
          </div>
        </>
      ) : (
        <>
          <div ref={button} aria-label="Вход через Google" hidden={session.status === 'checking'} />
          {session.status === 'checking' && (
            <button className="button button-secondary" type="button" onClick={() => signOut()}>
              Отменить
            </button>
          )}
          {loadError && (
            <>
              <p role="alert" className="mt-5">
                {loadError}
              </p>
              <button
                className="button button-secondary mt-5"
                type="button"
                onClick={() => {
                  setLoadError('');
                  setAttempt((value) => value + 1);
                }}
              >
                Повторить загрузку
              </button>
            </>
          )}
        </>
      )}
      {session.message && (
        <p role="status" className="mt-5">
          {session.message}
        </p>
      )}
      <p className="muted text-sm mt-5">
        После закрытия или обновления страницы потребуется войти снова. Сохранение рецептов появится
        позже.
      </p>
    </section>
  );
}
