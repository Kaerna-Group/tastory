import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, PointerEvent } from 'react';
import { ApiClientError } from '@/shared/api';
import { env } from '@/shared/config';
import { requestSessionStickers } from '@/entities/session';
import type {
  RecipePageBinding,
  RecipePageDocument,
  RecipePageLayoutStatus,
} from '@/entities/recipe-page';
import type { RecipeDraftValue, RecipePhoto, Tag } from '../model/drafts';
import type { RecipeSticker } from '../model/stickers';
import {
  EMPTY_COMPOSITION_HISTORY,
  compositionGeometryEqual,
  constrainCompositionGeometry,
  moveCompositionGeometry,
  recordCompositionCommand,
  redoCompositionCommand,
  resizeCompositionGeometry,
  undoCompositionCommand,
} from '../model/composition-commands';
import type {
  CompositionCommand,
  CompositionGeometry,
  CompositionHistory,
  CompositionKind,
} from '../model/composition-commands';
import {
  StickerPlacementRequests,
  stickerPlacementScope,
} from '../model/sticker-placement-requests';
import { recipeDesignValueSchema } from '../model/templates';
import type {
  RecipeDesign,
  RecipeDesignElement,
  RecipeDesignValue,
  RecipeTemplateLayout,
  RecipeTheme,
} from '../model/templates';
import { RecipePagePreview } from './recipe-page-preview';

const BINDING_LABELS: Record<RecipePageBinding, string> = {
  cover: 'Обложка',
  title: 'Название',
  description: 'Описание',
  meta: 'Метаданные',
  ingredients: 'Ингредиенты',
  steps: 'Шаги',
  notes: 'Заметки',
  source: 'Источник',
  tags: 'Теги',
  photos: 'Фотография',
};
const FIXED_BINDINGS = new Set<RecipePageBinding>(['source', 'tags']);

type Selection = Readonly<{
  key: string;
  kind: CompositionKind;
  pageId: string;
}>;
type Drag = Readonly<{
  pointerId: number;
  selection: Selection;
  before: CompositionGeometry;
  width: number;
  height: number;
  startX: number;
  startY: number;
  designId: string;
}>;
type DraftRecord = Readonly<{ version: 1; value: RecipeDesignValue }>;

const jsonEqual = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const pageNumber = (pageId: string) => Number(pageId.slice(5));
const draftKey = (endpoint: string, subject: string, recipeId: string) =>
  `tastory.composition-draft.v1:${JSON.stringify([endpoint || 'mock', subject, recipeId])}`;

function readDraft(key: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? 'null') as DraftRecord | null;
    if (parsed?.version !== 1) return null;
    const value = recipeDesignValueSchema.safeParse(parsed.value);
    return value.success ? value.data : null;
  } catch {
    return null;
  }
}

function errorText(cause: unknown) {
  return cause instanceof Error ? cause.message : 'Не удалось сохранить композицию.';
}

function geometryFromElement(pageId: string, element: RecipeDesignElement): CompositionGeometry {
  return {
    pageId,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    rotation: element.rotation,
    zIndex: element.zIndex,
    locked: element.locked,
  };
}

function geometryFromSticker(sticker: RecipeSticker): CompositionGeometry {
  return {
    pageId: sticker.pageId ?? `page-${sticker.page}`,
    x: sticker.x,
    y: sticker.y,
    width: sticker.width,
    height: sticker.height,
    rotation: sticker.rotation,
    zIndex: sticker.zIndex,
    locked: false,
  };
}

function designElement(
  source: RecipeDesignElement | undefined,
  fallback: {
    binding: RecipePageBinding;
    region: RecipeDesignElement['region'];
    id?: string;
  },
  geometry: CompositionGeometry,
): RecipeDesignElement {
  return {
    id: source?.id ?? fallback.id ?? crypto.randomUUID(),
    binding: fallback.binding,
    region: source?.region ?? fallback.region,
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
    rotation: 0,
    zIndex: Math.min(100, geometry.zIndex),
    locked: geometry.locked,
  };
}

export function RecipeCompositionEditor({
  subject,
  recipeId,
  recipeRevision,
  value,
  tags,
  coverPhoto,
  photos,
  templateId,
  templateRevision,
  templateName,
  layout,
  theme,
  designValue,
  editable,
  assetRefreshKey,
  onDocumentPagesChange,
  onSaveDesign,
  onReloadDesign,
  onStickerSaved,
}: {
  subject: string;
  recipeId: string;
  recipeRevision: number;
  value: RecipeDraftValue;
  tags: readonly Tag[];
  coverPhoto: RecipePhoto | null;
  photos: readonly RecipePhoto[];
  templateId: string | null;
  templateRevision: number;
  templateName: string;
  layout: RecipeTemplateLayout;
  theme: RecipeTheme;
  designValue: RecipeDesignValue;
  editable: boolean;
  assetRefreshKey: number;
  onDocumentPagesChange: (pages: readonly string[]) => void;
  onSaveDesign: (value: RecipeDesignValue) => Promise<RecipeDesign>;
  onReloadDesign: () => Promise<RecipeDesign | null>;
  onStickerSaved: () => void;
}) {
  const storageKey = useMemo(
    () => draftKey(env.apiUrl || 'mock', subject, recipeId),
    [recipeId, subject],
  );
  const placementRequests = useMemo(
    () =>
      new StickerPlacementRequests(
        localStorage,
        stickerPlacementScope(env.apiUrl || 'mock', subject),
        requestSessionStickers,
      ),
    [subject],
  );
  const [working, setWorking] = useState(() => readDraft(storageKey) ?? designValue);
  const workingRef = useRef(working);
  const [document, setDocument] = useState<RecipePageDocument | null>(null);
  const [stickers, setStickers] = useState<RecipeSticker[]>([]);
  const stickersRef = useRef(stickers);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [history, setHistory] = useState<CompositionHistory>(EMPTY_COMPOSITION_HISTORY);
  const historyRef = useRef(history);
  const [transient, setTransient] = useState<{
    selection: Selection;
    geometry: CompositionGeometry;
    designId: string;
  } | null>(null);
  const [candidateDesign, setCandidateDesign] = useState<RecipeDesignValue | null>(null);
  const validation = useRef<{
    phase: 'candidate' | 'restore';
    sawMeasuring: boolean;
    finish: (valid: boolean) => void;
    timeout: number;
  } | null>(null);
  const drag = useRef<Drag | null>(null);
  const [zoom, setZoom] = useState(72);
  const [guides, setGuides] = useState(true);
  const [guideAxis, setGuideAxis] = useState({ x: false, y: false });
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(() => Boolean(readDraft(storageKey)));
  const [error, setError] = useState('');
  const [failedKind, setFailedKind] = useState<'design' | 'sticker' | null>(null);
  const [conflict, setConflict] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [layoutStatus, setLayoutStatus] = useState<RecipePageLayoutStatus>('measuring');
  const canvas = useRef<HTMLDivElement>(null);

  const updateWorking = useCallback(
    (next: RecipeDesignValue, keepDraft: boolean) => {
      workingRef.current = next;
      setWorking(next);
      setDirty(keepDraft);
      if (keepDraft) localStorage.setItem(storageKey, JSON.stringify({ version: 1, value: next }));
      else localStorage.removeItem(storageKey);
    },
    [storageKey],
  );
  const updateStickers = useCallback((next: RecipeSticker[]) => {
    stickersRef.current = next;
    setStickers(next);
  }, []);
  const updateHistory = useCallback((next: CompositionHistory) => {
    historyRef.current = next;
    setHistory(next);
  }, []);

  useEffect(() => {
    if (!dirty && !saving && !jsonEqual(workingRef.current, designValue))
      updateWorking(designValue, false);
  }, [designValue, dirty, saving, updateWorking]);
  useEffect(
    () => () => {
      if (validation.current) window.clearTimeout(validation.current.timeout);
    },
    [],
  );

  const previewElements = useMemo(() => {
    if (candidateDesign) return candidateDesign.elements;
    if (transient?.selection.kind !== 'content') return working.elements;
    const binding = transient.selection.key.slice(8) as RecipePageBinding;
    const source = working.elements.find((item) => item.binding === binding);
    const pageElement = document?.pages
      .find((page) => page.id === transient.selection.pageId)
      ?.elements.find((item) => item.binding === binding);
    if (!pageElement) return working.elements;
    const next = designElement(
      source,
      { binding, region: pageElement.region, id: transient.designId },
      transient.geometry,
    );
    return [...working.elements.filter((item) => item.binding !== binding), next];
  }, [candidateDesign, document, transient, working.elements]);
  const previewStickers = useMemo(() => {
    if (transient?.selection.kind !== 'decor') return stickers;
    const id = transient.selection.key.slice(8);
    return stickers.map((item) =>
      item.id === id
        ? {
            ...item,
            page: pageNumber(transient.geometry.pageId),
            pageId: transient.geometry.pageId,
            x: transient.geometry.x,
            y: transient.geometry.y,
            width: transient.geometry.width,
            height: transient.geometry.height,
            rotation: transient.geometry.rotation,
            zIndex: transient.geometry.zIndex,
          }
        : item,
    );
  }, [stickers, transient]);

  const selectedData = useMemo(() => {
    if (!selection || !document) return null;
    if (selection.kind === 'decor') {
      const item = stickers.find((sticker) => `sticker:${sticker.id}` === selection.key);
      return item ? { geometry: geometryFromSticker(item), label: item.name, fixed: false } : null;
    }
    const binding = selection.key.slice(8) as RecipePageBinding;
    const pageElement = document.pages
      .find((page) => page.id === selection.pageId)
      ?.elements.find((item) => item.binding === binding);
    if (!pageElement) return null;
    const authored = working.elements.find((item) => item.binding === binding);
    return {
      geometry: authored
        ? geometryFromElement(selection.pageId, authored)
        : {
            pageId: selection.pageId,
            x: pageElement.x,
            y: pageElement.y,
            width: pageElement.width,
            height: pageElement.height,
            rotation: 0,
            zIndex: pageElement.zIndex,
            locked: false,
          },
      label: BINDING_LABELS[binding],
      fixed: FIXED_BINDINGS.has(binding),
    };
  }, [document, selection, stickers, working.elements]);

  const persistDesign = useCallback(
    async (next: RecipeDesignValue) => {
      setSaving(true);
      setError('');
      setFailedKind(null);
      setConflict(false);
      try {
        const saved = await onSaveDesign(next);
        if (jsonEqual(workingRef.current, next)) updateWorking(saved.value, false);
      } catch (cause) {
        setError(errorText(cause));
        setFailedKind('design');
        setConflict(cause instanceof ApiClientError && cause.code === 'TEMPLATE_CONFLICT');
        if (cause instanceof ApiClientError && cause.code === 'ACCESS_DENIED') setReadOnly(true);
      } finally {
        setSaving(false);
      }
    },
    [onSaveDesign, updateWorking],
  );

  const persistSticker = useCallback(
    async (source: RecipeSticker, geometry: CompositionGeometry) => {
      setSaving(true);
      setError('');
      setFailedKind(null);
      setConflict(false);
      const command = {
        action: 'recipes.stickers.update' as const,
        payload: {
          recipeId,
          instanceId: source.id,
          expectedRevision: source.revision,
          page: pageNumber(geometry.pageId),
          pageId: geometry.pageId,
          x: geometry.x,
          y: geometry.y,
          width: geometry.width,
          height: geometry.height,
          rotation: geometry.rotation,
          zIndex: geometry.zIndex,
        },
      };
      try {
        const result = await placementRequests.execute(command);
        if (result.kind !== 'recipeSticker') throw new Error('Сервер не подтвердил размещение.');
        updateStickers(
          stickersRef.current.map((item) =>
            item.id === result.sticker.id ? result.sticker : item,
          ),
        );
        onStickerSaved();
      } catch (cause) {
        setError(errorText(cause));
        setFailedKind('sticker');
        setConflict(cause instanceof ApiClientError && cause.code === 'STICKER_CONFLICT');
        if (cause instanceof ApiClientError && cause.code === 'ACCESS_DENIED') setReadOnly(true);
      } finally {
        setSaving(false);
      }
    },
    [onStickerSaved, placementRequests, recipeId, updateStickers],
  );

  const applyCommand = useCallback(
    (command: CompositionCommand, record = true) => {
      const next = constrainCompositionGeometry(command.after, command.kind);
      if (command.kind === 'content') {
        const binding = command.target.slice(8) as RecipePageBinding;
        const source = workingRef.current.elements.find((item) => item.binding === binding);
        const pageElement = document?.pages
          .find((page) => page.id === next.pageId)
          ?.elements.find((item) => item.binding === binding);
        if (!pageElement || FIXED_BINDINGS.has(binding)) return;
        const element = designElement(source, { binding, region: pageElement.region }, next);
        const value = {
          ...workingRef.current,
          elements: [
            ...workingRef.current.elements.filter((item) => item.binding !== binding),
            element,
          ],
        };
        updateWorking(value, true);
        if (record) updateHistory(recordCompositionCommand(historyRef.current, command));
        void persistDesign(value);
      } else {
        const id = command.target.slice(8);
        const source = stickersRef.current.find((item) => item.id === id);
        if (!source) return;
        updateStickers(
          stickersRef.current.map((item) =>
            item.id === id
              ? {
                  ...item,
                  page: pageNumber(next.pageId),
                  pageId: next.pageId,
                  x: next.x,
                  y: next.y,
                  width: next.width,
                  height: next.height,
                  rotation: next.rotation,
                  zIndex: next.zIndex,
                }
              : item,
          ),
        );
        if (record) updateHistory(recordCompositionCommand(historyRef.current, command));
        void persistSticker(source, next);
      }
    },
    [document, persistDesign, persistSticker, updateHistory, updateStickers, updateWorking],
  );

  const commitGeometry = useCallback(
    (target: Selection, before: CompositionGeometry, after: CompositionGeometry) => {
      const constrained = constrainCompositionGeometry(after, target.kind);
      if (compositionGeometryEqual(before, constrained)) return;
      applyCommand({ target: target.key, kind: target.kind, before, after: constrained });
    },
    [applyCommand],
  );

  const validateContentSize = useCallback(
    (target: Selection, geometry: CompositionGeometry) => {
      const binding = target.key.slice(8) as RecipePageBinding;
      const source = workingRef.current.elements.find((item) => item.binding === binding);
      const pageElement = document?.pages
        .find((page) => page.id === geometry.pageId)
        ?.elements.find((item) => item.binding === binding);
      if (!pageElement) return Promise.resolve(false);
      const nextElement = designElement(source, { binding, region: pageElement.region }, geometry);
      const value = {
        ...workingRef.current,
        elements: [
          ...workingRef.current.elements.filter((item) => item.binding !== binding),
          nextElement,
        ],
      };
      setCandidateDesign(value);
      return new Promise<boolean>((resolve) => {
        if (validation.current) {
          window.clearTimeout(validation.current.timeout);
          validation.current.finish(false);
        }
        const finish = (valid: boolean) => {
          validation.current = null;
          setCandidateDesign(null);
          resolve(valid);
        };
        validation.current = {
          phase: 'candidate',
          sawMeasuring: false,
          finish,
          timeout: window.setTimeout(() => finish(false), 5000),
        };
      });
    },
    [document],
  );

  const handleLayoutStatus = useCallback((status: RecipePageLayoutStatus) => {
    setLayoutStatus(status);
    const pending = validation.current;
    if (!pending) return;
    if (status === 'measuring') {
      pending.sawMeasuring = true;
      return;
    }
    if (!pending.sawMeasuring) return;
    if (pending.phase === 'candidate' && status !== 'ready') {
      pending.phase = 'restore';
      pending.sawMeasuring = false;
      setCandidateDesign(null);
      return;
    }
    window.clearTimeout(pending.timeout);
    pending.finish(pending.phase === 'candidate' && status === 'ready');
  }, []);

  const cancelDrag = useCallback(() => {
    drag.current = null;
    setTransient(null);
    setGuideAxis({ x: false, y: false });
  }, []);
  useEffect(() => {
    const cancel = () => cancelDrag();
    window.addEventListener('blur', cancel);
    return () => window.removeEventListener('blur', cancel);
  }, [cancelDrag]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const target = (event.target as Element).closest<HTMLElement>('[data-composition-key]');
    const sheet = target?.closest<HTMLElement>('[data-document-page]');
    const key = target?.dataset['compositionKey'];
    const kind = target?.dataset['compositionKind'] === 'decor' ? 'decor' : 'content';
    const pageId = sheet?.dataset['documentPage'];
    if (!target || !sheet || !key || !pageId) return;
    const nextSelection = { key, kind, pageId } as const;
    setSelection(nextSelection);
    if (!editable || readOnly || saving) return;
    const contentBinding = key.slice(8) as RecipePageBinding;
    if (kind === 'content' && FIXED_BINDINGS.has(contentBinding)) return;
    const authored =
      kind === 'content'
        ? workingRef.current.elements.find((item) => item.binding === contentBinding)
        : undefined;
    const pageElement =
      kind === 'content'
        ? document?.pages
            .find((page) => page.id === pageId)
            ?.elements.find((item) => item.binding === contentBinding)
        : undefined;
    const sticker =
      kind === 'decor' ? stickersRef.current.find((item) => `sticker:${item.id}` === key) : null;
    const before = sticker
      ? geometryFromSticker(sticker)
      : authored
        ? geometryFromElement(pageId, authored)
        : pageElement
          ? {
              pageId,
              x: pageElement.x,
              y: pageElement.y,
              width: pageElement.width,
              height: pageElement.height,
              rotation: 0,
              zIndex: pageElement.zIndex,
              locked: false,
            }
          : null;
    if (!before || before.locked) return;
    const rect = sheet.getBoundingClientRect();
    drag.current = {
      pointerId: event.pointerId,
      selection: nextSelection,
      before,
      width: rect.width,
      height: rect.height,
      startX: event.clientX,
      startY: event.clientY,
      designId: authored?.id ?? crypto.randomUUID(),
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic accessibility tests do not create a native active pointer; real pointers do.
    }
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const geometry = moveCompositionGeometry(
      active.before,
      active.selection.kind,
      ((event.clientX - active.startX) / active.width) * 100,
      ((event.clientY - active.startY) / active.height) * 100,
    );
    setTransient({ selection: active.selection, geometry, designId: active.designId });
    setGuideAxis({
      x: guides && Math.abs(geometry.x + geometry.width / 2 - 50) <= 1,
      y: guides && Math.abs(geometry.y + geometry.height / 2 - 50) <= 1,
    });
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const after = moveCompositionGeometry(
      active.before,
      active.selection.kind,
      ((event.clientX - active.startX) / active.width) * 100,
      ((event.clientY - active.startY) / active.height) * 100,
    );
    cancelDrag();
    commitGeometry(active.selection, active.before, after);
  };

  const undo = useCallback(() => {
    if (saving) return;
    const result = undoCompositionCommand(historyRef.current);
    if (!result.command || !result.geometry) return;
    updateHistory(result.history);
    applyCommand({ ...result.command, after: result.geometry }, false);
  }, [applyCommand, saving, updateHistory]);
  const redo = useCallback(() => {
    if (saving) return;
    const result = redoCompositionCommand(historyRef.current);
    if (!result.command || !result.geometry) return;
    updateHistory(result.history);
    applyCommand({ ...result.command, after: result.geometry }, false);
  }, [applyCommand, saving, updateHistory]);

  const retrySticker = useCallback(async () => {
    const pending = placementRequests.pending(recipeId).at(-1);
    if (!pending) return;
    setSaving(true);
    setError('');
    try {
      const result = await placementRequests.execute(pending.command);
      if (result.kind !== 'recipeSticker') throw new Error('Сервер не подтвердил размещение.');
      updateStickers(
        stickersRef.current.map((item) => (item.id === result.sticker.id ? result.sticker : item)),
      );
      setFailedKind(null);
      setConflict(false);
      onStickerSaved();
    } catch (cause) {
      setError(errorText(cause));
      setFailedKind('sticker');
      setConflict(cause instanceof ApiClientError && cause.code === 'STICKER_CONFLICT');
      if (cause instanceof ApiClientError && cause.code === 'ACCESS_DENIED') setReadOnly(true);
    } finally {
      setSaving(false);
    }
  }, [onStickerSaved, placementRequests, recipeId, updateStickers]);

  const handleDocumentChange = useCallback((next: RecipePageDocument) => {
    setDocument((current) => (jsonEqual(current, next) ? current : next));
  }, []);
  const handleStickerPlacementsChange = useCallback(
    (next: readonly RecipeSticker[]) => {
      const pending = placementRequests.pending(recipeId);
      const merged = next.map((item) => {
        const command = pending.find(
          (entry) => entry.command.payload.instanceId === item.id,
        )?.command;
        return command ? { ...item, ...command.payload } : item;
      });
      if (!jsonEqual(stickersRef.current, merged)) updateStickers([...merged]);
      if (pending.length) {
        setFailedKind('sticker');
        setError((current) => current || 'Предыдущее сохранение размещения не подтверждено.');
      }
    },
    [placementRequests, recipeId, updateStickers],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).matches('input, select, textarea, button')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (!selection || !selectedData || !editable || readOnly || saving || selectedData.fixed)
      return;
    const delta = event.shiftKey ? 5 : 1;
    const offsets: Record<string, readonly [number, number]> = {
      ArrowLeft: [-delta, 0],
      ArrowRight: [delta, 0],
      ArrowUp: [0, -delta],
      ArrowDown: [0, delta],
    };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    commitGeometry(
      selection,
      selectedData.geometry,
      moveCompositionGeometry(selectedData.geometry, selection.kind, offset[0], offset[1]),
    );
  };

  const submitProperties = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selection || !selectedData) return;
    const data = new FormData(event.currentTarget);
    const number = (name: string, fallback: number) => {
      const value = Number(data.get(name));
      return Number.isFinite(value) ? value : fallback;
    };
    const geometry = resizeCompositionGeometry(
      {
        ...selectedData.geometry,
        pageId: String(data.get('pageId') || selectedData.geometry.pageId),
        x: number('x', selectedData.geometry.x),
        y: number('y', selectedData.geometry.y),
        rotation: number('rotation', selectedData.geometry.rotation),
        zIndex: number('zIndex', selectedData.geometry.zIndex),
      },
      selection.kind,
      number('width', selectedData.geometry.width),
      number('height', selectedData.geometry.height),
    );
    const resized =
      geometry.width !== selectedData.geometry.width ||
      geometry.height !== selectedData.geometry.height;
    if (selection.kind === 'content' && resized) {
      setSaving(true);
      const valid = await validateContentSize(selection, geometry);
      setSaving(false);
      if (!valid) {
        setError(
          'Этот размер не вмещает весь текст. Увеличьте блок: неподтверждённая геометрия не сохранена.',
        );
        return;
      }
    }
    commitGeometry(selection, selectedData.geometry, geometry);
  };

  const canEdit = editable && !readOnly && !saving && !failedKind;
  return (
    <section className="composition-editor" aria-labelledby="composition-editor-title">
      <header className="composition-toolbar">
        <div>
          <p className="eyebrow">Композиция</p>
          <h3 id="composition-editor-title">Редактор страницы</h3>
          <p className="muted text-sm">
            Текст меняется в «Содержании». Здесь сохраняются только положение и оформление блоков.
          </p>
        </div>
        <div className="composition-toolbar-actions">
          <button type="button" disabled={!history.past.length || saving} onClick={undo}>
            Отменить
          </button>
          <button type="button" disabled={!history.future.length || saving} onClick={redo}>
            Повторить
          </button>
          <label>
            Масштаб
            <input
              aria-label="Масштаб листа"
              type="range"
              min="40"
              max="100"
              step="5"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
            <span>{zoom}%</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={guides}
              onChange={(event) => setGuides(event.target.checked)}
            />
            Направляющие
          </label>
        </div>
      </header>

      {(dirty || saving) && (
        <div className="composition-save-state" role="status">
          <span>
            {saving ? 'Сохраняем одну завершённую команду…' : 'Есть локальная версия композиции.'}
          </span>
          {dirty && !saving && !error && editable && (
            <button type="button" onClick={() => void persistDesign(workingRef.current)}>
              Сохранить локальные изменения
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="template-notice template-notice-error composition-error" role="alert">
          <p>{error}</p>
          <div className="recipe-row-actions">
            {!readOnly && (
              <button
                type="button"
                className="button button-secondary"
                disabled={saving}
                onClick={() =>
                  void (failedKind === 'sticker'
                    ? retrySticker()
                    : persistDesign(workingRef.current))
                }
              >
                Повторить сохранение
              </button>
            )}
            {conflict && (
              <button
                type="button"
                className="button button-secondary"
                disabled={saving}
                onClick={() =>
                  void (failedKind === 'sticker'
                    ? Promise.resolve().then(() => {
                        placementRequests.discard(recipeId);
                        setError('');
                        setFailedKind(null);
                        setConflict(false);
                        onStickerSaved();
                      })
                    : onReloadDesign().then((server) => {
                        if (!server) return;
                        updateWorking(server.value, false);
                        updateHistory(EMPTY_COMPOSITION_HISTORY);
                        setError('');
                        setFailedKind(null);
                        setConflict(false);
                      }))
                }
              >
                Принять серверную версию
              </button>
            )}
          </div>
        </div>
      )}

      <div className="composition-workspace">
        <nav className="composition-tree" aria-label="Страницы и элементы">
          <h4>Страницы</h4>
          {document?.pages.map((page) => (
            <details key={page.id} open={page.index === 0}>
              <summary
                onClick={() =>
                  canvas.current
                    ?.querySelector(`[data-document-page="${page.id}"]`)
                    ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
                }
              >
                Страница {page.index + 1}
              </summary>
              <div>
                {page.elements.map((element) => {
                  const key = `content:${element.binding}`;
                  return (
                    <button
                      key={element.id}
                      type="button"
                      aria-pressed={selection?.key === key && selection.pageId === page.id}
                      onClick={() => setSelection({ key, kind: 'content', pageId: page.id })}
                    >
                      {BINDING_LABELS[element.binding]}
                      {FIXED_BINDINGS.has(element.binding) ? ' · закреплён' : ''}
                    </button>
                  );
                })}
                {stickers
                  .filter((sticker) => (sticker.pageId ?? `page-${sticker.page}`) === page.id)
                  .map((sticker) => (
                    <button
                      key={sticker.id}
                      type="button"
                      aria-pressed={selection?.key === `sticker:${sticker.id}`}
                      onClick={() =>
                        setSelection({
                          key: `sticker:${sticker.id}`,
                          kind: 'decor',
                          pageId: page.id,
                        })
                      }
                    >
                      {sticker.emoji} {sticker.name}
                    </button>
                  ))}
              </div>
            </details>
          )) ?? <p>Готовим список страниц…</p>}
        </nav>

        <div
          ref={canvas}
          className="composition-canvas"
          data-guide-x={guideAxis.x || undefined}
          data-guide-y={guideAxis.y || undefined}
          tabIndex={0}
          aria-label="Лист рецепта. Стрелки перемещают выбранный элемент, Shift задаёт крупный шаг."
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={cancelDrag}
          onLostPointerCapture={cancelDrag}
        >
          {guideAxis.x && <span className="composition-guide composition-guide-x" />}
          {guideAxis.y && <span className="composition-guide composition-guide-y" />}
          <div
            className="composition-preview-zoom"
            style={{ width: `min(100%, ${Math.round((794 * zoom) / 100)}px)` }}
          >
            <RecipePagePreview
              recipeId={recipeId}
              recipeRevision={recipeRevision}
              templateId={templateId}
              templateRevision={templateRevision}
              templateName={templateName}
              layout={layout}
              theme={theme}
              designElements={previewElements}
              value={value}
              tags={tags}
              coverPhoto={coverPhoto}
              photos={photos}
              pageView="a4"
              compositionEditable={canEdit}
              selectedCompositionKey={selection?.key ?? null}
              stickerGeometry={previewStickers}
              assetRefreshKey={assetRefreshKey}
              onLayoutStatusChange={handleLayoutStatus}
              onDocumentPagesChange={onDocumentPagesChange}
              onDocumentChange={handleDocumentChange}
              onStickerPlacementsChange={handleStickerPlacementsChange}
            />
          </div>
        </div>

        <aside className="composition-properties" aria-label="Свойства элемента">
          <h4>Свойства</h4>
          {selection && selectedData ? (
            <form
              key={`${selection.key}:${JSON.stringify(selectedData.geometry)}`}
              onSubmit={submitProperties}
            >
              <strong>{selectedData.label}</strong>
              <p className="muted text-sm">
                {selection.kind === 'content'
                  ? selectedData.fixed
                    ? 'Служебный блок закреплён правилами страницы.'
                    : 'Содержательный блок: сетка 1%, поворот отключён.'
                  : 'Декоративный элемент: координаты полного листа A4.'}
              </p>
              <label>
                Страница
                <select
                  name="pageId"
                  defaultValue={selectedData.geometry.pageId}
                  disabled={!canEdit || selection.kind === 'content'}
                >
                  {document?.pages.map((page) => (
                    <option key={page.id} value={page.id}>
                      Страница {page.index + 1}
                    </option>
                  ))}
                </select>
              </label>
              <div className="composition-property-grid">
                {(['x', 'y', 'width', 'height'] as const).map((name) => (
                  <label key={name}>
                    {name === 'x'
                      ? 'X, %'
                      : name === 'y'
                        ? 'Y, %'
                        : name === 'width'
                          ? 'Ширина, %'
                          : 'Высота, %'}
                    <input
                      name={name}
                      type="number"
                      min={name === 'width' || name === 'height' ? 2 : 0}
                      max="100"
                      step="any"
                      defaultValue={selectedData.geometry[name]}
                      disabled={!canEdit || selectedData.fixed || selectedData.geometry.locked}
                    />
                  </label>
                ))}
                <label>
                  Поворот
                  <input
                    name="rotation"
                    type="number"
                    min="-180"
                    max="180"
                    step="1"
                    defaultValue={selectedData.geometry.rotation}
                    disabled={!canEdit || selection.kind === 'content'}
                  />
                </label>
                <label>
                  Слой
                  <input
                    name="zIndex"
                    type="number"
                    min="0"
                    max={selection.kind === 'content' ? 100 : 10_000}
                    step="1"
                    defaultValue={selectedData.geometry.zIndex}
                    disabled={!canEdit || selectedData.fixed || selectedData.geometry.locked}
                  />
                </label>
              </div>
              <div className="composition-property-actions">
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={!canEdit || selectedData.fixed || selectedData.geometry.locked}
                >
                  Применить
                </button>
                {selection.kind === 'content' && !selectedData.fixed && (
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={!canEdit}
                    aria-pressed={selectedData.geometry.locked}
                    onClick={() =>
                      commitGeometry(selection, selectedData.geometry, {
                        ...selectedData.geometry,
                        locked: !selectedData.geometry.locked,
                      })
                    }
                  >
                    {selectedData.geometry.locked ? 'Разблокировать' : 'Заблокировать'}
                  </button>
                )}
              </div>
            </form>
          ) : (
            <p className="muted">Выберите блок на листе или в списке страниц.</p>
          )}
          <p className="muted text-sm composition-keyboard-help">
            Клавиши: стрелки — 1%, Shift+стрелка — 5%, Ctrl/⌘+Z — отмена, Ctrl/⌘+Y — повтор.
          </p>
          <p className="muted text-sm">Состояние раскладки: {layoutStatus}.</p>
        </aside>
      </div>
    </section>
  );
}
