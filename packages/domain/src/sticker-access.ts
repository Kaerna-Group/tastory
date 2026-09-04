export type StickerActor = Readonly<{
  userId: string;
  workspaceId: string;
  role: 'owner' | 'member' | 'viewer';
}>;
export type StickerPackAccess = Readonly<{
  workspaceId: string | null;
  ownerUserId: string | null;
  kind: 'builtin' | 'custom';
  visibility: 'private' | 'workspace';
}>;

export function canReadStickerPack(actor: StickerActor, pack: StickerPackAccess): boolean {
  return (
    pack.kind === 'builtin' ||
    (pack.workspaceId === actor.workspaceId &&
      (pack.visibility === 'workspace' ||
        pack.ownerUserId === actor.userId ||
        actor.role === 'owner'))
  );
}

export function canManageStickerPack(actor: StickerActor, pack: StickerPackAccess): boolean {
  return (
    pack.kind === 'custom' &&
    pack.workspaceId === actor.workspaceId &&
    actor.role !== 'viewer' &&
    (pack.ownerUserId === actor.userId || actor.role === 'owner')
  );
}
