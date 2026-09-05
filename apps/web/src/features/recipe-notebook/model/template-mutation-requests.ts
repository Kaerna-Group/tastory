import { templateCommandSchema, templateMutationActions } from '@tastory/contracts';
import type { TemplateCommand, TemplateData } from '@tastory/contracts';
import { ApiClientError } from '@/shared/api';

export type TemplateMutationCommand = Extract<
  TemplateCommand,
  { action: (typeof templateMutationActions)[number] }
>;
export type TemplateMutationStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type TemplateMutationRequest = (
  command: TemplateCommand,
  requestId: string,
  signal?: AbortSignal,
) => Promise<TemplateData>;

type PendingMutation = Readonly<{
  command: TemplateMutationCommand;
  requestId: string;
}>;

const PREFIX = 'tastory.template-mutations.v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const mutationActions = new Set<string>(templateMutationActions);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function commandKey(command: TemplateMutationCommand) {
  return JSON.stringify(canonicalize(command));
}

function isUnknownOutcome(cause: unknown) {
  return (
    (cause instanceof ApiClientError &&
      (cause.code === 'TRANSPORT_ERROR' || cause.code === 'INVALID_RESPONSE')) ||
    (cause instanceof Error && cause.name === 'AbortError')
  );
}

function containsDesign(command: TemplateMutationCommand) {
  return (
    command.action === 'recipes.design.save' ||
    ((command.action === 'recipes.template.apply' ||
      command.action === 'recipes.template.restore') &&
      command.payload.design !== undefined)
  );
}

function recipeDesignId(command: TemplateMutationCommand) {
  return containsDesign(command) && 'recipeId' in command.payload ? command.payload.recipeId : null;
}

export function templateMutationScope(endpoint: string, subject: string) {
  return `${PREFIX}${JSON.stringify([endpoint || 'mock', subject])}`;
}

export class TemplateMutationRequests {
  constructor(
    private storage: TemplateMutationStorage,
    private storageKey: string,
    private request: TemplateMutationRequest,
    private createRequestId = () => crypto.randomUUID(),
  ) {}

  private read(): PendingMutation[] {
    try {
      const parsed: unknown = JSON.parse(this.storage.getItem(this.storageKey) ?? 'null');
      if (!parsed || typeof parsed !== 'object') return [];
      const value = parsed as { version?: unknown; pending?: unknown };
      if (value.version !== 1 || !Array.isArray(value.pending)) return [];
      const pending: PendingMutation[] = [];
      for (const item of value.pending.slice(0, 50)) {
        if (!item || typeof item !== 'object') return [];
        const record = item as { command?: unknown; requestId?: unknown };
        const command = templateCommandSchema.safeParse(record.command);
        if (
          !command.success ||
          !mutationActions.has(command.data.action) ||
          typeof record.requestId !== 'string' ||
          !UUID.test(record.requestId)
        )
          return [];
        pending.push({
          command: command.data as TemplateMutationCommand,
          requestId: record.requestId,
        });
      }
      return pending;
    } catch {
      return [];
    }
  }

  private write(pending: readonly PendingMutation[]) {
    if (!pending.length) this.storage.removeItem(this.storageKey);
    else this.storage.setItem(this.storageKey, JSON.stringify({ version: 1, pending }));
  }

  pending(action?: TemplateMutationCommand['action']) {
    return this.read().filter((item) => !action || item.command.action === action);
  }

  discardRecipeDesign(recipeId: string) {
    this.write(this.read().filter((item) => recipeDesignId(item.command) !== recipeId));
  }

  private begin(command: TemplateMutationCommand) {
    const key = commandKey(command);
    const recipeId = recipeDesignId(command);
    const pending = this.read().filter(
      (item) =>
        recipeId === null ||
        recipeDesignId(item.command) !== recipeId ||
        commandKey(item.command) === key,
    );
    const existing = pending.find((item) => commandKey(item.command) === key);
    if (existing) {
      this.write(pending);
      return existing.requestId;
    }
    if (pending.length >= 50)
      throw new Error(
        'Слишком много незавершённых команд шаблонов. Повторите их перед новой записью.',
      );
    const requestId = this.createRequestId();
    this.write([...pending, { command, requestId }]);
    return requestId;
  }

  private finish(command: TemplateMutationCommand, keepPending: boolean) {
    if (keepPending) return;
    const key = commandKey(command);
    try {
      this.write(this.read().filter((item) => commandKey(item.command) !== key));
    } catch {
      // A stale request ID is safe: the server will replay it instead of duplicating the write.
    }
  }

  async execute(command: TemplateMutationCommand, signal?: AbortSignal) {
    const requestId = this.begin(command);
    try {
      const result = await this.request(command, requestId, signal);
      this.finish(command, false);
      return result;
    } catch (cause) {
      this.finish(
        command,
        isUnknownOutcome(cause) ||
          (containsDesign(command) &&
            cause instanceof ApiClientError &&
            (cause.code === 'TEMPLATE_CONFLICT' || cause.code === 'ACCESS_DENIED')),
      );
      throw cause;
    }
  }
}
