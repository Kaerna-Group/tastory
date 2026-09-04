import { apiClient, ApiClientError } from '@/shared/api';
import type {
  AuthData,
  PhotoCommand,
  ConcurrencyCommand,
  JournalAction,
  AccessCommand,
  RecipeCommand,
  BackupCommand,
  UserSettingsCommand,
} from '@tastory/contracts';
import { accessCheck } from './access-check';

export type SessionState = Readonly<{
  status: 'signed-out' | 'checking' | 'signed-in';
  user: AuthData['user'] | null;
  message: string;
}>;
const initial: SessionState = { status: 'signed-out', user: null, message: '' };
let snapshot = initial;
// Credentials deliberately stay in this closure: no storage, URL, query cache or logs.
let credential: string | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let pending: AbortController | undefined;
const listeners = new Set<() => void>();
const protectedRequests = new Set<AbortController>();
function update(value: SessionState) {
  snapshot = value;
  listeners.forEach((listener) => listener());
}
export const getSession = () => snapshot;
export function subscribeSession(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function resetSession(message = '') {
  protectedRequests.forEach((controller) => controller.abort());
  protectedRequests.clear();
  pending?.abort();
  pending = undefined;
  clearTimeout(expiryTimer);
  credential = null;
  update({ ...initial, message });
}
export function signOut(message = '') {
  const userId = snapshot.user?.id ?? null;
  resetSession(message);
  accessCheck.record(accessCheck.captureId(), {
    action: 'signOut',
    outcome: 'signed-out',
    userId,
    role: null,
    requestId: null,
    errorCode: null,
    elapsedMs: 0,
  });
}
export async function signIn(token: string, action: 'auth.signIn' | 'auth.me' = 'auth.signIn') {
  const captureId = accessCheck.captureId();
  const previousUserId = action === 'auth.me' ? (snapshot.user?.id ?? null) : null;
  const start = performance.now();
  resetSession();
  const controller = new AbortController();
  pending = controller;
  update({ status: 'checking', user: null, message: 'Проверяем доступ…' });
  try {
    const result = await apiClient.authenticate(token, action, controller.signal);
    if (controller.signal.aborted) return;
    accessCheck.record(captureId, {
      action,
      outcome: 'allowed',
      userId: result.user.id,
      role: result.user.role,
      requestId: result.requestId,
      errorCode: null,
      elapsedMs: Math.round(performance.now() - start),
    });
    credential = token;
    update({
      status: 'signed-in',
      user: result.user,
      message: 'Вход выполнен. Доступ подтверждён.',
    });
    expiryTimer = setTimeout(
      () => resetSession('Срок входа истёк. Войдите снова.'),
      Math.min(Math.max(0, Date.parse(result.expiresAt) - Date.now()), 7_200_000),
    );
  } catch (error) {
    if (!controller.signal.aborted) {
      accessCheck.record(captureId, {
        action,
        outcome:
          error instanceof ApiClientError && error.code === 'ACCESS_DENIED' ? 'denied' : 'error',
        userId: previousUserId,
        role: null,
        requestId: error instanceof ApiClientError ? error.requestId : null,
        errorCode: error instanceof ApiClientError ? error.code : 'UNKNOWN_ERROR',
        elapsedMs: Math.round(performance.now() - start),
      });
      resetSession(
        error instanceof ApiClientError
          ? error.message
          : 'Не удалось проверить вход. Попробуйте снова.',
      );
    }
  } finally {
    if (pending === controller) pending = undefined;
  }
}
export async function recheckSession() {
  if (credential) await signIn(credential, 'auth.me');
  else resetSession('Войдите в Google.');
}
export async function requestSessionPhoto(command: PhotoCommand, signal?: AbortSignal) {
  return protectedRequest((token, combined) => apiClient.photo(command, token, combined), signal);
}
export async function requestSessionConcurrency(command: ConcurrencyCommand, signal?: AbortSignal) {
  return protectedRequest(
    (token, combined) => apiClient.concurrency(command, token, combined),
    signal,
  );
}
export async function requestSessionAccess(
  command: AccessCommand,
  requestId: string,
  signal?: AbortSignal,
) {
  return protectedRequest(
    (token, combined) => apiClient.access(command, token, requestId, combined),
    signal,
  );
}
export async function requestSessionUsers(signal?: AbortSignal) {
  return protectedRequest((token, combined) => apiClient.adminUsers(token, combined), signal);
}
export async function requestSessionBackups(
  command: BackupCommand,
  requestId: string,
  signal?: AbortSignal,
) {
  return protectedRequest(
    (token, combined) => apiClient.backups(command, token, requestId, combined),
    signal,
  );
}
export async function requestSessionRecipes(
  command: RecipeCommand,
  requestId: string,
  signal?: AbortSignal,
) {
  return protectedRequest(
    (token, combined) => apiClient.recipes(command, token, requestId, combined),
    signal,
  );
}
export async function requestSessionSettings(
  command: UserSettingsCommand,
  requestId: string,
  signal?: AbortSignal,
) {
  return protectedRequest(
    (token, combined) => apiClient.settings(command, token, requestId, combined),
    signal,
  );
}
export async function requestSessionHealth(signal?: AbortSignal) {
  return protectedRequest((token, combined) => apiClient.adminHealth(token, combined), signal);
}
export async function requestSessionJournal(
  action: JournalAction,
  requestId: string,
  signal?: AbortSignal,
) {
  return protectedRequest(
    (token, combined) => apiClient.journal(action, token, requestId, combined),
    signal,
  );
}
async function protectedRequest<T>(
  request: (token: string, signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
) {
  if (!credential || snapshot.status !== 'signed-in')
    throw new ApiClientError('UNAUTHENTICATED', 'Войдите в Google.');
  const controller = new AbortController();
  protectedRequests.add(controller);
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  try {
    combined.throwIfAborted();
    const result = await request(credential, combined);
    combined.throwIfAborted();
    return result;
  } catch (error) {
    if (
      !combined.aborted &&
      error instanceof ApiClientError &&
      (error.code === 'UNAUTHENTICATED' || error.code === 'ACCESS_DENIED')
    )
      resetSession(error.message);
    throw error;
  } finally {
    protectedRequests.delete(controller);
  }
}
