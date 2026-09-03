import { useSyncExternalStore } from 'react';
import {
  getAccessCheck,
  subscribeAccessCheck,
  startAccessCheck,
  finishAccessCheck,
  clearAccessCheck,
} from '@/entities/session';
import { env } from '@/shared/config';

const labels = {
  repeatedSignIn: 'Повторный вход тем же аккаунтом',
  deniedSignIn: 'Отказ при входе',
  revokedSession: 'Отказ ранее допущенному аккаунту',
  restoredAccess: 'Вход после восстановления приглашения',
} as const;
const actions = { 'auth.signIn': 'Вход', 'auth.me': 'Проверка доступа', signOut: 'Выход' } as const;
const outcomes = {
  allowed: 'Доступ разрешён',
  denied: 'Доступ не разрешён',
  error: 'Проверка не завершилась',
  'signed-out': 'Выход выполнен',
} as const;

export function AccessCheck() {
  const state = useSyncExternalStore(subscribeAccessCheck, getAccessCheck);
  if (env.environment !== 'staging' || env.apiMode !== 'apps-script' || !env.googleClientId)
    return null;
  const report = state.report;
  function download() {
    finishAccessCheck();
    const completed = getAccessCheck().report;
    if (!completed) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(completed, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `tastory-access-${completed.runId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <details className="mt-6">
      <summary className="cursor-pointer font-semibold">Проверка приглашений</summary>
      <p className="muted text-sm mt-3">
        Включите запись перед проверкой. Отчёт сохранит результаты и время без имён, почты и
        токенов. Он остаётся в этой вкладке до очистки или обновления страницы.
      </p>
      <ol className="list-decimal pl-5 text-sm mt-3 space-y-2">
        <li>
          Нажмите «Начать проверку», затем «Проверить доступ». Выйдите и войдите тем же аккаунтом.
        </li>
        <li>Для проверки отказа выйдите и выберите другой, неприглашённый аккаунт Google.</li>
        <li>
          Отзыв проверяйте на отдельном тестовом участнике: войдите, попросите владельца убрать его
          приглашение, затем нажмите «Проверить доступ».
        </li>
        <li>После восстановления приглашения войдите снова и скачайте отчёт.</li>
      </ol>
      <p className="muted text-sm mt-3">
        Отказ при входе не определяет, какой аккаунт был выбран. Ошибка связи не считается отзывом
        доступа.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className="button button-secondary"
          type="button"
          disabled={state.recording}
          onClick={() => startAccessCheck(window.location.origin, navigator.userAgent)}
        >
          {state.recording ? 'Запись включена' : 'Начать проверку'}
        </button>
        {report && (
          <>
            <button className="button button-secondary" type="button" onClick={download}>
              Скачать отчёт о доступе
            </button>
            <button className="button button-secondary" type="button" onClick={clearAccessCheck}>
              Очистить отчёт
            </button>
          </>
        )}
      </div>
      {report && (
        <>
          <p className="muted text-sm mt-3">
            Скачивание завершает запись. Максимум 30 событий; новый запуск заменит предыдущий отчёт.
          </p>
          {report.stopReason === 'limit' && (
            <p role="status" className="mt-3">
              Запись завершена: достигнут лимит 30 событий. Скачайте отчёт.
            </p>
          )}
          <ul aria-label="Результаты проверки доступа" className="mt-4 text-sm space-y-2">
            {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => (
              <li key={key}>
                {labels[key]}:{' '}
                <strong>{report.checks[key] ? 'Зафиксировано' : 'Пока нет результата'}</strong>
              </li>
            ))}
          </ul>
          <ol aria-label="События проверки доступа" className="mt-4 text-sm space-y-2">
            {report.events.map((event, index) => (
              <li key={index}>
                {actions[event.action]} — {outcomes[event.outcome]}
                {event.action !== 'signOut' && ` · ${(event.elapsedMs / 1000).toFixed(1)} с`}
              </li>
            ))}
          </ol>
        </>
      )}
    </details>
  );
}
