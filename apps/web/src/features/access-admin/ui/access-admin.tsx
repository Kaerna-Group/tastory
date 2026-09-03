import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getSession, subscribeSession, requestSessionAccess } from '@/entities/session';
import { ApiClientError } from '@/shared/api';
import type { AccessCommand, AccessData } from '../model/types';

const roles = { owner: 'Владелец', member: 'Участник', viewer: 'Читатель' };
const statuses = {
  pending: 'Ожидает входа',
  used: 'Принято',
  revoked: 'Отозвано',
  expired: 'Срок истёк',
};
type Snapshot = Extract<AccessData, { kind: 'access' }>;
type Attempt = { command: AccessCommand; id: string };
export function AccessAdmin(): React.JSX.Element | null {
  const session = useSyncExternalStore(subscribeSession, getSession);
  return session.status === 'signed-in' && session.user?.role === 'owner' ? (
    <Panel key={session.user.id} />
  ) : null;
}
function Panel(): React.JSX.Element {
  const [data, setData] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [email, setEmail] = useState(''),
    [role, setRole] = useState<'member' | 'viewer'>('viewer'),
    [days, setDays] = useState(7);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function run(command: AccessCommand, repeated?: Attempt) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    setMessage('');
    const current = repeated ?? { command, id: crypto.randomUUID() };
    const writing = current.command.action !== 'admin.access.list';
    if (writing) setAttempt(current);
    setData(null);
    try {
      const result = await requestSessionAccess(current.command, current.id, controller.signal);
      if (controller.signal.aborted) return;
      if (result.kind === 'saved') {
        setAttempt(null);
        setMessage(
          result.outcome === 'replayed'
            ? 'Изменение уже сохранено. Повтор не создал дубликат.'
            : 'Изменение сохранено и записано в аудит.',
        );
        if (current.command.action === 'admin.invites.create') setEmail('');
        const fresh = await requestSessionAccess(
          { action: 'admin.access.list', payload: {} },
          crypto.randomUUID(),
          controller.signal,
        );
        if (!controller.signal.aborted && fresh.kind === 'access') setData(fresh);
      } else setData(result);
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (
          cause instanceof ApiClientError &&
          [
            'ACCESS_CONFLICT',
            'ACCESS_INVALID',
            'ACCESS_LIMIT',
            'ACCESS_PENDING',
            'OPERATION_MISMATCH',
            'INVALID_REQUEST',
            'JOURNAL_NOT_READY',
            'JOURNAL_LIMIT',
          ].includes(cause.code)
        )
          setAttempt(null);
        setError(
          cause instanceof ApiClientError
            ? cause.message
            : 'Не удалось завершить запрос. Попробуйте снова.',
        );
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (pending.current === controller) pending.current = null;
    }
  }
  const blocked = busy || Boolean(attempt) || Boolean(data?.pending.length);
  return (
    <section className="panel workspace-admin" aria-labelledby="access-title">
      <p className="eyebrow">Для владельца</p>
      <h2 id="access-title">Приглашения и права</h2>
      <p className="muted">
        Пригласите человека по адресу Google или измените доступ участника. Читатель просматривает
        материалы, участник сможет добавлять и редактировать рецепты, когда они появятся.
      </p>
      <div className="flex flex-wrap gap-3 mb-6">
        <button
          className="button button-secondary"
          disabled={busy}
          onClick={() => {
            void run({ action: 'admin.access.list', payload: {} });
          }}
        >
          {data ? 'Обновить доступ' : 'Открыть управление доступом'}
        </button>
        {attempt && (
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={() => {
              void run(attempt.command, attempt);
            }}
          >
            Повторить это изменение
          </button>
        )}
      </div>
      {busy && <p role="status">Сохраняем или проверяем доступ. Это может занять около минуты.</p>}
      {!busy && message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          {data.pending.map((operation) => (
            <div key={operation.id} className="workspace-health">
              <p>Есть незавершённое изменение. Завершите его перед следующей записью.</p>
              {operation.canResume && (
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => {
                    void run({
                      action: 'admin.access.resume',
                      payload: { operationId: operation.id },
                    });
                  }}
                >
                  Завершить изменение
                </button>
              )}
            </div>
          ))}
          <form
            className="access-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run({
                action: 'admin.invites.create',
                payload: { email: email.trim(), role, days, expectedRevision: data.revision },
              });
            }}
          >
            <h3>Новое приглашение</h3>
            <label>
              Email Google
              <input
                type="email"
                required
                maxLength={254}
                value={email}
                disabled={blocked}
                autoComplete="off"
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Роль приглашённого
              <select
                value={role}
                disabled={blocked}
                onChange={(event) => setRole(event.target.value === 'member' ? 'member' : 'viewer')}
              >
                <option value="viewer">Читатель</option>
                <option value="member">Участник</option>
              </select>
            </label>
            <label>
              Срок приглашения
              <select
                value={days}
                disabled={blocked}
                onChange={(event) => setDays(Number(event.target.value))}
              >
                <option value={1}>1 день</option>
                <option value={7}>7 дней</option>
                <option value={30}>30 дней</option>
              </select>
            </label>
            <button className="button button-secondary" type="submit" disabled={blocked}>
              Создать приглашение
            </button>
            <p className="muted text-sm">
              После создания передайте человеку{' '}
              <a href={`${location.origin}${location.pathname}#/settings`}>
                ссылку на настройки Tastory
              </a>
              . Нужно войти через Google с указанным адресом. Письмо автоматически не отправляется.
            </p>
          </form>
          <h3>Приглашения</h3>
          {!data.invites.length && <p className="muted">Приглашений пока нет.</p>}
          <ul className="member-list" aria-label="Приглашения">
            {[...data.invites].reverse().map((invite) => (
              <li className="member-row" key={invite.id}>
                <div className="member-identity">
                  <p>{invite.email}</p>
                  <p className="muted text-sm">
                    {roles[invite.role]} · До {new Date(invite.expiresAt).toLocaleString('ru-RU')}
                  </p>
                </div>
                <div className="member-access">
                  <span>{statuses[invite.status]}</span>
                  {invite.status === 'pending' && (
                    <button
                      className="button button-secondary"
                      disabled={blocked}
                      onClick={() => {
                        void run({
                          action: 'admin.invites.revoke',
                          payload: { inviteId: invite.id, expectedRevision: data.revision },
                        });
                      }}
                    >
                      Отозвать приглашение
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <h3>Доступ участников</h3>
          <ul className="member-list" aria-label="Управление участниками">
            {data.members.map((member) => (
              <Member
                key={`${member.id}:${data.revision}`}
                member={member}
                disabled={blocked}
                save={(nextRole, status) => {
                  void run({
                    action: 'admin.members.update',
                    payload: {
                      userId: member.id,
                      role: nextRole,
                      status,
                      expectedRevision: data.revision,
                    },
                  });
                }}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
function Member({
  member,
  disabled,
  save,
}: {
  member: Snapshot['members'][number];
  disabled: boolean;
  save: (role: 'member' | 'viewer', status: 'active' | 'disabled') => void;
}) {
  const [role, setRole] = useState<'member' | 'viewer'>(
    member.role === 'member' ? 'member' : 'viewer',
  );
  const fixed = member.role === 'owner' || !member.accountActive;
  return (
    <li className="member-row">
      <div className="member-identity">
        <p>{member.name}</p>
        {member.name !== member.email && <p className="muted text-sm">{member.email}</p>}
        <p className="muted text-sm">
          {!member.accountActive
            ? 'Аккаунт отключён'
            : member.status === 'active'
              ? 'Доступ открыт'
              : 'Доступ отключён'}
        </p>
      </div>
      <div className="member-access">
        {fixed ? (
          <span>
            {roles[member.role]}
            {member.role === 'owner' ? ' · защищён от отключения' : ''}
          </span>
        ) : (
          <>
            <label>
              Роль для {member.email}
              <select
                aria-label={`Роль для ${member.email}`}
                value={role}
                disabled={disabled}
                onChange={(event) => setRole(event.target.value === 'member' ? 'member' : 'viewer')}
              >
                <option value="viewer">Читатель</option>
                <option value="member">Участник</option>
              </select>
            </label>
            <button
              className="button button-secondary"
              disabled={disabled || role === member.role}
              onClick={() => save(role, member.status)}
            >
              Сохранить роль
            </button>
            <button
              className="button button-secondary"
              disabled={disabled}
              onClick={() =>
                save(
                  member.role === 'member' ? 'member' : 'viewer',
                  member.status === 'active' ? 'disabled' : 'active',
                )
              }
            >
              {member.status === 'active' ? 'Отключить доступ' : 'Вернуть доступ'}
            </button>
          </>
        )}
      </div>
    </li>
  );
}
