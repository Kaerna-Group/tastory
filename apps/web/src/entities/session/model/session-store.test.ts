import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient, ApiClientError } from '@/shared/api';
import {
  getSession,
  recheckSession,
  signIn,
  signOut,
  subscribeSession,
  requestSessionPhoto,
} from './session-store';
const data = () => ({
  user: { id: 'sub', email: 'chef@gmail.com', name: 'Chef', role: 'owner' as const },
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});
afterEach(() => {
  signOut();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('memory-only Google session', () => {
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
