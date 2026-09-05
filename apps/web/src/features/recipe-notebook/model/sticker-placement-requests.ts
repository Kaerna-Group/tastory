import { stickerCommandSchema } from '@tastory/contracts';
import type { StickerCommand, StickerData } from '@tastory/contracts';
import { ApiClientError } from '@/shared/api';

export type StickerPlacementCommand = Extract<
  StickerCommand,
  { action: 'recipes.stickers.update' }
>;
export type StickerPlacementStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type StickerRequest = (
  command: StickerCommand,
  requestId: string,
  signal?: AbortSignal,
) => Promise<StickerData>;
type Pending = Readonly<{ command: StickerPlacementCommand; requestId: string }>;

const PREFIX = 'tastory.sticker-placement-mutations.v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

const commandKey = (command: StickerPlacementCommand) => JSON.stringify(canonical(command));
const unknownOutcome = (cause: unknown) =>
  (cause instanceof ApiClientError &&
    (cause.code === 'TRANSPORT_ERROR' || cause.code === 'INVALID_RESPONSE')) ||
  (cause instanceof Error && cause.name === 'AbortError');

export function stickerPlacementScope(endpoint: string, subject: string) {
  return `${PREFIX}${JSON.stringify([endpoint || 'mock', subject])}`;
}

export class StickerPlacementRequests {
  constructor(
    private storage: StickerPlacementStorage,
    private storageKey: string,
    private request: StickerRequest,
    private createRequestId = () => crypto.randomUUID(),
  ) {}

  private read(): Pending[] {
    try {
      const raw: unknown = JSON.parse(this.storage.getItem(this.storageKey) ?? 'null');
      if (!raw || typeof raw !== 'object') return [];
      const value = raw as { version?: unknown; pending?: unknown };
      if (value.version !== 1 || !Array.isArray(value.pending)) return [];
      const result: Pending[] = [];
      for (const item of value.pending.slice(0, 50)) {
        if (!item || typeof item !== 'object') return [];
        const record = item as { command?: unknown; requestId?: unknown };
        const parsed = stickerCommandSchema.safeParse(record.command);
        if (
          !parsed.success ||
          parsed.data.action !== 'recipes.stickers.update' ||
          typeof record.requestId !== 'string' ||
          !UUID.test(record.requestId)
        )
          return [];
        result.push({ command: parsed.data, requestId: record.requestId });
      }
      return result;
    } catch {
      return [];
    }
  }

  private write(value: readonly Pending[]) {
    if (!value.length) this.storage.removeItem(this.storageKey);
    else this.storage.setItem(this.storageKey, JSON.stringify({ version: 1, pending: value }));
  }

  pending(recipeId?: string) {
    return this.read().filter((item) => !recipeId || item.command.payload.recipeId === recipeId);
  }

  discard(recipeId: string) {
    this.write(this.read().filter((item) => item.command.payload.recipeId !== recipeId));
  }

  async execute(command: StickerPlacementCommand, signal?: AbortSignal) {
    const key = commandKey(command);
    const pending = this.read().filter(
      (item) =>
        item.command.payload.instanceId !== command.payload.instanceId ||
        commandKey(item.command) === key,
    );
    const existing = pending.find((item) => commandKey(item.command) === key);
    const requestId = existing?.requestId ?? this.createRequestId();
    if (!existing) pending.push({ command, requestId });
    this.write(pending);
    try {
      const result = await this.request(command, requestId, signal);
      this.write(this.read().filter((item) => commandKey(item.command) !== key));
      return result;
    } catch (cause) {
      const keep =
        unknownOutcome(cause) ||
        (cause instanceof ApiClientError &&
          (cause.code === 'STICKER_CONFLICT' || cause.code === 'ACCESS_DENIED'));
      if (!keep) this.write(this.read().filter((item) => commandKey(item.command) !== key));
      throw cause;
    }
  }
}
