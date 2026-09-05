import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { requestSessionStickers, acquireStickerImage } from '@/entities/session';
import { prepareSticker } from '@/shared/api';
import { STICKER_LIMITS } from '../model/stickers';
import type { RecipeSticker, StickerItem, StickerPackView } from '../model/stickers';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function StickerImage({
  item,
  recipeId,
  instanceId,
  className,
  style,
}: {
  item: Pick<StickerItem, 'id' | 'name' | 'assetKey' | 'digest'>;
  recipeId?: string;
  instanceId?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const [source, setSource] = useState('');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const lease = acquireStickerImage(
      { id: item.id, assetKey: item.assetKey, digest: item.digest },
      recipeId && instanceId ? { recipeId, id: instanceId } : undefined,
    );
    void lease.promise
      .then((value) => {
        if (!cancelled) {
          setSource(value);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      lease.release();
    };
  }, [instanceId, item.assetKey, item.digest, item.id, recipeId, attempt]);
  if (failed)
    return (
      <button
        type="button"
        onClick={() => {
          setFailed(false);
          setSource('');
          setAttempt((value) => value + 1);
        }}
      >
        Повторить: {item.name}
      </button>
    );
  return source ? (
    <img className={className} style={style} src={source} alt={item.name} draggable={false} />
  ) : (
    <span className={className} style={style} aria-label={item.name} role="img">
      ✨
    </span>
  );
}

function safeName(file: File) {
  return (
    file.name
      .replace(/\.(?:png|webp)$/i, '')
      .replace(/[_-]+/g, ' ')
      .trim()
      .slice(0, 100) || 'Новый стикер'
  );
}

export function StickerPacks({
  documentPages,
  recipeId,
  recipeRevision,
  editable,
  onPlacementsChange,
}: {
  documentPages: readonly string[];
  recipeId: string;
  recipeRevision: number;
  editable: boolean;
  onPlacementsChange: () => void;
}) {
  const [packs, setPacks] = useState<StickerPackView[]>([]);
  const [placements, setPlacements] = useState<RecipeSticker[]>([]);
  const [selectedPackId, setSelectedPackId] = useState('');
  const [selectedInstanceId, setSelectedInstanceId] = useState('');
  const [targetPageId, setTargetPageId] = useState('page-1');
  const [query, setQuery] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [createName, setCreateName] = useState('Мои стикеры');
  const [createEmoji, setCreateEmoji] = useState('✨');
  const [createVisibility, setCreateVisibility] = useState<'private' | 'workspace'>('private');
  const [uploadEmoji, setUploadEmoji] = useState('✨');
  const pending = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError('');
    try {
      const [catalog, placed] = await Promise.all([
        requestSessionStickers(
          { action: 'stickers.packs.list', payload: { query, includeArchived } },
          crypto.randomUUID(),
          controller.signal,
        ),
        requestSessionStickers(
          { action: 'recipes.stickers.list', payload: { recipeId } },
          crypto.randomUUID(),
          controller.signal,
        ),
      ]);
      if (catalog.kind === 'stickerPacks') {
        setPacks(catalog.packs);
        setSelectedPackId((current) =>
          catalog.packs.some((item) => item.pack.id === current)
            ? current
            : (catalog.packs[0]?.pack.id ?? ''),
        );
      }
      if (placed.kind === 'recipeStickers') setPlacements(placed.stickers);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Не удалось открыть стикеры.');
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setLoading(false);
      }
    }
  }, [includeArchived, query, recipeId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 200);
    return () => {
      window.clearTimeout(timer);
      pending.current?.abort();
    };
  }, [load]);

  const selectedPack = packs.find((item) => item.pack.id === selectedPackId) ?? null;
  const selectedPlacement =
    placements.find((item) => item.id === selectedInstanceId) ?? placements[0] ?? null;

  async function act(run: () => Promise<void>, success: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await run();
      setMessage(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Изменение стикеров не подтверждено.');
    } finally {
      setBusy(false);
    }
  }

  async function createPack() {
    const result = await requestSessionStickers(
      {
        action: 'stickers.packs.create',
        payload: { name: createName, emoji: createEmoji, visibility: createVisibility },
      },
      crypto.randomUUID(),
    );
    if (result.kind !== 'stickerPack') throw new Error('Сервер не подтвердил создание пака.');
    await load();
    setSelectedPackId(result.pack.id);
  }

  async function updatePack(action: 'update' | 'archive' | 'restore') {
    if (!selectedPack) return;
    const requestId = crypto.randomUUID();
    const command =
      action === 'update'
        ? {
            action: 'stickers.packs.update' as const,
            payload: {
              packId: selectedPack.pack.id,
              expectedRevision: selectedPack.pack.revision,
              name: selectedPack.pack.name,
              emoji: selectedPack.pack.emoji,
              visibility: selectedPack.pack.visibility,
            },
          }
        : {
            action: `stickers.packs.${action}` as
              'stickers.packs.archive' | 'stickers.packs.restore',
            payload: {
              packId: selectedPack.pack.id,
              expectedRevision: selectedPack.pack.revision,
            },
          };
    await requestSessionStickers(command, requestId);
    await load();
  }

  async function upload(files: FileList | null) {
    if (!selectedPack || !files?.length) return;
    if (selectedPack.stickers.length + files.length > STICKER_LIMITS.stickersPerPack)
      throw new Error('В одном паке может быть не больше 100 стикеров.');
    let current = selectedPack;
    let completed = 0;
    for (const file of Array.from(files)) {
      setMessage(`Подготавливаем ${completed + 1} из ${files.length}…`);
      const prepared = await prepareSticker(file);
      const requestId = crypto.randomUUID();
      const result = await requestSessionStickers(
        {
          action: 'stickers.items.add',
          payload: {
            packId: current.pack.id,
            expectedRevision: current.pack.revision,
            name: safeName(file),
            emoji: uploadEmoji,
            position: current.stickers.length,
            upload: { uploadId: requestId, ...prepared },
          },
        },
        requestId,
      );
      if (result.kind !== 'stickerPack') throw new Error('Сервер не подтвердил загрузку.');
      current = result;
      completed++;
    }
    await load();
    setMessage(`Добавлено стикеров: ${completed}.`);
  }

  async function reorder(stickerId: string, direction: -1 | 1) {
    if (!selectedPack) return;
    const ids = selectedPack.stickers.map((item) => item.id);
    const index = ids.indexOf(stickerId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target] as string, ids[index] as string];
    await requestSessionStickers(
      {
        action: 'stickers.items.reorder',
        payload: {
          packId: selectedPack.pack.id,
          expectedRevision: selectedPack.pack.revision,
          stickerIds: ids,
        },
      },
      crypto.randomUUID(),
    );
    await load();
  }

  async function archiveSticker(stickerId: string) {
    if (!selectedPack) return;
    await requestSessionStickers(
      {
        action: 'stickers.items.archive',
        payload: {
          packId: selectedPack.pack.id,
          stickerId,
          expectedRevision: selectedPack.pack.revision,
        },
      },
      crypto.randomUUID(),
    );
    await load();
  }

  async function insert(item: StickerItem) {
    if (!documentPages.includes(targetPageId))
      throw new Error('Выберите существующую страницу рецепта.');
    const requestId = crypto.randomUUID();
    const offset = placements.length % 6;
    const result = await requestSessionStickers(
      {
        action: 'recipes.stickers.add',
        payload: {
          recipeId,
          expectedRecipeRevision: recipeRevision,
          stickerId: item.id,
          page: Number(targetPageId.slice(5)),
          pageId: targetPageId,
          x: 8 + offset * 12,
          y: 8 + offset * 10,
          width: 18,
          height: 18,
          rotation: 0,
          zIndex: Math.max(-1, ...placements.map((entry) => entry.zIndex)) + 1,
        },
      },
      requestId,
    );
    if (result.kind !== 'recipeSticker') throw new Error('Стикер не вставлен.');
    setPlacements([...placements, result.sticker]);
    setSelectedInstanceId(result.sticker.id);
    onPlacementsChange();
  }

  async function changePlacement(next: RecipeSticker | 'delete') {
    if (!selectedPlacement) return;
    const result = await requestSessionStickers(
      next === 'delete'
        ? {
            action: 'recipes.stickers.delete',
            payload: {
              recipeId,
              instanceId: selectedPlacement.id,
              expectedRevision: selectedPlacement.revision,
            },
          }
        : {
            action: 'recipes.stickers.update',
            payload: {
              recipeId,
              instanceId: selectedPlacement.id,
              expectedRevision: selectedPlacement.revision,
              page: next.page,
              pageId: `page-${next.page}`,
              x: next.x,
              y: next.y,
              width: next.width,
              height: next.height,
              rotation: next.rotation,
              zIndex: next.zIndex,
            },
          },
      crypto.randomUUID(),
    );
    if (result.kind !== 'recipeSticker') throw new Error('Размещение не изменено.');
    setPlacements(
      result.sticker.status === 'deleted'
        ? placements.filter((item) => item.id !== result.sticker.id)
        : placements.map((item) => (item.id === result.sticker.id ? result.sticker : item)),
    );
    onPlacementsChange();
  }

  return (
    <section className="panel recipe-section sticker-packs" aria-labelledby="sticker-packs-title">
      <div className="sticker-heading">
        <div>
          <p className="eyebrow">Оформление страницы</p>
          <h2 id="sticker-packs-title">Стикер-паки</h2>
          <p className="muted">
            Выбирайте готовые иллюстрации или собирайте собственные наборы из PNG и WebP.
          </p>
          <div className="sticker-feature-badges" aria-label="Возможности стикер-паков">
            <span>2 базовых пака</span>
            <span>Личные и общие</span>
            <span>Свои изображения</span>
          </div>
        </div>
        <button
          className="button button-secondary"
          type="button"
          disabled={busy}
          onClick={() => void load()}
        >
          Обновить
        </button>
      </div>
      {message && (
        <p className="sticker-notice sticker-notice-success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="sticker-notice sticker-notice-error" role="alert">
          {error}
        </p>
      )}

      <div className="sticker-layout">
        <div className="sticker-catalog">
          <div className="sticker-search-row">
            <label>
              Поиск
              <input
                value={query}
                maxLength={100}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Варенье, травы, ✨"
              />
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(event) => setIncludeArchived(event.target.checked)}
              />
              Архивные паки
            </label>
          </div>

          {editable && (
            <details className="sticker-create">
              <summary>Создать свой пак</summary>
              <div className="sticker-create-fields">
                <label>
                  Название пака
                  <input
                    value={createName}
                    maxLength={100}
                    onChange={(event) => setCreateName(event.target.value)}
                  />
                </label>
                <label>
                  Эмодзи
                  <input
                    value={createEmoji}
                    maxLength={16}
                    onChange={(event) => setCreateEmoji(event.target.value)}
                  />
                </label>
                <label>
                  Видимость
                  <select
                    value={createVisibility}
                    onChange={(event) =>
                      setCreateVisibility(
                        event.target.value === 'workspace' ? 'workspace' : 'private',
                      )
                    }
                  >
                    <option value="private">Личный</option>
                    <option value="workspace">Общий</option>
                  </select>
                </label>
                <button
                  className="button button-primary"
                  type="button"
                  disabled={busy || !createName.trim()}
                  onClick={() => void act(createPack, 'Пак создан.')}
                >
                  Создать пак
                </button>
              </div>
            </details>
          )}

          <div className="sticker-pack-tabs" role="tablist" aria-label="Паки стикеров">
            {packs.map((view) => (
              <button
                key={view.pack.id}
                type="button"
                role="tab"
                aria-selected={view.pack.id === selectedPackId}
                className={view.pack.id === selectedPackId ? 'active' : ''}
                onClick={() => setSelectedPackId(view.pack.id)}
              >
                <span className="sticker-pack-tab-icon" aria-hidden="true">
                  {view.pack.emoji}
                </span>
                <span>{view.pack.name}</span>
                <small>{view.stickers.length}</small>
                {view.pack.status === 'archived' && <em>архив</em>}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="sticker-empty" role="status">
              <span aria-hidden="true">✦</span>
              <p>Открываем стикер-паки…</p>
            </div>
          ) : selectedPack ? (
            <div className="sticker-pack-panel">
              <div className="sticker-pack-meta">
                <div>
                  <strong>
                    {selectedPack.pack.emoji} {selectedPack.pack.name}
                  </strong>
                  <p className="muted text-sm">
                    {selectedPack.pack.kind === 'builtin'
                      ? 'Встроенный пак'
                      : selectedPack.pack.visibility === 'private'
                        ? 'Личный пак'
                        : 'Общий пак'}{' '}
                    · {selectedPack.stickers.length} шт.
                  </p>
                </div>
                {selectedPack.canManage && (
                  <div className="recipe-row-actions">
                    <button
                      className="text-button"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () =>
                            updatePack(
                              selectedPack.pack.status === 'active' ? 'archive' : 'restore',
                            ),
                          selectedPack.pack.status === 'active'
                            ? 'Пак перенесён в архив.'
                            : 'Пак восстановлен.',
                        )
                      }
                    >
                      {selectedPack.pack.status === 'active'
                        ? 'Архивировать пак'
                        : 'Восстановить пак'}
                    </button>
                  </div>
                )}
              </div>
              {selectedPack.canManage && (
                <div className="sticker-create-fields sticker-pack-edit">
                  <label>
                    Название пака
                    <input
                      value={selectedPack.pack.name}
                      maxLength={100}
                      disabled={busy}
                      onChange={(event) =>
                        setPacks((current) =>
                          current.map((view) =>
                            view.pack.id === selectedPack.pack.id
                              ? { ...view, pack: { ...view.pack, name: event.target.value } }
                              : view,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Эмодзи
                    <input
                      value={selectedPack.pack.emoji}
                      maxLength={16}
                      disabled={busy}
                      onChange={(event) =>
                        setPacks((current) =>
                          current.map((view) =>
                            view.pack.id === selectedPack.pack.id
                              ? { ...view, pack: { ...view.pack, emoji: event.target.value } }
                              : view,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Видимость
                    <select
                      value={selectedPack.pack.visibility}
                      disabled={busy}
                      onChange={(event) =>
                        setPacks((current) =>
                          current.map((view) =>
                            view.pack.id === selectedPack.pack.id
                              ? {
                                  ...view,
                                  pack: {
                                    ...view.pack,
                                    visibility:
                                      event.target.value === 'workspace' ? 'workspace' : 'private',
                                  },
                                }
                              : view,
                          ),
                        )
                      }
                    >
                      <option value="private">Личный</option>
                      <option value="workspace">Общий</option>
                    </select>
                  </label>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={busy || !selectedPack.pack.name.trim()}
                    onClick={() =>
                      void act(() => updatePack('update'), 'Настройки пака сохранены.')
                    }
                  >
                    Сохранить настройки
                  </button>
                </div>
              )}
              {selectedPack.canManage && selectedPack.pack.status === 'active' && (
                <div className="sticker-upload-row">
                  <label>
                    Эмодзи
                    <input
                      value={uploadEmoji}
                      maxLength={16}
                      onChange={(event) => setUploadEmoji(event.target.value)}
                    />
                  </label>
                  <label className="button button-secondary sticker-file-button">
                    Добавить PNG/WebP
                    <input
                      type="file"
                      accept="image/png,image/webp"
                      multiple
                      disabled={busy}
                      onChange={(event) => {
                        const files = event.currentTarget.files;
                        void act(() => upload(files), 'Стикеры добавлены.');
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>
                </div>
              )}
              <div className="sticker-grid">
                {selectedPack.stickers.map((item, index) => (
                  <article key={item.id} className="sticker-card">
                    <StickerImage item={item} className="sticker-thumb" />
                    <strong>
                      {item.emoji} {item.name}
                    </strong>
                    <button
                      className="button button-primary"
                      type="button"
                      disabled={!editable || busy}
                      onClick={() => void act(() => insert(item), 'Стикер добавлен на страницу.')}
                    >
                      На страницу
                    </button>
                    {selectedPack.canManage && (
                      <div className="sticker-order-actions" aria-label={`Порядок: ${item.name}`}>
                        <button
                          type="button"
                          disabled={busy || index === 0}
                          onClick={() => void act(() => reorder(item.id, -1), 'Порядок сохранён.')}
                          aria-label="Выше"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={busy || index === selectedPack.stickers.length - 1}
                          onClick={() => void act(() => reorder(item.id, 1), 'Порядок сохранён.')}
                          aria-label="Ниже"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void act(() => archiveSticker(item.id), 'Стикер убран из пака.')
                          }
                        >
                          Убрать
                        </button>
                      </div>
                    )}
                  </article>
                ))}
                {selectedPack.stickers.length === 0 && (
                  <div className="sticker-empty sticker-grid-empty">
                    <span aria-hidden="true">✦</span>
                    <strong>В этом паке пока пусто</strong>
                    <p className="muted text-sm">
                      Добавьте PNG или WebP, чтобы собрать собственный набор.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="sticker-empty">
              <span aria-hidden="true">⌕</span>
              <strong>Паки не найдены</strong>
              <p className="muted text-sm">Измените запрос или включите архивные паки.</p>
            </div>
          )}
        </div>

        <div className="sticker-page-column">
          <h3>Страница рецепта</h3>
          <p className="muted">
            Стикеры показаны поверх рецепта в предпросмотре выше. Координаты — проценты полного
            листа A4.
          </p>
          <label>
            Страница для нового стикера
            <select
              value={targetPageId}
              disabled={!editable || busy || !documentPages.length}
              onChange={(event) => setTargetPageId(event.target.value)}
            >
              {!documentPages.includes(targetPageId) && (
                <option value={targetPageId}>Страница недоступна</option>
              )}
              {documentPages
                .filter((id) => Number(id.slice(5)) <= 100)
                .map((id) => (
                  <option key={id} value={id}>
                    Страница {id.slice(5)}
                  </option>
                ))}
            </select>
          </label>
          <div className="sticker-placement-list" aria-label="Размещённые стикеры">
            {!placements.length && <p>Выберите стикер и нажмите «На страницу».</p>}
            {placements.map((placement) => (
              <button
                key={placement.id}
                type="button"
                aria-label={`Выбрать стикер ${placement.name}`}
                aria-pressed={placement.id === selectedPlacement?.id}
                onClick={() => setSelectedInstanceId(placement.id)}
              >
                {placement.emoji} {placement.name} · лист {placement.page}
                {!documentPages.includes(`page-${placement.page}`) && ' · страница недоступна'}
              </button>
            ))}
          </div>
          {editable && selectedPlacement && (
            <div className="sticker-placement-controls">
              <label>
                Разместить на странице
                <select
                  aria-label="Страница выбранного стикера"
                  value={`page-${selectedPlacement.page}`}
                  disabled={busy}
                  onChange={(event) =>
                    void act(
                      () =>
                        changePlacement({
                          ...selectedPlacement,
                          page: Number(event.target.value.slice(5)),
                        }),
                      'Привязка к странице сохранена.',
                    )
                  }
                >
                  {!documentPages.includes(`page-${selectedPlacement.page}`) && (
                    <option value={`page-${selectedPlacement.page}`}>
                      Исходная страница отсутствует
                    </option>
                  )}
                  {documentPages
                    .filter((id) => Number(id.slice(5)) <= 100)
                    .map((id) => (
                      <option key={id} value={id}>
                        Страница {id.slice(5)}
                      </option>
                    ))}
                </select>
              </label>
              <strong>
                {selectedPlacement.emoji} {selectedPlacement.name}
              </strong>
              <div className="sticker-control-grid">
                <button
                  type="button"
                  aria-label="Переместить влево"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        changePlacement({
                          ...selectedPlacement,
                          x: clamp(selectedPlacement.x - 2, 0, 100 - selectedPlacement.width),
                        }),
                      'Положение сохранено.',
                    )
                  }
                >
                  ←
                </button>
                <button
                  type="button"
                  aria-label="Переместить вверх"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        changePlacement({
                          ...selectedPlacement,
                          y: clamp(selectedPlacement.y - 2, 0, 100 - selectedPlacement.height),
                        }),
                      'Положение сохранено.',
                    )
                  }
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="Переместить вниз"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        changePlacement({
                          ...selectedPlacement,
                          y: clamp(selectedPlacement.y + 2, 0, 100 - selectedPlacement.height),
                        }),
                      'Положение сохранено.',
                    )
                  }
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label="Переместить вправо"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        changePlacement({
                          ...selectedPlacement,
                          x: clamp(selectedPlacement.x + 2, 0, 100 - selectedPlacement.width),
                        }),
                      'Положение сохранено.',
                    )
                  }
                >
                  →
                </button>
                <button
                  type="button"
                  aria-label="Уменьшить"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        changePlacement({
                          ...selectedPlacement,
                          width: clamp(selectedPlacement.width - 2, 4, 60),
                          height: clamp(selectedPlacement.height - 2, 4, 60),
                        }),
                      'Размер сохранён.',
                    )
                  }
                >
                  −
                </button>
                <button
                  type="button"
                  aria-label="Увеличить"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        changePlacement({
                          ...selectedPlacement,
                          width: clamp(selectedPlacement.width + 2, 4, 60),
                          height: clamp(selectedPlacement.height + 2, 4, 60),
                        }),
                      'Размер сохранён.',
                    )
                  }
                >
                  ＋
                </button>
                <button
                  type="button"
                  aria-label="Повернуть против часовой стрелки"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        changePlacement({
                          ...selectedPlacement,
                          rotation:
                            selectedPlacement.rotation <= -180
                              ? 165
                              : selectedPlacement.rotation - 15,
                        }),
                      'Поворот сохранён.',
                    )
                  }
                >
                  ↶
                </button>
                <button
                  type="button"
                  aria-label="Повернуть по часовой стрелке"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        changePlacement({
                          ...selectedPlacement,
                          rotation:
                            selectedPlacement.rotation >= 180
                              ? -165
                              : selectedPlacement.rotation + 15,
                        }),
                      'Поворот сохранён.',
                    )
                  }
                >
                  ↷
                </button>
                <button
                  type="button"
                  aria-label="Переместить на слой ниже"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        changePlacement({
                          ...selectedPlacement,
                          zIndex: clamp(selectedPlacement.zIndex - 1, 0, 10000),
                        }),
                      'Слой сохранён.',
                    )
                  }
                >
                  Слой −
                </button>
                <button
                  type="button"
                  aria-label="Переместить на слой выше"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        changePlacement({
                          ...selectedPlacement,
                          zIndex: clamp(selectedPlacement.zIndex + 1, 0, 10000),
                        }),
                      'Слой сохранён.',
                    )
                  }
                >
                  Слой +
                </button>
              </div>
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={() =>
                  void act(() => changePlacement('delete'), 'Стикер удалён со страницы.')
                }
              >
                Удалить со страницы
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
