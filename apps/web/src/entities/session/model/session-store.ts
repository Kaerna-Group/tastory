import { apiClient, ApiClientError } from '@/shared/api';
import type { AuthData } from '@tastory/contracts';

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
export function signOut(message = '') {
  pending?.abort();
  pending = undefined;
  clearTimeout(expiryTimer);
  credential = null;
  update({ ...initial, message });
}
export async function signIn(token: string, action: 'auth.signIn' | 'auth.me' = 'auth.signIn') {
  signOut();
  const controller = new AbortController();
  pending = controller;
  update({ status: 'checking', user: null, message: 'Проверяем доступ…' });
  try {
    const result = await apiClient.authenticate(token, action, controller.signal);
    if (controller.signal.aborted) return;
    credential = token;
    update({
      status: 'signed-in',
      user: result.user,
      message: 'Вход выполнен. Доступ подтверждён.',
    });
    expiryTimer = setTimeout(
      () => signOut('Срок входа истёк. Войдите снова.'),
      Math.min(Math.max(0, Date.parse(result.expiresAt) - Date.now()), 7_200_000),
    );
  } catch (error) {
    if (!controller.signal.aborted)
      signOut(
        error instanceof ApiClientError
          ? error.message
          : 'Не удалось проверить вход. Попробуйте снова.',
      );
  } finally {
    if (pending === controller) pending = undefined;
  }
}
export async function recheckSession() {
  if (credential) await signIn(credential, 'auth.me');
  else signOut('Войдите в Google.');
}
