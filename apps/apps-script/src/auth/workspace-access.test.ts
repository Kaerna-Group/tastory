import { describe, expect, it } from 'vitest';
import { parseWorkspaceDirectory, resolveWorkspaceAccess } from './workspace-access';

const ownerId = '11111111-1111-4111-8111-111111111111';
const readerId = '22222222-2222-4222-8222-222222222222';
const bookId = '33333333-3333-4333-8333-333333333333';
const otherBookId = '44444444-4444-4444-8444-444444444444';
const date = '2026-09-03T11:00:00Z';
function fixture() {
  return {
    users: [ownerId, readerId].map((id, index) => ({
      user_id: id,
      google_sub: `subject-${index}`,
      email: `user${index}@example.test`,
      email_normalized: `user${index}@example.test`,
      display_name: '',
      avatar_asset_id: '',
      status: 'active',
      created_at: date,
      last_login_at: '',
      row_revision: '1',
    })),
    workspaces: [
      {
        workspace_id: bookId,
        name: 'Book',
        owner_user_id: ownerId,
        default_app_theme_id: '',
        default_canvas_theme_id: '',
        created_at: date,
        updated_at: date,
        row_revision: '1',
      },
    ],
    members: [
      {
        workspace_id: bookId,
        user_id: ownerId,
        role: 'owner',
        status: 'active',
        joined_at: date,
        row_revision: '1',
      },
      {
        workspace_id: bookId,
        user_id: readerId,
        role: 'viewer',
        status: 'active',
        joined_at: date,
        row_revision: '1',
      },
    ],
  };
}
describe('server workspace access', () => {
  it('resolves the stable Google subject to an internal UUID and the stored role', () => {
    const directory = parseWorkspaceDirectory(fixture());
    expect(resolveWorkspaceAccess(directory, 'subject-0', bookId)).toEqual({
      userId: ownerId,
      workspaceId: bookId,
      role: 'owner',
    });
    expect(resolveWorkspaceAccess(directory, 'subject-1', bookId).role).toBe('viewer');
    expect(() => resolveWorkspaceAccess(directory, ownerId, bookId)).toThrow('ACCESS_DENIED');
    expect(() => resolveWorkspaceAccess(directory, 'user0@example.test', bookId)).toThrow(
      'ACCESS_DENIED',
    );
  });
  it('scopes ownership to a particular workspace and rejects an unknown workspace', () => {
    const input = fixture();
    input.workspaces.push({
      ...input.workspaces[0],
      workspace_id: otherBookId,
      name: 'Other',
      owner_user_id: readerId,
      default_app_theme_id: '',
      default_canvas_theme_id: '',
      created_at: date,
      updated_at: date,
      row_revision: '1',
    });
    input.members.push({
      workspace_id: otherBookId,
      user_id: readerId,
      role: 'owner',
      status: 'active',
      joined_at: date,
      row_revision: '1',
    });
    const directory = parseWorkspaceDirectory(input);
    expect(resolveWorkspaceAccess(directory, 'subject-1', bookId).role).toBe('viewer');
    expect(resolveWorkspaceAccess(directory, 'subject-1', otherBookId).role).toBe('owner');
    expect(() => resolveWorkspaceAccess(directory, 'subject-0', otherBookId)).toThrow(
      'ACCESS_DENIED',
    );
    expect(() => resolveWorkspaceAccess(directory, 'subject-0', 'unknown')).toThrow(
      'ACCESS_DENIED',
    );
  });
  it.each(['disabled', 'pending'])('denies a user whose status is %s', (status) => {
    const input = fixture();
    const user = input.users[0];
    if (!user) throw new Error();
    user.status = status;
    expect(() =>
      resolveWorkspaceAccess(parseWorkspaceDirectory(input), 'subject-0', bookId),
    ).toThrow('ACCESS_DENIED');
  });
  it('denies disabled or removed membership regardless of an existing identity', () => {
    const input = fixture();
    const member = input.members[1];
    if (!member) throw new Error();
    member.status = 'disabled';
    expect(() =>
      resolveWorkspaceAccess(parseWorkspaceDirectory(input), 'subject-1', bookId),
    ).toThrow('ACCESS_DENIED');
    input.members.pop();
    expect(() =>
      resolveWorkspaceAccess(parseWorkspaceDirectory(input), 'subject-1', bookId),
    ).toThrow('ACCESS_DENIED');
  });
  it.each(['users', 'members', 'workspaces'] as const)('fails closed for duplicate %s', (table) => {
    const input = fixture();
    const row = input[table][0];
    if (!row) throw new Error();
    expect(() => parseWorkspaceDirectory({ ...input, [table]: [...input[table], row] })).toThrow(
      'AUTH_UNAVAILABLE',
    );
  });
  it('rejects duplicate Google subjects or normalized emails', () => {
    const input = fixture();
    const second = input.users[1];
    if (!second) throw new Error();
    second.google_sub = 'subject-0';
    expect(() => parseWorkspaceDirectory(input)).toThrow('AUTH_UNAVAILABLE');
    second.google_sub = 'subject-1';
    second.email_normalized = 'user0@example.test';
    expect(() => parseWorkspaceDirectory(input)).toThrow('AUTH_UNAVAILABLE');
  });
  it('rejects dangling membership and inconsistent workspace ownership', () => {
    const input = fixture();
    const member = input.members[1];
    if (!member) throw new Error();
    member.user_id = otherBookId;
    expect(() => parseWorkspaceDirectory(input)).toThrow('AUTH_UNAVAILABLE');
    member.user_id = readerId;
    member.workspace_id = otherBookId;
    expect(() => parseWorkspaceDirectory(input)).toThrow('AUTH_UNAVAILABLE');
    member.workspace_id = bookId;
    member.role = 'owner';
    expect(() => parseWorkspaceDirectory(input)).toThrow('AUTH_UNAVAILABLE');
    input.members.shift();
    expect(() => parseWorkspaceDirectory(input)).toThrow('AUTH_UNAVAILABLE');
  });
  it('rejects unknown roles, revisions and extra identity fields', () => {
    const input = fixture();
    const member = input.members[1];
    if (!member) throw new Error();
    member.role = 'superadmin';
    expect(() => parseWorkspaceDirectory(input)).toThrow('AUTH_UNAVAILABLE');
    member.role = 'viewer';
    member.row_revision = '0';
    expect(() => parseWorkspaceDirectory(input)).toThrow('AUTH_UNAVAILABLE');
    member.row_revision = '1';
    expect(() =>
      parseWorkspaceDirectory({
        ...input,
        users: input.users.map((user) => ({ ...user, role: 'owner' })),
      }),
    ).toThrow('AUTH_UNAVAILABLE');
  });
});
