import { useEffect, useState } from 'react';
import { requestSessionRecipes } from '@/entities/session';
import { preparePhoto } from '@/shared/api';
import type { RecipeSaveQueue } from '../model/save-queue';
import type { RecipePhoto } from '../model/drafts';

type Target =
  | { kind: 'cover'; position: 0 }
  | { kind: 'gallery'; position: number }
  | { kind: 'step'; stepId: string; position: number };

function PhotoCard({
  photo,
  recipeId,
  disabled,
  onDelete,
  confirmDelete,
}: {
  photo: RecipePhoto;
  recipeId: string;
  disabled: boolean;
  onDelete: () => Promise<void>;
  confirmDelete: boolean;
}) {
  const [thumbnail, setThumbnail] = useState('');
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void requestSessionRecipes(
      {
        action: 'recipes.photos.read',
        payload: { recipeId, photoId: photo.id, variant: 'thumbnail' },
      },
      crypto.randomUUID(),
      controller.signal,
    )
      .then((result) => {
        if (result.kind === 'photo') setThumbnail(result.base64);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Не удалось загрузить миниатюру.');
      });
    return () => controller.abort();
  }, [photo.id, photo.thumbnailDigest, recipeId]);
  return (
    <figure className="recipe-photo-card">
      {thumbnail ? (
        <img
          src={`data:image/jpeg;base64,${thumbnail}`}
          alt={photo.kind === 'cover' ? 'Обложка рецепта' : 'Фотография рецепта'}
        />
      ) : (
        <div className="recipe-photo-placeholder">Загрузка…</div>
      )}
      <figcaption>
        <span className="muted text-sm">
          {photo.width} × {photo.height}
        </span>
        <div className="recipe-row-actions">
          <button
            type="button"
            className="text-link"
            disabled={busy}
            onClick={() => {
              if (image) {
                setImage('');
                return;
              }
              setBusy(true);
              setError('');
              void requestSessionRecipes(
                {
                  action: 'recipes.photos.read',
                  payload: { recipeId, photoId: photo.id, variant: 'image' },
                },
                crypto.randomUUID(),
              )
                .then((result) => {
                  if (result.kind === 'photo') setImage(result.base64);
                })
                .catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : 'Не удалось открыть фото.'),
                )
                .finally(() => setBusy(false));
            }}
          >
            {image ? 'Скрыть' : 'Открыть'}
          </button>
          <button
            type="button"
            className="text-link"
            disabled={disabled || busy}
            onClick={() => {
              if (confirmDelete && !window.confirm('Удалить фотографию из рецепта?')) return;
              setBusy(true);
              setError('');
              void onDelete()
                .catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : 'Не удалось удалить фото.'),
                )
                .finally(() => setBusy(false));
            }}
          >
            Удалить
          </button>
        </div>
      </figcaption>
      {image && (
        <img className="recipe-photo-full" src={`data:image/jpeg;base64,${image}`} alt="" />
      )}
      {error && <p role="alert">{error}</p>}
    </figure>
  );
}

function PhotoPicker({
  label,
  disabled,
  onPick,
}: {
  label: string;
  disabled: boolean;
  onPick: (file: File) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <div className="recipe-photo-picker">
      <label className="button button-secondary">
        {busy ? 'Обрабатываем фото…' : label}
        <input
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled || busy}
          onChange={(event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            if (!file) return;
            setBusy(true);
            setMessage('');
            void onPick(file)
              .then(() => setMessage('Фото сохранено.'))
              .catch((cause: unknown) =>
                setMessage(cause instanceof Error ? cause.message : 'Не удалось сохранить фото.'),
              )
              .finally(() => {
                input.value = '';
                setBusy(false);
              });
          }}
        />
      </label>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </div>
  );
}

export function RecipePhotos({
  queue,
  editable,
  confirmDelete,
}: {
  queue: RecipeSaveQueue;
  editable: boolean;
  confirmDelete: boolean;
}) {
  const snapshot = queue.getSnapshot();
  const aggregate = snapshot.draft.base;
  if (!aggregate)
    return (
      <section className="panel recipe-section">
        <h2>Фотографии</h2>
        <p className="muted">Сохраните рецепт первый раз, затем добавьте фотографии.</p>
      </section>
    );
  const saved = aggregate;
  const recipeId = saved.recipe.id;
  const ready =
    editable && snapshot.status === 'saved' && !snapshot.draft.pending && !snapshot.draft.conflict;
  async function refresh(revision: number) {
    const result = await requestSessionRecipes(
      { action: 'recipes.get', payload: { recipeId } },
      crypto.randomUUID(),
    );
    if (result.kind !== 'recipe' || result.aggregate.recipe.revision < revision)
      throw new Error('Не удалось получить сохранённую версию рецепта.');
    queue.observeRemote(result.aggregate);
  }
  async function add(file: File, target: Target) {
    if (!ready) throw new Error('Дождитесь сохранения текста рецепта.');
    const controller = new AbortController();
    const prepared = await preparePhoto(file, controller.signal);
    const result = await requestSessionRecipes(
      {
        action: 'recipes.photos.add',
        payload: {
          recipeId,
          expectedRevision: saved.recipe.revision,
          photo: {
            ...prepared.payload,
            width: prepared.width,
            height: prepared.height,
            imageBytes: prepared.imageBytes,
            thumbnailBytes: prepared.thumbnailBytes,
          },
          target,
        },
      },
      prepared.payload.uploadId,
    );
    if (result.kind !== 'saved') throw new Error('Сервер не подтвердил сохранение фото.');
    await refresh(result.revision);
  }
  async function remove(photo: RecipePhoto) {
    if (!ready) throw new Error('Дождитесь сохранения текста рецепта.');
    const result = await requestSessionRecipes(
      {
        action: 'recipes.photos.delete',
        payload: {
          recipeId,
          expectedRevision: saved.recipe.revision,
          photoId: photo.id,
        },
      },
      crypto.randomUUID(),
    );
    if (result.kind !== 'saved') throw new Error('Сервер не подтвердил удаление фото.');
    await refresh(result.revision);
  }
  const cover = saved.photos.find((photo) => photo.kind === 'cover');
  const gallery = saved.photos.filter((photo) => photo.kind === 'gallery');
  return (
    <section className="panel recipe-section" aria-labelledby="recipe-photos-title">
      <h2 id="recipe-photos-title">Фотографии</h2>
      {!ready && <p className="muted">Добавление фото доступно после сохранения текущих правок.</p>}
      <h3>Обложка</h3>
      <div className="recipe-photo-grid">
        {cover && (
          <PhotoCard
            photo={cover}
            recipeId={recipeId}
            disabled={!ready}
            onDelete={() => remove(cover)}
            confirmDelete={confirmDelete}
          />
        )}
      </div>
      <PhotoPicker
        label={cover ? 'Заменить обложку' : 'Добавить обложку'}
        disabled={!ready}
        onPick={(file) => add(file, { kind: 'cover', position: 0 })}
      />
      <h3>Галерея</h3>
      <div className="recipe-photo-grid">
        {gallery.map((photo) => (
          <PhotoCard
            key={photo.id}
            photo={photo}
            recipeId={recipeId}
            disabled={!ready}
            onDelete={() => remove(photo)}
            confirmDelete={confirmDelete}
          />
        ))}
      </div>
      <PhotoPicker
        label="Добавить в галерею"
        disabled={!ready || gallery.length >= 20}
        onPick={(file) => add(file, { kind: 'gallery', position: gallery.length })}
      />
      <h3>Фотографии шагов</h3>
      {saved.steps.map((step, index) => {
        const photos = saved.photos.filter(
          (photo) => photo.kind === 'step' && photo.stepId === step.id,
        );
        return (
          <div className="recipe-step-photos" key={step.id}>
            <h4>Шаг {index + 1}</h4>
            <div className="recipe-photo-grid">
              {photos.map((photo) => (
                <PhotoCard
                  key={photo.id}
                  photo={photo}
                  recipeId={recipeId}
                  disabled={!ready}
                  onDelete={() => remove(photo)}
                  confirmDelete={confirmDelete}
                />
              ))}
            </div>
            <PhotoPicker
              label="Добавить фото шага"
              disabled={!ready || photos.length >= 5}
              onPick={(file) =>
                add(file, { kind: 'step', stepId: step.id, position: photos.length })
              }
            />
          </div>
        );
      })}
      {saved.steps.length === 0 && <p className="muted">Сначала добавьте и сохраните шаг.</p>}
      <p className="muted text-sm">JPEG, PNG или WebP · исходный файл до 20 МБ.</p>
    </section>
  );
}
