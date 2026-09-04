import { describe, expect, it } from 'vitest';
import { canCopyTemplate, canManageTemplate, canReadTemplate } from './template-access';

const template = {
  workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ownerUserId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  kind: 'custom' as const,
  visibility: 'private' as const,
};
const actor = (
  role: 'owner' | 'member' | 'viewer',
  userId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
) => ({ userId, workspaceId: template.workspaceId, role });

describe('recipe template access', () => {
  it('keeps a private custom template between its creator and workspace owner', () => {
    expect(canReadTemplate(actor('member'), template)).toBe(false);
    expect(canReadTemplate(actor('viewer'), template)).toBe(false);
    expect(canReadTemplate(actor('member', template.ownerUserId), template)).toBe(true);
    expect(canReadTemplate(actor('owner'), template)).toBe(true);
  });

  it('allows current users to read shared and builtin templates', () => {
    for (const role of ['owner', 'member', 'viewer'] as const) {
      expect(canReadTemplate(actor(role), { ...template, visibility: 'workspace' })).toBe(true);
      expect(
        canReadTemplate(actor(role), {
          ...template,
          kind: 'builtin',
          workspaceId: null,
          ownerUserId: null,
        }),
      ).toBe(true);
    }
  });

  it('lets writers copy public foreign templates into their own library', () => {
    const shared = { ...template, visibility: 'workspace' as const };
    expect(canCopyTemplate(actor('member'), shared)).toBe(true);
    expect(canCopyTemplate(actor('viewer'), shared)).toBe(false);
    expect(canCopyTemplate(actor('member', template.ownerUserId), shared)).toBe(false);
    expect(
      canCopyTemplate(actor('member'), {
        ...shared,
        kind: 'builtin',
        workspaceId: null,
        ownerUserId: null,
      }),
    ).toBe(true);
  });

  it('only lets the creator or workspace owner manage custom templates', () => {
    expect(canManageTemplate(actor('member'), template)).toBe(false);
    expect(canManageTemplate(actor('viewer', template.ownerUserId), template)).toBe(false);
    expect(canManageTemplate(actor('member', template.ownerUserId), template)).toBe(true);
    expect(canManageTemplate(actor('owner'), template)).toBe(true);
    expect(canManageTemplate(actor('owner'), { ...template, kind: 'builtin' })).toBe(false);
  });
});
