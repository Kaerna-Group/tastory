export type TemplateActor = Readonly<{
  userId: string;
  workspaceId: string;
  role: 'owner' | 'member' | 'viewer';
}>;
export type TemplateAccess = Readonly<{
  workspaceId: string | null;
  ownerUserId: string | null;
  kind: 'builtin' | 'custom';
  visibility: 'private' | 'workspace';
}>;

export function canReadTemplate(actor: TemplateActor, template: TemplateAccess): boolean {
  return (
    template.kind === 'builtin' ||
    (template.workspaceId === actor.workspaceId &&
      (template.visibility === 'workspace' ||
        template.ownerUserId === actor.userId ||
        actor.role === 'owner'))
  );
}

export function canManageTemplate(actor: TemplateActor, template: TemplateAccess): boolean {
  return (
    template.kind === 'custom' &&
    template.workspaceId === actor.workspaceId &&
    actor.role !== 'viewer' &&
    (template.ownerUserId === actor.userId || actor.role === 'owner')
  );
}

export function canCopyTemplate(actor: TemplateActor, template: TemplateAccess): boolean {
  return (
    actor.role !== 'viewer' &&
    canReadTemplate(actor, template) &&
    (template.kind === 'builtin' || template.ownerUserId !== actor.userId)
  );
}
