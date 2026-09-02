import { describe, expect, it, vi } from 'vitest';
import { runConcurrencyProbe } from './run-probe';
import type { ConcurrencyCommand, ConcurrencyData } from '@tastory/contracts';
const runId = 'c3dcd2e8-e2f8-428b-9e26-3e715f678fac';
function server(broken = false) {
  let revision = 0,
    value: 'first' | 'second' | null = null;
  const receipts = new Map<string, number>();
  return vi.fn(async (command: ConcurrencyCommand): Promise<ConcurrencyData> => {
    let outcome: ConcurrencyData['outcome'] = 'read',
      operationRevision: number | null = null;
    if (command.action === 'spike.concurrency.write') {
      const old = receipts.get(command.payload.operationId);
      if (old) {
        outcome = 'replayed';
        operationRevision = old;
      } else if (!broken && command.payload.expectedRevision !== revision) outcome = 'conflict';
      else {
        revision++;
        value = command.payload.value;
        receipts.set(command.payload.operationId, revision);
        outcome = 'applied';
        operationRevision = revision;
      }
    }
    return {
      outcome,
      operationRevision,
      appliedOperations: revision,
      state: { runId: command.payload.runId, revision, value },
    };
  });
}
describe('browser concurrency proof', () => {
  it('passes only after conflict, deduplication, a new revision and final read', async () => {
    let counter = 0;
    const id = () => (counter++ ? `operation-${counter}` : runId);
    const send = server();
    const report = await runConcurrencyProbe(new AbortController().signal, vi.fn(), send, id);
    expect(report.passed).toBe(true);
    expect(report.steps).toHaveLength(8);
    expect(report.steps.filter((step) => step.outcome === 'conflict')).toHaveLength(1);
    expect(report.steps.filter((step) => step.outcome === 'replayed')).toHaveLength(2);
  });
  it('does not report success when both stale writes are accepted', async () => {
    let counter = 0;
    const report = await runConcurrencyProbe(
      new AbortController().signal,
      vi.fn(),
      server(true),
      () => (counter++ ? `operation-${counter}` : runId),
    );
    expect(report.passed).toBe(false);
    expect(report.message).toContain('отличается');
  });
  it('preserves partial observations after network failure and stops on logout', async () => {
    const send = server();
    send.mockRejectedValueOnce(new Error('Соединение прервано.'));
    const report = await runConcurrencyProbe(
      new AbortController().signal,
      vi.fn(),
      send,
      () => runId,
    );
    expect(report.passed).toBe(false);
    expect(report.message).toBe('Соединение прервано.');
    const controller = new AbortController();
    controller.abort();
    await expect(runConcurrencyProbe(controller.signal, vi.fn(), send)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
