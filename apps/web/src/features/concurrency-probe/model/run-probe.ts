import type { ConcurrencyCommand, ConcurrencyData } from '@tastory/contracts';
import { requestSessionConcurrency } from '@/entities/session';

export type ProbeStep = {
  label: string;
  outcome: ConcurrencyData['outcome'];
  revision: number;
  operations: number;
  elapsedMs: number;
};
export type ProbeReport = {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  passed: boolean;
  steps: ProbeStep[];
  message: string;
};
type Send = (command: ConcurrencyCommand, signal?: AbortSignal) => Promise<ConcurrencyData>;
export async function runConcurrencyProbe(
  signal: AbortSignal,
  onProgress: (report: ProbeReport) => void,
  send: Send = requestSessionConcurrency,
  id: () => string = () => crypto.randomUUID(),
): Promise<ProbeReport> {
  const runId = id();
  let report: ProbeReport = {
    runId,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    passed: false,
    steps: [],
    message: 'Отправляем две записи одновременно…',
  };
  const publish = () => {
    signal.throwIfAborted();
    onProgress({ ...report, steps: [...report.steps] });
  };
  const assert = (condition: boolean) => {
    if (!condition)
      throw new Error('Результат отличается от ожидаемого. Сохраните отчёт для проверки.');
  };
  async function call(label: string, command: ConcurrencyCommand) {
    signal.throwIfAborted();
    const start = performance.now();
    const data = await send(command, signal);
    signal.throwIfAborted();
    assert(data.state.runId === runId && data.state.revision === data.appliedOperations);
    report.steps.push({
      label,
      outcome: data.outcome,
      revision: data.state.revision,
      operations: data.appliedOperations,
      elapsedMs: Math.round(performance.now() - start),
    });
    publish();
    return data;
  }
  const read = (): ConcurrencyCommand => ({ action: 'spike.concurrency.read', payload: { runId } });
  const writes: ConcurrencyCommand[] = (['first', 'second'] as const).map((value) => ({
    action: 'spike.concurrency.write',
    payload: { runId, operationId: id(), expectedRevision: 0, value },
  }));
  publish();
  try {
    const baseline = await call('Исходное состояние', read());
    assert(
      baseline.outcome === 'read' && baseline.state.revision === 0 && baseline.state.value === null,
    );
    const attempts = await Promise.allSettled(
      writes.map((command, index) => call(`Запись ${index + 1}`, command)),
    );
    const failure = attempts.find((item) => item.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    const results = attempts.map((item) => {
      if (item.status !== 'fulfilled') throw new Error();
      return item.value;
    });
    const winner = results.findIndex((item) => item.outcome === 'applied');
    const loser = results.findIndex((item) => item.outcome === 'conflict');
    const winning = writes[winner],
      losing = writes[loser];
    assert(
      winner >= 0 &&
        loser >= 0 &&
        winner !== loser &&
        results.every((item) => item.state.revision === 1),
    );
    if (
      winning?.action !== 'spike.concurrency.write' ||
      losing?.action !== 'spike.concurrency.write'
    )
      throw new Error('Не удалось определить результат записей.');
    report = { ...report, message: 'Проверяем, что повтор не создаёт дубликат…' };
    publish();
    const afterRace = await call('Чтение после двух запросов', read());
    assert(afterRace.state.revision === 1 && afterRace.state.value === winning.payload.value);
    const replay = await call('Повтор сохранённой записи', winning);
    assert(
      replay.outcome === 'replayed' &&
        replay.state.revision === 1 &&
        replay.operationRevision === 1 &&
        replay.state.value === winning.payload.value,
    );
    report = { ...report, message: 'Сохраняем вторую запись после обновления версии…' };
    publish();
    const retry: ConcurrencyCommand = {
      ...losing,
      payload: { ...losing.payload, expectedRevision: 1, operationId: id() },
    };
    const second = await call('Вторая запись с актуальной версией', retry);
    assert(
      second.outcome === 'applied' &&
        second.state.revision === 2 &&
        second.state.value === losing.payload.value,
    );
    const oldReplay = await call('Повтор старой операции после новой', winning);
    assert(
      oldReplay.outcome === 'replayed' &&
        oldReplay.operationRevision === 1 &&
        oldReplay.state.revision === 2 &&
        oldReplay.state.value === losing.payload.value,
    );
    const final = await call('Итоговое чтение', read());
    assert(
      final.state.revision === 2 &&
        final.appliedOperations === 2 &&
        final.state.value === losing.payload.value,
    );
    report = {
      ...report,
      passed: true,
      message:
        'Проверка пройдена: две записи сохранены по очереди, устаревшая запись отклонена, дубликатов нет.',
    };
  } catch (error) {
    signal.throwIfAborted();
    report = {
      ...report,
      message:
        error instanceof Error
          ? error.message
          : 'Проверка не завершилась. Сохраните результат и попробуйте позже.',
    };
  }
  report = { ...report, finishedAt: new Date().toISOString() };
  publish();
  return report;
}
