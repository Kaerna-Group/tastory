import { describe, expect, it, vi } from 'vitest';
import { createAccessCheck } from './access-check';

const allowed = {
  action: 'auth.signIn' as const,
  outcome: 'allowed' as const,
  userId: 'private-google-sub',
  role: 'viewer' as const,
  requestId: 'c3dcd2e8-e2f8-428b-9e26-3e715f678fac',
  errorCode: null,
  elapsedMs: 1200,
};
const logout = {
  ...allowed,
  action: 'signOut' as const,
  outcome: 'signed-out' as const,
  requestId: null,
  role: null,
  elapsedMs: 0,
};
const denied = {
  ...allowed,
  action: 'auth.me' as const,
  outcome: 'denied' as const,
  role: null,
  errorCode: 'ACCESS_DENIED',
};
function fixture() {
  let nextId = 0;
  const check = createAccessCheck(
    () => '2026-09-03T10:00:00.000Z',
    () => `run-${++nextId}`,
  );
  check.start(
    'https://kaerna-group.github.io/tastory/?secret=not-recorded#settings',
    'Test browser',
  );
  return check;
}

describe('explicit access evidence recording', () => {
  it('records repeat, denial, revocation and restoration with anonymous local aliases', () => {
    const check = fixture();
    const capture = check.captureId();
    check.record(capture, allowed);
    check.record(capture, logout);
    check.record(capture, allowed);
    check.record(capture, { ...denied, action: 'auth.signIn', userId: null });
    check.record(capture, denied);
    check.record(capture, allowed);
    check.finish();
    const state = check.getSnapshot();
    expect(state.recording).toBe(false);
    expect(state.report?.checks).toEqual({
      repeatedSignIn: true,
      deniedSignIn: true,
      revokedSession: true,
      restoredAccess: true,
    });
    expect(state.report?.events[0]).toMatchObject({
      account: 'account-1',
      requestId: allowed.requestId,
    });
    expect(state.report?.events[3]?.account).toBeNull();
    expect(state.report?.origin).toBe('https://kaerna-group.github.io');
    expect(state.report?.stopReason).toBe('user');
    expect(JSON.stringify(state)).not.toMatch(/private-google-sub|secret|userId/);
  });

  it('does not confuse different accounts, transport errors or expiry with evidence', () => {
    const check = fixture();
    const capture = check.captureId();
    check.record(capture, allowed);
    check.record(capture, logout);
    check.record(capture, { ...allowed, userId: 'another-private-sub' });
    check.record(capture, { ...denied, errorCode: 'TRANSPORT_ERROR', outcome: 'error' });
    check.record(capture, { ...denied, errorCode: 'UNAUTHENTICATED', outcome: 'error' });
    check.record(capture, { ...denied, userId: 'never-admitted' });
    expect(check.getSnapshot().report?.checks).toEqual({
      repeatedSignIn: false,
      deniedSignIn: false,
      revokedSession: false,
      restoredAccess: false,
    });
    check.record(capture, denied);
    check.record(capture, { ...allowed, userId: 'another-private-sub' });
    expect(check.getSnapshot().report?.checks.restoredAccess).toBe(false);
  });

  it('ignores unrecorded, stopped, cleared and previous-run callbacks; forgets aliases on restart', () => {
    const check = createAccessCheck();
    check.record(null, allowed);
    check.finish();
    expect(check.getSnapshot().report).toBeNull();
    check.start('https://example.test/', 'x'.repeat(600));
    const first = check.captureId();
    check.record(first, allowed);
    check.finish();
    check.record(first, denied);
    expect(check.getSnapshot().report?.events).toHaveLength(1);
    expect(check.getSnapshot().report?.browser).toHaveLength(512);
    check.clear();
    check.record(first, allowed);
    expect(check.getSnapshot().report).toBeNull();
    check.start('https://example.test/', 'Browser');
    check.record(first, allowed);
    check.record(check.captureId(), { ...allowed, userId: 'different' });
    expect(check.getSnapshot().report?.events).toHaveLength(1);
    expect(check.getSnapshot().report?.events[0]?.account).toBe('account-1');
  });

  it('bounds capture and isolates diagnostic listeners from authentication', () => {
    const check = fixture();
    const listener = vi.fn();
    const stop = check.subscribe(listener);
    const stopThrowing = check.subscribe(() => {
      throw new Error('diagnostic listener');
    });
    const capture = check.captureId();
    for (let i = 0; i < 35; i += 1) check.record(capture, allowed);
    expect(check.getSnapshot().report?.events).toHaveLength(30);
    expect(check.getSnapshot().report?.stopReason).toBe('limit');
    expect(check.getSnapshot().recording).toBe(false);
    expect(listener).toHaveBeenCalled();
    stop();
    stopThrowing();
    const calls = listener.mock.calls.length;
    check.clear();
    expect(listener).toHaveBeenCalledTimes(calls);
  });
});
