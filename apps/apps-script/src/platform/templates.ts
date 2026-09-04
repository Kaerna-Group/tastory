import {
  BUILTIN_RECIPE_TEMPLATES,
  TEMPLATE_LIMITS,
  recipeTemplateSchema,
  templateCategoryForLayout,
  templateCommandSchema,
  templateSchema,
} from '@tastory/contracts';
import type {
  AuthData,
  RecipeTemplate,
  RecipeTemplateRecord,
  RecipeTemplateView,
  TemplateCommand,
  TemplateData,
} from '@tastory/contracts';
import {
  canAccessRecipe,
  canCopyTemplate,
  canManageTemplate,
  canReadTemplate,
} from '@tastory/domain';
import { AuthError } from '../auth/google-token';
import { resolveWorkspaceAccess, sheetsAuthConfigSchema } from '../auth/workspace-access';
import { createRecipeReader } from '../services/recipe-reader';
import { readRecipeAggregate } from '../services/recipe-model';
import { planRecipeSchema } from '../services/recipe-migration';
import { canonicalRecipeJson } from '../services/recipe-storage';
import {
  publishTemplateMutation,
  readTemplateState,
  TemplateStorageError,
} from '../services/template-storage';
import type { TemplateOperation } from '../services/template-storage';
import { journalMigrationOptions, sha256 } from './current-schema';
import { createRecipeStore } from './recipe-store';
import { runtimeEnvironment } from './runtime-environment';
import { readWorkspaceDirectory, SHEETS_AUTH_CONFIG_KEY } from './workspace-directory';

type Actor = { userId: string; workspaceId: string; role: 'owner' | 'member' | 'viewer' };
const stripVersion = <T extends { versionId: string }>(value: T): Omit<T, 'versionId'> => {
  const { versionId, ...rest } = value;
  void versionId;
  return rest;
};

function customTemplates(store: ReturnType<typeof createRecipeStore>) {
  const state = readTemplateState(store);
  return {
    state,
    templates: [...state.templates.values()].map((row) => templateSchema.parse(stripVersion(row))),
    applied: [...state.applied.values()].map((row) =>
      recipeTemplateSchema.parse(stripVersion(row)),
    ),
  };
}

function requireTemplate(
  actor: Actor,
  templates: RecipeTemplateRecord[],
  id: string,
  manage = false,
) {
  const template = templates.find((item) => item.id === id);
  if (
    !template ||
    (manage ? !canManageTemplate(actor, template) : !canReadTemplate(actor, template))
  )
    throw new AuthError('ACCESS_DENIED');
  return template;
}

function operation(
  command: TemplateCommand,
  requestId: string,
  entityId: string,
  actor: Actor,
  now: () => Date,
) {
  return {
    requestId,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    action: command.action as TemplateOperation['action'],
    entityId,
    payloadHash: sha256(canonicalRecipeJson(command)),
    startedAt: now().toISOString(),
  };
}

export function templates(
  input: TemplateCommand,
  requestId: string,
  session: AuthData,
): TemplateData {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new TemplateStorageError();
  try {
    const assertLive = () => {
      if (
        !Number.isFinite(Date.parse(session.expiresAt)) ||
        Date.parse(session.expiresAt) <= Date.now()
      )
        throw new AuthError('UNAUTHENTICATED');
    };
    assertLive();
    const command = templateCommandSchema.parse(input);
    const properties = PropertiesService.getScriptProperties();
    const config = sheetsAuthConfigSchema.safeParse(
      JSON.parse(properties.getProperty(SHEETS_AUTH_CONFIG_KEY) ?? 'null'),
    );
    const spreadsheetId = properties.getProperty('SPREADSHEET_ID');
    const driveFolderId = properties.getProperty('DRIVE_FOLDER_ID') ?? '';
    if (
      !runtimeEnvironment(properties.getProperty('APP_ENV')) ||
      !spreadsheetId ||
      !driveFolderId ||
      !config.success
    )
      throw new TemplateStorageError('TEMPLATE_NOT_READY');
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const directory = () => readWorkspaceDirectory(spreadsheet);
    const currentDirectory = directory();
    const actor = resolveWorkspaceAccess(
      currentDirectory,
      session.user.id,
      config.data.workspaceId,
    );
    const store = createRecipeStore(spreadsheet);
    if (
      !planRecipeSchema(store, {
        ...journalMigrationOptions(driveFolderId),
        beforeWrite: assertLive,
      }).alreadyApplied
    )
      throw new TemplateStorageError('TEMPLATE_NOT_READY');
    const now = () => new Date();
    const all = () => {
      const custom = customTemplates(store);
      return { ...custom, templates: [...BUILTIN_RECIPE_TEMPLATES, ...custom.templates] };
    };
    const authorName = (template: RecipeTemplateRecord) => {
      if (template.kind === 'builtin') return 'Tastory';
      return (
        currentDirectory.users.find((user) => user.user_id === template.ownerUserId)
          ?.display_name || 'Участник тетради'
      );
    };
    const view = (template: RecipeTemplateRecord): RecipeTemplateView => ({
      template,
      authorName: authorName(template),
      canManage: canManageTemplate(actor, template),
      canCopy: canCopyTemplate(actor, template),
    });
    const recipeModel = () => ({
      session,
      workspaceId: actor.workspaceId,
      readDirectory: directory,
      store,
      now,
      sha256,
      reader: createRecipeReader(store, sha256),
    });
    const readableRecipe = (recipeId: string, action: 'read' | 'update') => {
      const aggregate = readRecipeAggregate(recipeModel(), recipeId);
      if (!canAccessRecipe(actor, aggregate.recipe, action)) throw new AuthError('ACCESS_DENIED');
      return aggregate;
    };

    if (command.action === 'templates.list') {
      const query = command.payload.query.trim().toLocaleLowerCase('ru');
      return {
        kind: 'templateLibrary',
        templates: all()
          .templates.filter((template) => canReadTemplate(actor, template))
          .filter(
            (template) =>
              template.status === 'active' ||
              (command.payload.includeArchived && canManageTemplate(actor, template)),
          )
          .filter(
            (template) =>
              command.payload.category === 'all' || template.category === command.payload.category,
          )
          .filter((template) => {
            if (command.payload.scope === 'mine') return template.ownerUserId === actor.userId;
            if (command.payload.scope === 'community')
              return (
                template.kind === 'custom' &&
                template.visibility === 'workspace' &&
                template.ownerUserId !== actor.userId
              );
            return true;
          })
          .map(view)
          .filter(
            (item) =>
              !query ||
              `${item.template.name} ${item.template.description} ${item.authorName}`
                .toLocaleLowerCase('ru')
                .includes(query),
          ),
      };
    }

    if (command.action === 'recipes.template.get') {
      readableRecipe(command.payload.recipeId, 'read');
      const applied = customTemplates(store).applied.find(
        (item) => item.recipeId === command.payload.recipeId,
      );
      return {
        kind: 'recipeTemplate',
        recipeId: command.payload.recipeId,
        template: applied ?? null,
        outcome: 'read',
      };
    }

    if (actor.role === 'viewer') throw new AuthError('ACCESS_DENIED');
    const before = all();
    const existing = before.state.operations.find((item) => item.requestId === requestId);
    if (existing) {
      if (
        existing.workspaceId !== actor.workspaceId ||
        existing.userId !== actor.userId ||
        existing.action !== command.action ||
        existing.payloadHash !== sha256(canonicalRecipeJson(command))
      )
        throw new TemplateStorageError('TEMPLATE_CONFLICT');
      if (existing.state.startsWith('committed@')) {
        if (command.action === 'recipes.template.apply') {
          readableRecipe(existing.entityId, 'read');
          const applied = before.applied.find((item) => item.recipeId === existing.entityId);
          if (!applied) throw new TemplateStorageError();
          return {
            kind: 'recipeTemplate',
            recipeId: applied.recipeId,
            template: applied,
            outcome: 'replayed',
          };
        }
        const template = before.templates.find((item) => item.id === existing.entityId);
        if (!template || !canManageTemplate(actor, template)) throw new AuthError('ACCESS_DENIED');
        return { kind: 'template', ...view(template), outcome: 'replayed' };
      }
    }
    const ownedCount = before.templates.filter(
      (template) => template.kind === 'custom' && template.ownerUserId === actor.userId,
    ).length;

    if (command.action === 'templates.create' || command.action === 'templates.clone') {
      if (ownedCount >= TEMPLATE_LIMITS.perUser) throw new TemplateStorageError('TEMPLATE_LIMIT');
      let source: RecipeTemplateRecord | null = null;
      let layout: RecipeTemplateRecord['layout'];
      let name: string;
      let description: string;
      if (command.action === 'templates.clone') {
        source = requireTemplate(actor, before.templates, command.payload.templateId);
        if (!canCopyTemplate(actor, source)) throw new AuthError('ACCESS_DENIED');
        if (source.revision !== command.payload.expectedRevision)
          throw new TemplateStorageError('TEMPLATE_CONFLICT');
        if (source.status !== 'active') throw new TemplateStorageError('TEMPLATE_INVALID');
        layout = source.layout;
        name = (command.payload.name ?? `${source.name} — моя`).slice(0, TEMPLATE_LIMITS.name);
        description = source.description;
      } else {
        layout = command.payload.layout;
        name = command.payload.name;
        description = command.payload.description;
      }
      const timestamp = now().toISOString();
      const template = templateSchema.parse({
        id: requestId,
        workspaceId: actor.workspaceId,
        ownerUserId: actor.userId,
        kind: 'custom',
        name,
        description,
        category: templateCategoryForLayout(layout),
        layout,
        visibility: command.payload.visibility,
        status: 'active',
        sourceTemplateId: source?.id ?? null,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const outcome = publishTemplateMutation(
        store,
        operation(command, requestId, template.id, actor, now),
        [{ table: 'Templates', value: template }],
        now,
      );
      return { kind: 'template', ...view(template), outcome };
    }

    if (
      command.action === 'templates.update' ||
      command.action === 'templates.archive' ||
      command.action === 'templates.restore'
    ) {
      const template = requireTemplate(actor, before.templates, command.payload.templateId, true);
      if (template.revision !== command.payload.expectedRevision)
        throw new TemplateStorageError('TEMPLATE_CONFLICT');
      const timestamp = now().toISOString();
      let next: RecipeTemplateRecord = {
        ...template,
        revision: template.revision + 1,
        updatedAt: timestamp,
      };
      if (command.action === 'templates.update') {
        next = templateSchema.parse({
          ...next,
          name: command.payload.name,
          description: command.payload.description,
          category: templateCategoryForLayout(command.payload.layout),
          layout: command.payload.layout,
          visibility: command.payload.visibility,
        });
      } else {
        next = { ...next, status: command.action === 'templates.archive' ? 'archived' : 'active' };
      }
      const outcome = publishTemplateMutation(
        store,
        operation(command, requestId, template.id, actor, now),
        [{ table: 'Templates', value: next }],
        now,
      );
      return { kind: 'template', ...view(next), outcome };
    }

    const applyCommand = command as Extract<TemplateCommand, { action: 'recipes.template.apply' }>;
    const aggregate = readableRecipe(applyCommand.payload.recipeId, 'update');
    if (aggregate.recipe.revision !== applyCommand.payload.expectedRecipeRevision)
      throw new TemplateStorageError('TEMPLATE_CONFLICT');
    const source = requireTemplate(actor, before.templates, applyCommand.payload.templateId);
    if (source.status !== 'active') throw new TemplateStorageError('TEMPLATE_INVALID');
    const previous = before.applied.find((item) => item.recipeId === applyCommand.payload.recipeId);
    const timestamp = now().toISOString();
    const applied: RecipeTemplate = recipeTemplateSchema.parse({
      id: applyCommand.payload.recipeId,
      recipeId: applyCommand.payload.recipeId,
      templateId: source.id,
      templateName: source.name,
      category: source.category,
      layout: source.layout,
      sourceOwnerUserId: source.ownerUserId,
      revision: (previous?.revision ?? 0) + 1,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
    const outcome = publishTemplateMutation(
      store,
      operation(command, requestId, applied.id, actor, now),
      [{ table: 'RecipeTemplates', value: applied }],
      now,
    );
    return {
      kind: 'recipeTemplate',
      recipeId: applied.recipeId,
      template: applied,
      outcome,
    };
  } catch (error) {
    if (error instanceof AuthError || error instanceof TemplateStorageError) throw error;
    if (error instanceof Error && error.name === 'ZodError')
      throw new TemplateStorageError('TEMPLATE_INVALID');
    throw new TemplateStorageError();
  } finally {
    lock.releaseLock();
  }
}
