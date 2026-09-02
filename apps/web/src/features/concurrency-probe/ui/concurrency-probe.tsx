import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getSession, subscribeSession } from '@/entities/session';
import { env } from '@/shared/config';
import { runConcurrencyProbe } from '../model/run-probe';
import type { ProbeReport } from '../model/run-probe';

function OwnerProbe() {
  const [report, setReport] = useState<ProbeReport | null>(null);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function start() {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    try {
      await runConcurrencyProbe(active.signal, setReport);
    } catch {
      /* Unmount/logout aborts the run; no private state is restored. */
    } finally {
      if (!active.signal.aborted) setBusy(false);
    }
  }
  function download() {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `tastory-check-${report.runId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="panel concurrency-panel" aria-labelledby="concurrency-title">
      <p className="eyebrow">Проверка перед рецептами</p>
      <h2 id="concurrency-title">Одновременные изменения</h2>
      <p className="muted mb-6">
        Проверим две записи и повторную отправку. Для этого создадим небольшую тестовую запись в
        отдельном листе таблицы. Проверка может занять около минуты.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          className="button button-primary"
          disabled={busy}
          type="button"
          onClick={() => void start()}
        >
          {busy ? 'Проверяем…' : 'Проверить одновременные записи'}
        </button>
        {report?.finishedAt && (
          <button className="button button-secondary" type="button" onClick={download}>
            Скачать результат
          </button>
        )}
      </div>
      {report && (
        <>
          <p className="mt-5" role={report.finishedAt && !report.passed ? 'alert' : 'status'}>
            {report.message}
          </p>
          <ol className="probe-results mt-5">
            {report.steps.map((step) => (
              <li key={step.label}>
                <strong>{step.label}</strong>
                <br />
                <span className="muted text-sm">
                  {
                    {
                      read: 'Прочитано',
                      applied: 'Сохранено',
                      replayed: 'Повтор без дубликата',
                      conflict: 'Устаревшая версия отклонена',
                    }[step.outcome]
                  }{' '}
                  · версия {step.revision} · {(step.elapsedMs / 1000).toFixed(1)} с
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
export function ConcurrencyProbe() {
  const session = useSyncExternalStore(subscribeSession, getSession);
  if (
    env.environment !== 'staging' ||
    session.status !== 'signed-in' ||
    session.user?.role !== 'owner'
  )
    return null;
  return <OwnerProbe key={session.user.id} />;
}
