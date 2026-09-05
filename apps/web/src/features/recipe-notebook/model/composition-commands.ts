export type CompositionKind = 'content' | 'decor';

export type CompositionGeometry = Readonly<{
  pageId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  locked: boolean;
}>;

export type CompositionCommand = Readonly<{
  target: string;
  kind: CompositionKind;
  before: CompositionGeometry;
  after: CompositionGeometry;
}>;

export type CompositionHistory = Readonly<{
  past: readonly CompositionCommand[];
  future: readonly CompositionCommand[];
}>;

export const EMPTY_COMPOSITION_HISTORY: CompositionHistory = { past: [], future: [] };
export const COMPOSITION_GRID = 1;
export const COMPOSITION_HISTORY_LIMIT = 100;

const round = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);

function snap(value: number, kind: CompositionKind) {
  return kind === 'content' ? Math.round(value / COMPOSITION_GRID) * COMPOSITION_GRID : value;
}

export function constrainCompositionGeometry(
  source: CompositionGeometry,
  kind: CompositionKind,
): CompositionGeometry {
  const minimum = kind === 'content' ? { width: 12, height: 4 } : { width: 2, height: 2 };
  const width = clamp(snap(finite(source.width, minimum.width), kind), minimum.width, 100);
  const height = clamp(snap(finite(source.height, minimum.height), kind), minimum.height, 100);
  const x = clamp(snap(finite(source.x, 0), kind), 0, 100 - width);
  const y = clamp(snap(finite(source.y, 0), kind), 0, 100 - height);
  return {
    pageId: /^page-([1-9][0-9]?|100)$/.test(source.pageId) ? source.pageId : 'page-1',
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
    rotation: kind === 'content' ? 0 : round(clamp(finite(source.rotation, 0), -180, 180)),
    zIndex: Math.round(clamp(finite(source.zIndex, 0), 0, kind === 'content' ? 100 : 10_000)),
    locked: Boolean(source.locked),
  };
}

export function moveCompositionGeometry(
  source: CompositionGeometry,
  kind: CompositionKind,
  deltaX: number,
  deltaY: number,
) {
  if (source.locked) return source;
  return constrainCompositionGeometry(
    { ...source, x: source.x + deltaX, y: source.y + deltaY },
    kind,
  );
}

export function resizeCompositionGeometry(
  source: CompositionGeometry,
  kind: CompositionKind,
  width: number,
  height: number,
) {
  if (source.locked) return source;
  return constrainCompositionGeometry({ ...source, width, height }, kind);
}

export function compositionGeometryEqual(left: CompositionGeometry, right: CompositionGeometry) {
  return (
    left.pageId === right.pageId &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height &&
    left.rotation === right.rotation &&
    left.zIndex === right.zIndex &&
    left.locked === right.locked
  );
}

export function recordCompositionCommand(
  history: CompositionHistory,
  command: CompositionCommand,
): CompositionHistory {
  if (compositionGeometryEqual(command.before, command.after)) return history;
  return {
    past: [...history.past, command].slice(-COMPOSITION_HISTORY_LIMIT),
    future: [],
  };
}

export function undoCompositionCommand(history: CompositionHistory) {
  const command = history.past.at(-1) ?? null;
  if (!command) return { history, command: null, geometry: null } as const;
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [command, ...history.future],
    },
    command,
    geometry: command.before,
  } as const;
}

export function redoCompositionCommand(history: CompositionHistory) {
  const command = history.future[0] ?? null;
  if (!command) return { history, command: null, geometry: null } as const;
  return {
    history: {
      past: [...history.past, command],
      future: history.future.slice(1),
    },
    command,
    geometry: command.after,
  } as const;
}
