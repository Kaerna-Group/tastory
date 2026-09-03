import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AdminUsersData, AdminHealthData } from '../model/types';
import {
  getSession,
  subscribeSession,
  requestSessionUsers,
  requestSessionHealth,
} from '@/entities/session';
import { ApiClientError } from '@/shared/api';

const roles = { owner: 'Владелец', member: 'Участник', viewer: 'Читатель' };
const time = (value: string) =>
  new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export function WorkspaceAdmin(): React.JSX.Element | null {
  const session = useSyncExternalStore(subscribeSession, getSession);
  return session.status === 'signed-in' && session.user?.role === 'owner' ? (
    <OwnerDirectory key={session.user.id} />
  ) : null;
}

function OwnerDirectory(): React.JSX.Element {
  const [users, setUsers] = useState<AdminUsersData | null>(null);
  const [health, setHealth] = useState<AdminHealthData | null>(null);
  const [busy, setBusy] = useState<'users' | 'health' | null>(null);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [],
  );

  async function load(kind: 'users' | 'health') {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(kind);
    setError('');
    if (kind === 'users') setUsers(null);
    else setHealth(null);
    try {
      if (kind === 'users') {
        const data = await requestSessionUsers(controller.signal);
        if (!controller.signal.aborted) setUsers(data);
      } else {
        const data = await requestSessionHealth(controller.signal);
        if (!controller.signal.aborted) setHealth(data);
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof ApiClientError
            ? cause.message
            : 'Не удалось загрузить данные. Попробуйте снова.',
        );
    } finally {
      if (!controller.signal.aborted) setBusy(null);
      if (pending.current === controller) pending.current = null;
    }
  }

  return (
    <section className="panel workspace-admin" aria-labelledby="members-title">
      <p className="eyebrow">Для владельца</p>
      <h2 id="members-title">Участники тетради</h2>
      <p className="muted">Кто может пользоваться тетрадью и какой доступ ему открыт.</p>
      <div className="flex flex-wrap gap-3 mb-6">
        <button
          className="button button-secondary"
          type="button"
          disabled={busy !== null}
          onClick={() => {
            void load('users');
          }}
        >
          {busy === 'users'
            ? 'Загружаем участников…'
            : users
              ? 'Обновить список'
              : 'Показать участников'}
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={busy !== null}
          onClick={() => {
            void load('health');
          }}
        >
          {busy === 'health' ? 'Проверяем таблицы…' : 'Проверить таблицы'}
        </button>
      </div>
      {busy && (
        <p className="muted" role="status">
          {busy === 'users'
            ? 'Читаем список участников.'
            : 'Проверяем структуру таблиц и состав участников.'}{' '}
          Это может занять около минуты.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {users && (
        <>
          <p className="muted text-sm">
            {users.workspace.name} · Участников: {users.users.length} · Обновлено в{' '}
            {time(users.checkedAt)}
          </p>
          <ul className="member-list" aria-label="Участники тетради">
            {users.users.map((user) => (
              <li className="member-row" key={user.id}>
                <div className="member-identity">
                  <p className="font-semibold">{user.displayName || user.email}</p>
                  {user.displayName && <p className="muted text-sm">{user.email}</p>}
                </div>
                <div className="member-access">
                  <span className="member-role">{roles[user.role]}</span>
                  <span className="muted text-sm">
                    {user.userStatus === 'disabled'
                      ? 'Аккаунт отключён'
                      : user.userStatus === 'pending'
                        ? 'Ожидает активации'
                        : user.membershipStatus === 'disabled'
                          ? 'Доступ отключён'
                          : 'Доступ открыт'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {health && (
        <div className="workspace-health" role="status">
          <p className="font-semibold">Структура таблиц в порядке</p>
          <p className="muted text-sm">
            Проверено таблиц: {health.tablesChecked}. Доступ открыт: {health.activeMembers} из{' '}
            {health.members} участников. Проверено в {time(health.checkedAt)}.
          </p>
        </div>
      )}
    </section>
  );
}
