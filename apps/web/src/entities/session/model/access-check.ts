export type AccessEvent = Readonly<{
  at: string;
  action: 'auth.signIn' | 'auth.me' | 'signOut';
  outcome: 'allowed' | 'denied' | 'error' | 'signed-out';
  account: string | null;
  role: 'owner' | 'member' | 'viewer' | null;
  requestId: string | null;
  errorCode: string | null;
  elapsedMs: number;
}>;
type Checks = Readonly<{
  repeatedSignIn: boolean;
  deniedSignIn: boolean;
  revokedSession: boolean;
  restoredAccess: boolean;
}>;
export type AccessReport = Readonly<{
  formatVersion: 1;
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  stopReason: 'user' | 'limit' | null;
  origin: string;
  browser: string;
  checks: Checks;
  events: readonly AccessEvent[];
}>;
type State = Readonly<{ recording: boolean; report: AccessReport | null }>;
type Observation = Omit<AccessEvent, 'at' | 'account'> & { userId: string | null };
const emptyChecks: Checks = {
  repeatedSignIn: false,
  deniedSignIn: false,
  revokedSession: false,
  restoredAccess: false,
};

function evaluate(events: readonly AccessEvent[]): Checks {
  const checks = { ...emptyChecks };
  const allowed = new Set<string>();
  const loggedOut = new Set<string>();
  const revoked = new Set<string>();
  for (const event of events) {
    const account = event.account;
    if (event.action === 'auth.signIn' && event.errorCode === 'ACCESS_DENIED')
      checks.deniedSignIn = true;
    if (!account) continue;
    if (event.action === 'signOut' && allowed.has(account)) loggedOut.add(account);
    if (event.action === 'auth.me' && event.errorCode === 'ACCESS_DENIED' && allowed.has(account)) {
      revoked.add(account);
      checks.revokedSession = true;
    }
    if (event.outcome !== 'allowed') continue;
    if (event.action === 'auth.signIn') {
      if (loggedOut.has(account)) checks.repeatedSignIn = true;
      if (revoked.has(account)) checks.restoredAccess = true;
    }
    allowed.add(account);
  }
  return checks;
}

export function createAccessCheck(
  now: () => string = () => new Date().toISOString(),
  id: () => string = () => crypto.randomUUID(),
) {
  let state: State = { recording: false, report: null };
  // Only while the user explicitly records a check. No credentials, email or names enter here.
  // The private map compares accounts across logout; exported reports contain local aliases only.
  const accounts = new Map<string, string>();
  const listeners = new Set<() => void>();
  const update = (next: State) => {
    state = next;
    listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        /* Diagnostics must not interrupt authentication. */
      }
    });
  };
  function finish(reason: 'user' | 'limit' = 'user') {
    if (!state.recording || !state.report) return;
    accounts.clear();
    update({
      recording: false,
      report: { ...state.report, finishedAt: now(), stopReason: reason },
    });
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    captureId: () => (state.recording ? (state.report?.runId ?? null) : null),
    start(origin: string, browser: string) {
      const publicOrigin = new URL(origin).origin;
      accounts.clear();
      update({
        recording: true,
        report: {
          formatVersion: 1,
          runId: id(),
          startedAt: now(),
          finishedAt: null,
          stopReason: null,
          origin: publicOrigin,
          browser: browser.slice(0, 512),
          checks: { ...emptyChecks },
          events: [],
        },
      });
    },
    finish,
    clear() {
      accounts.clear();
      update({ recording: false, report: null });
    },
    record(captureId: string | null, observation: Observation) {
      if (!captureId || !state.recording || state.report?.runId !== captureId) return;
      const { userId } = observation;
      let account: string | null = null;
      if (userId) {
        account = accounts.get(userId) ?? `account-${accounts.size + 1}`;
        accounts.set(userId, account);
      }
      const event: AccessEvent = {
        at: now(),
        account,
        action: observation.action,
        outcome: observation.outcome,
        role: observation.role,
        requestId: observation.requestId,
        errorCode: observation.errorCode,
        elapsedMs: observation.elapsedMs,
      };
      const events = [...state.report.events, event];
      update({ recording: true, report: { ...state.report, events, checks: evaluate(events) } });
      if (events.length >= 30) finish('limit');
    },
  };
}

export const accessCheck = createAccessCheck();
export const getAccessCheck = accessCheck.getSnapshot;
export const subscribeAccessCheck = accessCheck.subscribe;
export const startAccessCheck = accessCheck.start;
export const finishAccessCheck = () => accessCheck.finish();
export const clearAccessCheck = accessCheck.clear;
