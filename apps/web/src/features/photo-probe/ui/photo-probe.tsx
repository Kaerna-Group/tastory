import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getSession, subscribeSession, requestSessionPhoto } from '@/entities/session';
import { preparePhoto } from '@/shared/api';
import { env } from '@/shared/config';
import type { PreparedPhoto } from '@/shared/api';

type Saved = Awaited<ReturnType<typeof requestSessionPhoto>>;
const size = (bytes: number) => `${(bytes / 1024).toFixed(1)} КБ`;
function OwnerPhotoProbe() {
  const [saved, setSaved] = useState<Saved>({ photo: null, thumbnailBase64: null });
  const [prepared, setPrepared] = useState<PreparedPhoto | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('Проверяем сохранённое фото…');
  const [failed, setFailed] = useState(false);
  const [timing, setTiming] = useState<{ uploadMs?: number; readMs: number } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    void requestSessionPhoto({ action: 'spike.photo.read', payload: {} }, current.signal)
      .then((result) => {
        if (current.signal.aborted) return;
        setSaved(result);
        setMessage(
          result.photo
            ? 'Миниатюра получена из приватного хранилища.'
            : 'Выберите фото для проверки.',
        );
      })
      .catch((error: unknown) => {
        if (!current.signal.aborted) {
          setFailed(true);
          setMessage(error instanceof Error ? error.message : 'Не удалось получить фото.');
        }
      })
      .finally(() => {
        if (!current.signal.aborted) setBusy(false);
      });
    return () => {
      controller.current?.abort();
    };
  }, []);

  async function run(operation: (signal: AbortSignal) => Promise<void>) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setFailed(false);
    try {
      await operation(current.signal);
    } catch (error) {
      if (!current.signal.aborted) {
        setFailed(true);
        setMessage(
          error instanceof Error ? error.message : 'Проверка не завершилась. Попробуйте снова.',
        );
      }
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }
  async function read(signal: AbortSignal) {
    const start = performance.now();
    const result = await requestSessionPhoto({ action: 'spike.photo.read', payload: {} }, signal);
    signal.throwIfAborted();
    setSaved(result);
    setMessage(
      result.photo
        ? 'Миниатюра получена из приватного хранилища.'
        : 'Сохранённого тестового фото нет.',
    );
    return Math.round(performance.now() - start);
  }
  return (
    <section className="panel" aria-labelledby="photo-probe-title">
      <p className="eyebrow">Проверка перед рецептами</p>
      <h2 id="photo-probe-title">Пробное фото</h2>
      <p className="muted mb-6">
        Фото уменьшится перед загрузкой. Сохраним его в закрытой папке и проверим получение
        миниатюры. Одновременно можно хранить одно тестовое фото.
      </p>
      {!saved.photo && (
        <div className="photo-picker">
          <label className="font-semibold" htmlFor="probe-photo">
            Выбрать фото
          </label>
          <input
            ref={fileInput}
            id="probe-photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setPrepared(null);
              setTiming(null);
              void run(async (signal) => {
                setMessage('Уменьшаем фото…');
                const result = await preparePhoto(file, signal);
                signal.throwIfAborted();
                setPrepared(result);
                setMessage('Фото подготовлено. Можно загрузить.');
              });
            }}
          />
          <p className="muted text-sm">JPEG, PNG или WebP · до 20 МБ</p>
        </div>
      )}
      {saved.thumbnailBase64 ? (
        <figure className="photo-preview">
          <img
            src={`data:image/jpeg;base64,${saved.thumbnailBase64}`}
            alt="Миниатюра, полученная из приватного хранилища"
          />
          <figcaption className="muted text-sm">
            Загружено из хранилища после проверки доступа.
          </figcaption>
        </figure>
      ) : prepared && !saved.photo ? (
        <figure className="photo-preview">
          <img
            src={`data:image/jpeg;base64,${prepared.payload.thumbnailBase64}`}
            alt="Предпросмотр выбранного фото"
          />
          <figcaption className="muted text-sm">
            Было {size(prepared.sourceBytes)} → станет {size(prepared.imageBytes)}.
          </figcaption>
        </figure>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-3">
        {prepared && !saved.photo && (
          <button
            className="button button-primary"
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async (signal) => {
                setMessage('Загружаем фото…');
                const start = performance.now();
                const result = await requestSessionPhoto(
                  { action: 'spike.photo.upload', payload: prepared.payload },
                  signal,
                );
                signal.throwIfAborted();
                setSaved(result);
                const uploadMs = Math.round(performance.now() - start);
                setMessage('Фото сохранено. Получаем миниатюру…');
                const readMs = await read(signal);
                setTiming({ uploadMs, readMs });
              })
            }
          >
            Загрузить и проверить
          </button>
        )}
        <button
          className="button button-secondary"
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async (signal) => {
              setMessage('Получаем фото из хранилища…');
              const readMs = await read(signal);
              setTiming((value) => ({ ...value, readMs }));
            })
          }
        >
          Обновить просмотр
        </button>
        {saved.photo && (
          <button
            className="button button-secondary"
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async (signal) => {
                if (!saved.photo) return;
                setMessage('Удаляем тестовое фото…');
                await requestSessionPhoto(
                  { action: 'spike.photo.delete', payload: { id: saved.photo.id } },
                  signal,
                );
                signal.throwIfAborted();
                setSaved({ photo: null, thumbnailBase64: null });
                setPrepared(null);
                setTiming(null);
                if (fileInput.current) fileInput.current.value = '';
                setMessage('Тестовое фото удалено. Можно выбрать другое.');
              })
            }
          >
            Удалить тестовое фото
          </button>
        )}
      </div>
      <p className="mt-5" role={failed ? 'alert' : 'status'}>
        {message}
      </p>
      {saved.photo && (
        <p className="muted text-sm">
          {saved.photo.width} × {saved.photo.height} · фото {size(saved.photo.bytes)} · миниатюра{' '}
          {size(saved.photo.thumbnailBytes)}
        </p>
      )}
      {timing && (
        <p className="muted text-sm">
          {timing.uploadMs !== undefined && `Загрузка: ${(timing.uploadMs / 1000).toFixed(1)} с. `}
          Получение миниатюры: {(timing.readMs / 1000).toFixed(1)} с.
        </p>
      )}
    </section>
  );
}
export function PhotoProbe() {
  const session = useSyncExternalStore(subscribeSession, getSession);
  if (
    env.environment !== 'staging' ||
    session.status !== 'signed-in' ||
    session.user?.role !== 'owner'
  )
    return null;
  return <OwnerPhotoProbe key={session.user.id} />;
}
