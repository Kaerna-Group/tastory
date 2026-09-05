import { expect, it, vi } from 'vitest';
import { ResourcePool } from './resource-pool';

it('shares an in-flight image and releases it only when the last preview closes', async () => {
  const pool = new ResourcePool();
  const load = vi.fn(async () => 'blob:image');
  const dispose = vi.fn();
  const view = pool.acquire('recipe-A:image', load, dispose);
  const preview = pool.acquire('recipe-A:image', load, dispose);
  await expect(view.promise).resolves.toBe('blob:image');
  expect(await preview.promise).toBe('blob:image');
  expect(load).toHaveBeenCalledTimes(1);
  view.release();
  expect(dispose).not.toHaveBeenCalled();
  preview.release();
  preview.release();
  expect(dispose).toHaveBeenCalledExactlyOnceWith('blob:image');
});

it('clears resources on session reset, including a response arriving after logout', async () => {
  const pool = new ResourcePool();
  let complete!: (value: string) => void;
  let signal!: AbortSignal;
  const dispose = vi.fn();
  const lease = pool.acquire(
    'old-account',
    (value) => {
      signal = value;
      return new Promise<string>((resolve) => {
        complete = resolve;
      });
    },
    dispose,
  );
  const rejected = expect(lease.promise).rejects.toThrow();
  pool.clear();
  expect(signal.aborted).toBe(true);
  complete('blob:private');
  await rejected;
  expect(dispose).toHaveBeenCalledExactlyOnceWith('blob:private');
  lease.release();
  expect(dispose).toHaveBeenCalledTimes(1);
});

it('isolates authority keys and permits a fresh read after a failed file request', async () => {
  const pool = new ResourcePool();
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValue('blob:allowed');
  const first = pool.acquire('recipe-A:placement-A', load);
  await expect(first.promise).rejects.toThrow('unavailable');
  first.release();
  const retry = pool.acquire('recipe-A:placement-A', load);
  const other = pool.acquire('recipe-B:placement-B', load);
  await expect(retry.promise).resolves.toBe('blob:allowed');
  await expect(other.promise).resolves.toBe('blob:allowed');
  expect(load).toHaveBeenCalledTimes(3);
  pool.clear();
});
