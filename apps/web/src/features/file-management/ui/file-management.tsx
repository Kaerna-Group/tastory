import { useEffect, useState, useSyncExternalStore } from 'react';
import { getSession, requestSessionRecipes, subscribeSession } from '@/entities/session';
import type { RecipeCommand, RecipeData } from '../model/types';

type Report = Extract<RecipeData, { kind: 'files' }>;
type Command = Extract<RecipeCommand, { action: `admin.files.${string}` }>;
const labels: Record<Report['items'][number]['status'], string> = {
  missing: 'Файл по ссылке не найден',
  damaged: 'Файл повреждён или продублирован',
  orphaned: 'Не используется книгой',
  unknown: 'Неизвестный файл',
  trashed: 'В корзине Tastory',
};

export function FileManagement() {
  const session = useSyncExternalStore(subscribeSession, getSession);
  return session.status === 'signed-in' && session.user?.role === 'owner' ? (
    <FileManagementPanel key={session.user.id} />
  ) : null;
}

function FileManagementPanel() {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  async function run(command: Command) {
    setBusy(true);
    setError('');
    try {
      const result = await requestSessionRecipes(command, crypto.randomUUID());
      if (result.kind !== 'files') throw new Error('Сервер не вернул отчёт о файлах.');
      setReport(result);
      setConfirmCleanup(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось завершить действие.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void requestSessionRecipes(
      { action: 'admin.files.audit', payload: {} },
      crypto.randomUUID(),
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted && result.kind === 'files') setReport(result);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Не удалось проверить файлы.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, []);
  return (
    <section className="panel" aria-labelledby="file-management-title">
      <h2 id="file-management-title">Файлы книги</h2>
      <p className="muted">
        Проверка сопоставляет файлы с текущими рецептами и всей сохранённой историей. Неизвестные
        файлы показываются в отчёте, но автоматически не удаляются.
      </p>
      <div className="recipe-row-actions">
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={() => void run({ action: 'admin.files.audit', payload: {} })}
        >
          Проверить файлы
        </button>
        {report && report.summary.orphaned > 0 && (
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => void run({ action: 'admin.files.trashUnused', payload: {} })}
          >
            В корзину все неиспользуемые
          </button>
        )}
      </div>
      {busy && <p role="status">Проверяем файлы и связи…</p>}
      {error && <p role="alert">{error}</p>}
      {report && (
        <>
          <p className="file-summary" role="status">
            Исправны: {report.summary.healthy} · потеряны: {report.summary.missing} · повреждены:{' '}
            {report.summary.damaged} · не используются: {report.summary.orphaned} · неизвестны:{' '}
            {report.summary.unknown} · в корзине: {report.summary.trashed}
          </p>
          <p className="muted text-sm">
            Последняя проверка: {new Date(report.checkedAt).toLocaleString('ru')}
          </p>
          {report.items.length === 0 && <p>Все связанные файлы на месте, корзина пуста.</p>}
          {report.items.length > 0 && (
            <ul className="file-report-list">
              {report.items.map((item, index) => (
                <li key={`${item.status}:${item.fileId ?? item.name}:${index}`}>
                  <div>
                    <strong>{labels[item.status]}</strong>
                    <p className="muted text-sm">{item.name}</p>
                  </div>
                  {item.status === 'orphaned' && item.fileId && (
                    <button
                      type="button"
                      className="text-link"
                      disabled={busy}
                      onClick={() =>
                        void run({
                          action: 'admin.files.trash',
                          payload: { fileId: item.fileId ?? '' },
                        })
                      }
                    >
                      В корзину
                    </button>
                  )}
                  {item.status === 'trashed' && item.fileId && (
                    <button
                      type="button"
                      className="text-link"
                      disabled={busy}
                      onClick={() =>
                        void run({
                          action: 'admin.files.restore',
                          payload: { fileId: item.fileId ?? '' },
                        })
                      }
                    >
                      Восстановить
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {report.summary.trashed > 0 &&
            (confirmCleanup ? (
              <div className="recipe-notice">
                <p>
                  Отправить содержимое корзины Tastory в корзину Google Drive? Автоматическое
                  восстановление после этого станет недоступно.
                </p>
                <div className="recipe-row-actions">
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={busy}
                    onClick={() => void run({ action: 'admin.files.cleanup', payload: {} })}
                  >
                    Очистить корзину
                  </button>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => setConfirmCleanup(false)}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="text-link" onClick={() => setConfirmCleanup(true)}>
                Очистить корзину Tastory
              </button>
            ))}
        </>
      )}
    </section>
  );
}
