import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getSession, subscribeSession, requestSessionJournal } from '@/entities/session';
import { ApiClientError } from '@/shared/api';
import type { JournalData } from '../model/types';

export function OperationJournal(): React.JSX.Element | null {
  const session = useSyncExternalStore(subscribeSession, getSession);
  return session.status === 'signed-in' && session.user?.role === 'owner' ? (
    <JournalPanel key={session.user.id} />
  ) : null;
}
function JournalPanel(): React.JSX.Element {
  const [list, setList] = useState<Extract<JournalData, { kind: 'list' }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [retryId, setRetryId] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [],
  );

  async function run(mode: 'list' | 'initialize' | 'check', resumeId?: string) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    setMessage('');
    setList(null);
    try {
      if (mode === 'initialize') {
        await requestSessionJournal(
          'admin.operations.initialize',
          crypto.randomUUID(),
          controller.signal,
        );
        if (!controller.signal.aborted)
          setMessage('Журнал подготовлен. Можно проверить сохранение и повтор записи.');
      }
      if (mode === 'check') {
        const id = resumeId ?? retryId ?? crypto.randomUUID();
        setRetryId(id);
        await requestSessionJournal('admin.operations.check', id, controller.signal);
        const repeated = await requestSessionJournal(
          'admin.operations.check',
          id,
          controller.signal,
        );
        if (repeated.kind !== 'check' || repeated.outcome !== 'replayed')
          throw new ApiClientError(
            'INVALID_RESPONSE',
            'Повтор записи не подтверждён. Обновите журнал.',
          );
        if (!controller.signal.aborted) {
          setRetryId(null);
          setMessage('Проверка пройдена: запись и аудит сохранены, повтор не создал дубликат.');
        }
      }
      const result = await requestSessionJournal(
        'admin.operations.list',
        crypto.randomUUID(),
        controller.signal,
      );
      if (result.kind === 'list' && !controller.signal.aborted) setList(result);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof ApiClientError
            ? cause.message
            : 'Не удалось прочитать журнал. Попробуйте снова.',
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (pending.current === controller) pending.current = null;
    }
  }

  return (
    <section className="panel workspace-admin" aria-labelledby="journal-title">
      <p className="eyebrow">Для владельца</p>
      <h2 id="journal-title">Журнал операций</h2>
      <p className="muted">
        Здесь видно, завершилась ли запись и сохранено ли событие аудита. Проверочная запись поможет
        убедиться, что повтор не создаёт дубликат.
      </p>
      <div className="flex flex-wrap gap-3 mb-6">
        <button
          className="button button-secondary"
          type="button"
          disabled={busy}
          onClick={() => {
            void run('list');
          }}
        >
          {list ? 'Обновить журнал' : 'Открыть журнал'}
        </button>
        {list && !list.ready && (
          <button
            className="button button-secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              void run('initialize');
            }}
          >
            Подготовить журнал
          </button>
        )}
        {(list?.ready || retryId) && (
          <button
            className="button button-secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              void run('check');
            }}
          >
            {retryId ? 'Повторить ту же проверку' : 'Проверить сохранение и повтор'}
          </button>
        )}
      </div>
      {busy && (
        <p className="muted" role="status">
          Работаем с журналом. Это может занять около минуты.
        </p>
      )}
      {!busy && message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      {list && !list.ready && (
        <p className="muted">
          Журнал ещё не подготовлен. Создадим две таблицы для записей и аудита; повторная подготовка
          безопасна.
        </p>
      )}
      {list?.ready && (
        <>
          <p className="muted text-sm">
            Записей: {list.total}. Показаны последние {list.entries.length}.
          </p>
          {list.total === 0 && <p>Пока записей нет.</p>}
          <ul className="member-list" aria-label="Операции">
            {list.entries.map((entry) => (
              <li className="member-row" key={entry.id}>
                <div className="member-identity">
                  <p className="font-semibold">Проверка журнала</p>
                  <p className="muted text-sm">
                    {entry.actorName} · {new Date(entry.startedAt).toLocaleString('ru-RU')}
                  </p>
                </div>
                <div className="member-access">
                  <span className="member-role">
                    {entry.status === 'committed' ? 'Завершено' : 'Ожидает завершения'}
                  </span>
                  <span className="muted text-sm">
                    {entry.auditRecorded ? 'Аудит сохранён' : 'Аудит ожидается'}
                  </span>
                  {entry.canRetry && (
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void run('check', entry.id);
                      }}
                    >
                      Завершить проверку
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
