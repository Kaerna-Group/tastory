import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  getSession,
  requestSessionRecipes,
  requestSessionStickers,
  requestSessionTemplates,
  subscribeSession,
} from '@/entities/session';
import {
  buildTransferDocument,
  importTransferDocument,
  parseTransferDocument,
  previewTransfer,
  serializeTransferDocument,
  transferFingerprint,
  verifyTransferFiles,
} from '@/entities/recipe-transfer';
import type { ImportReport, TransferPreview, TransferProgress } from '@/entities/recipe-transfer';
import { env } from '@/shared/config';
import type { RecipeTransferDocument } from '../model/types';

const transferRequests = {
  recipes: requestSessionRecipes,
  stickers: requestSessionStickers,
  templates: requestSessionTemplates,
};

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const date = () => new Date().toISOString().slice(0, 10);

export function DataTransfer() {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const user = session.user;
  return session.status === 'signed-in' && user && user.role !== 'viewer' ? (
    <TransferPanel key={user.id} subject={user.id} owner={user.role === 'owner'} />
  ) : null;
}

function TransferPanel({ subject, owner }: { subject: string; owner: boolean }) {
  const [document, setDocument] = useState<RecipeTransferDocument | null>(null);
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [fingerprint, setFingerprint] = useState('');
  const [collision, setCollision] = useState<'copy' | 'skip'>('skip');
  const [visibility, setVisibility] = useState<'private' | 'preserve'>('private');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [],
  );
  const key = (hash = fingerprint, policy = visibility) =>
    `tastory.import.v1:${JSON.stringify([env.apiUrl || 'mock', subject, hash, policy])}`;
  async function inspect(file: File) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    setMessage('');
    setReport(null);
    setDocument(null);
    setPreview(null);
    try {
      if (!file.size || file.size > 250 * 1024 * 1024)
        throw new Error('Выберите файл Tastory размером до 250 МБ.');
      const text = await file.text();
      controller.signal.throwIfAborted();
      const parsed = parseTransferDocument(text);
      setProgress({ completed: 0, total: parsed.recipes.length, message: 'Проверяем фотографии' });
      await verifyTransferFiles(parsed, controller.signal);
      const list = await requestSessionRecipes(
        { action: 'recipes.list', payload: {} },
        crypto.randomUUID(),
        controller.signal,
      );
      if (list.kind !== 'recipes') throw new Error('Не удалось проверить совпадения.');
      const hash = await transferFingerprint(text);
      if (controller.signal.aborted) return;
      setDocument(parsed);
      setPreview(previewTransfer(parsed, list.recipes));
      setFingerprint(hash);
      setMessage('Файл проверен. Выберите обработку совпадений и запустите импорт.');
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Не удалось проверить файл переноса.');
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        setProgress(null);
      }
      pending.current = null;
    }
  }
  async function exportBook() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    setMessage('');
    setReport(null);
    try {
      const list = await requestSessionRecipes(
        { action: 'recipes.list', payload: {} },
        crypto.randomUUID(),
        controller.signal,
      );
      if (list.kind !== 'recipes' || !list.recipes.length)
        throw new Error('В книге пока нет рецептов для экспорта.');
      const result = await buildTransferDocument(
        'book',
        list.recipes.map((recipe) => recipe.id),
        transferRequests,
        controller.signal,
        setProgress,
      );
      download(serializeTransferDocument(result), `tastory-book-${date()}.tastory.json`);
      setMessage(`Экспортировано рецептов: ${result.recipes.length}. Файл сохранён на устройство.`);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Не удалось экспортировать книгу.');
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        setProgress(null);
      }
      pending.current = null;
    }
  }
  async function runImport() {
    if (!document || !preview || !fingerprint || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    setMessage('');
    setReport(null);
    try {
      const storageKey = key();
      const runId = localStorage.getItem(storageKey) ?? crypto.randomUUID();
      localStorage.setItem(storageKey, runId);
      const result = await importTransferDocument(
        document,
        { collision, visibility, runId },
        transferRequests,
        controller.signal,
        setProgress,
      );
      if (controller.signal.aborted) return;
      setReport(result);
      setMessage(
        `Импорт завершён: рецептов — ${result.imported}, пропущено — ${result.skipped}, фотографий — ${result.photos}, стикеров — ${result.stickers}.`,
      );
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          `${cause instanceof Error ? cause.message : 'Импорт не завершён.'} Повтор продолжит тот же перенос без дублей.`,
        );
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        setProgress(null);
      }
      pending.current = null;
    }
  }
  function newRun() {
    localStorage.removeItem(key());
    setReport(null);
    setMessage('Следующий запуск создаст отдельные копии рецептов.');
    setCollision('copy');
  }
  return (
    <section className="panel" aria-labelledby="transfer-title">
      <h2 id="transfer-title">Импорт и экспорт</h2>
      <p className="muted">
        Файл Tastory содержит рецепты, теги, фотографии и сохранённое оформление со стикерами. Перед
        импортом он полностью проверяется; данные записываются только после предпросмотра.
      </p>
      <div className="recipe-row-actions">
        {owner && (
          <button
            className="button button-secondary"
            type="button"
            disabled={busy}
            onClick={() => void exportBook()}
          >
            Экспортировать книгу с файлами
          </button>
        )}
        <label className="button button-secondary">
          Выбрать файл для импорта
          <input
            className="sr-only"
            type="file"
            accept=".json,.tastory.json,application/json"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void inspect(file);
              event.target.value = '';
            }}
          />
        </label>
      </div>
      {progress && (
        <p role="status">
          {progress.message}: {progress.completed} из {progress.total}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      {document && preview && (
        <div className="recipe-notice">
          <h3>Предварительный просмотр</h3>
          <p>
            {document.kind === 'book' ? 'Книга' : 'Рецепт'} · рецептов: {preview.recipes} ·
            ингредиентов: {preview.ingredients} · шагов: {preview.steps} · фотографий:{' '}
            {preview.photos}
          </p>
          <p>Совпадений по названию: {preview.conflicts.length}.</p>
          {preview.conflicts.length > 0 && (
            <ul>
              {preview.conflicts.slice(0, 10).map((item) => (
                <li key={item.sourceId}>{item.title}</li>
              ))}
            </ul>
          )}
          <label>
            Совпадения
            <select
              aria-label="Обработка совпадений"
              value={collision}
              disabled={busy}
              onChange={(event) => setCollision(event.target.value === 'copy' ? 'copy' : 'skip')}
            >
              <option value="skip">Пропустить рецепты с таким названием</option>
              <option value="copy">Создать отдельные копии</option>
            </select>
          </label>
          <label>
            Видимость
            <select
              aria-label="Видимость импортируемых рецептов"
              value={visibility}
              disabled={busy}
              onChange={(event) =>
                setVisibility(event.target.value === 'preserve' ? 'preserve' : 'private')
              }
            >
              <option value="private">Импортировать личными</option>
              <option value="preserve">Сохранить видимость из файла</option>
            </select>
          </label>
          <div className="recipe-row-actions">
            <button
              className="button button-primary"
              type="button"
              disabled={busy}
              onClick={() => void runImport()}
            >
              Импортировать после проверки
            </button>
            {report && (
              <button
                className="button button-secondary"
                type="button"
                disabled={busy}
                onClick={newRun}
              >
                Подготовить ещё одну копию
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
