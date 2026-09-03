import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient, ApiClientError } from '@/shared/api';
import { accessCheck } from './access-check';
import {
  getSession,
  recheckSession,
  signIn,
  signOut,
  subscribeSession,
  requestSessionPhoto,
  requestSessionConcurrency,
} from './session-store';
const data = () => ({
  requestId: 'c3dcd2e8-e2f8-428b-9e26-3e715f678fac',
  user: { id: 'sub', email: 'chef@gmail.com', name: 'Chef', role: 'owner' as const },
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});
afterEach(() => {
  signOut();
  accessCheck.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('memory-only Google session', () => {
  it('records only completed auth requests and explicit logout, preserving no credential or profile', async () => {
    const authenticate = vi.spyOn(apiClient, 'authenticate').mockResolvedValue(data());
    accessCheck.start('https://example.test/', 'Browser');
    await signIn('sensitive-token');
    await recheckSession();
    signOut();
    await signIn('sensitive-token');
    authenticate.mockRejectedValue(
      new ApiClientError('ACCESS_DENIED', 'private server detail', data().requestId),
    );
    await recheckSession();
    const report = accessCheck.getSnapshot().report;
    expect(report?.events.map((event) => event.action)).toEqual([
      'auth.signIn',
      'auth.me',
      'signOut',
      'auth.signIn',
      'auth.me',
    ]);
    expect(report?.checks.repeatedSignIn).toBe(true);
    expect(report?.checks.revokedSession).toBe(true);
    expect(report?.events.at(-1)?.requestId).toBe(data().requestId);
    expect(JSON.stringify(report)).not.toMatch(
      /sensitive-token|chef@gmail|Chef|private server detail|"sub"/,
    );
  });
  it('does not classify errors as revocation or record cancelled auth responses', async () => {
    const authenticate = vi.spyOn(apiClient, 'authenticate').mockResolvedValue(data());
    accessCheck.start('https://example.test/', 'Browser');
    await signIn('token');
    authenticate.mockRejectedValue(new Error('private network detail'));
    await recheckSession();
    expect(accessCheck.getSnapshot().report?.events.at(-1)?.errorCode).toBe('UNKNOWN_ERROR');
    expect(accessCheck.getSnapshot().report?.checks.revokedSession).toBe(false);
    let finish: ((value: ReturnType<typeof data>) => void) | undefined;
    authenticate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = signIn('token');
    signOut();
    finish?.(data());
    await pending;
    expect(
      accessCheck.getSnapshot().report?.events.filter((event) => event.outcome === 'allowed'),
    ).toHaveLength(1);
  });
  it('uses the same cancellable private session for concurrency checks', async () => {
    const command = {
      action: 'spike.concurrency.read',
      payload: { runId: 'c3dcd2e8-e2f8-428b-9e26-3e715f678fac' },
    } as const;
    vi.spyOn(apiClient, 'authenticate').mockResolvedValue(data());
    vi.spyOn(apiClient, 'concurrency').mockRejectedValue(
      new ApiClientError('UNAUTHENTICATED', 'Войдите снова.'),
    );
    await signIn('token');
    await expect(requestSessionConcurrency(command)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(apiClient.concurrency).toHaveBeenCalledWith(command, 'token', expect.any(AbortSignal));
    expect(getSession().status).toBe('signed-out');
  });
  it('uses the memory credential for photos and clears revoked sessions', async () => {
    const command = { action: 'spike.photo.read', payload: {} } as const;
    await expect(requestSessionPhoto(command)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    vi.spyOn(apiClient, 'authenticate').mockResolvedValue(data());
    const photo = vi
      .spyOn(apiClient, 'photo')
      .mockResolvedValue({ photo: null, thumbnailBase64: null });
    await signIn('sensitive-token');
    await requestSessionPhoto(command, new AbortController().signal);
    expect(photo).toHaveBeenCalledWith(command, 'sensitive-token', expect.any(AbortSignal));
    photo.mockRejectedValue(new ApiClientError('ACCESS_DENIED', 'Доступ отозван.'));
    await expect(requestSessionPhoto(command)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    expect(getSession().status).toBe('signed-out');
  });
  it('logout prevents late photo responses from restoring private data', async () => {
    vi.spyOn(apiClient, 'authenticate').mockResolvedValue(data());
    let resolve: ((value: { photo: null; thumbnailBase64: null }) => void) | undefined;
    vi.spyOn(apiClient, 'photo').mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await signIn('token');
    const request = requestSessionPhoto({ action: 'spike.photo.read', payload: {} });
    signOut();
    resolve?.({ photo: null, thumbnailBase64: null });
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('keeps credentials out of the view state, rechecks and expires', async () => {
    vi.useFakeTimers();
    const authenticate = vi.spyOn(apiClient, 'authenticate').mockResolvedValue(data());
    const listener = vi.fn();
    const unsubscribe = subscribeSession(listener);
    await signIn('sensitive-id-token');
    expect(getSession()).toMatchObject({ status: 'signed-in', user: { id: 'sub' } });
    expect(JSON.stringify(getSession())).not.toContain('sensitive-id-token');
    await recheckSession();
    expect(authenticate).toHaveBeenLastCalledWith(
      'sensitive-id-token',
      'auth.me',
      expect.any(AbortSignal),
    );
    vi.advanceTimersByTime(60_001);
    expect(getSession().status).toBe('signed-out');
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
  it('logout cancels in-flight sign-in; late response cannot restore access', async () => {
    let resolve: ((value: ReturnType<typeof data>) => void) | undefined;
    vi.spyOn(apiClient, 'authenticate').mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const login = signIn('token');
    signOut();
    resolve?.(data());
    await login;
    expect(getSession().status).toBe('signed-out');
  });
  it('clears revoked access and handles transport failures without leaking errors', async () => {
    vi.spyOn(apiClient, 'authenticate').mockRejectedValue(
      new ApiClientError('ACCESS_DENIED', 'Нет доступа.'),
    );
    await signIn('token');
    expect(getSession()).toMatchObject({ status: 'signed-out', message: 'Нет доступа.' });
    vi.mocked(apiClient.authenticate).mockRejectedValue(new Error('private credential'));
    await signIn('token');
    expect(JSON.stringify(getSession())).not.toContain('private');
    await recheckSession();
    expect(getSession().message).toBe('Войдите в Google.');
  });
  it('ignores rejected cancelled requests', async () => {
    let reject: ((error: Error) => void) | undefined;
    vi.spyOn(apiClient, 'authenticate').mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const login = signIn('token');
    signOut();
    reject?.(new Error('cancelled'));
    await login;
    expect(getSession().message).toBe('');
  });
});
