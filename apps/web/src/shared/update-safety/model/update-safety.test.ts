import { afterEach, describe, expect, it } from 'vitest';
import { getReloadBlockers, setReloadBlocked } from './update-safety';

describe('update safety', () => {
  afterEach(() => setReloadBlocked('test', false));

  it('reports volatile state until it becomes durable', () => {
    setReloadBlocked('test', true);
    expect(getReloadBlockers()).toContain('test');
    setReloadBlocked('test', false);
    expect(getReloadBlockers()).not.toContain('test');
  });
});
