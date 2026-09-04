import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  getSession,
  subscribeSession,
  requestSessionBackups,
  requestSessionRecipes,
} from '@/entities/session';
import { env } from '@/shared/config';
import type { BackupCommand, BackupData } from '../model/types';

export function BookBackups() {
  const session = useSyncExternalStore(subscribeSession, getSession);
  return session.status === 'signed-in' && session.user?.role === 'owner' ? (
    <BackupPanel key={session.user.id} subject={session.user.id} />
  ) : null;
}
function BackupPanel({ subject }: { subject: string }) {
  const [list, setList] = useState<Extract<BackupData, { kind: 'backups' }> | null>(null);
  const [restored, setRestored] = useState<Extract<BackupData, { kind: 'restored' }> | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [],
  );
  async function run(command: BackupCommand, resumeId?: string) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    setMessage('');
    const durable =
      command.action === 'admin.backups.create' || command.action === 'admin.backups.restore';
    const key = `tastory.backup.v1:${JSON.stringify([env.apiUrl, subject, command])}`;
    try {
      const id = resumeId ?? (durable ? localStorage.getItem(key) : null) ?? crypto.randomUUID();
      if (durable) localStorage.setItem(key, id);
      const result = await requestSessionBackups(command, id, controller.signal);
      if (controller.signal.aborted) return;
      if (durable) localStorage.removeItem(key);
      if (result.kind === 'backups') setList(result);
      else if (result.kind === 'restored') {
        setRestored(result);
        setMessage('Книга восстановлена в отдельные ресурсы. Откройте их для проверки.');
      } else {
        setMessage(
          `Копия проверена: таблиц — ${result.backup.tables}, файлов — ${result.backup.files}.`,
        );
        setList(null);
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Не удалось завершить действие. Повторите запрос.',
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      pending.current = null;
    }
  }
  async function archive() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    try {
      const result = await requestSessionRecipes(
        { action: 'admin.recipes.archiveHistory', payload: {} },
        crypto.randomUUID(),
        controller.signal,
      );
      if (!controller.signal.aborted && result.kind === 'archivedHistory')
        setMessage(
          `История сохранена: в архиве ${result.totalArchived} операций, в рабочем журнале ${result.active}.`,
        );
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Архивирование не завершено.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      pending.current = null;
    }
  }
  return (
    <section className="panel" aria-labelledby="backups-title">
      <h2 id="backups-title">Резервные копии</h2>
      <p className="muted">
        Сохраняются таблицы, история и файлы. Восстановление создаёт отдельную книгу и папку;
        переключение приложения выполняется после проверки.
      </p>
      <div className="recipe-row-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={busy}
          onClick={() => {
            void run({ action: 'admin.backups.create', payload: {} });
          }}
        >
          Создать резервную копию
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={() => {
            void run({ action: 'admin.backups.list', payload: {} });
          }}
        >
          Открыть копии
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={() => {
            void archive();
          }}
        >
          Архивировать историю
        </button>
      </div>
      {busy && (
        <p role="status">
          Проверяем и копируем данные… Если соединение прервётся, повторите действие.
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error} Повтор использует прежний запрос.</p>}
      {list && (
        <>
          {!list.backups.length && <p>Готовых копий пока нет.</p>}
          <ul>
            {list.backups.map((backup) => (
              <li key={backup.id}>
                <p>
                  {new Date(backup.createdAt).toLocaleString('ru')} · {backup.tables} таблиц ·{' '}
                  {backup.files} файлов
                </p>
                <div className="recipe-row-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() => {
                      void run({
                        action: 'admin.backups.verify',
                        payload: { backupId: backup.id },
                      });
                    }}
                  >
                    Проверить копию
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() => {
                      void run({
                        action: 'admin.backups.restore',
                        payload: { backupId: backup.id },
                      });
                    }}
                  >
                    Восстановить отдельно
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {list.incomplete.map((id) => (
            <p key={id}>
              Копия не завершена.{' '}
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => {
                  void run({ action: 'admin.backups.create', payload: {} }, id);
                }}
              >
                Продолжить копирование
              </button>
            </p>
          ))}
        </>
      )}
      {restored && (
        <p className="recipe-row-actions">
          <a className="text-link" href={restored.spreadsheetUrl} target="_blank" rel="noreferrer">
            Восстановленная книга
          </a>
          <a className="text-link" href={restored.folderUrl} target="_blank" rel="noreferrer">
            Файлы книги
          </a>
          <a
            className="text-link"
            href={restored.configurationUrl}
            target="_blank"
            rel="noreferrer"
          >
            Настройки подключения для владельца
          </a>
        </p>
      )}
    </section>
  );
}
