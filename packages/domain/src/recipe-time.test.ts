import { describe, expect, it } from 'vitest';
import { getTotalMinutes } from './recipe-time';

describe('recipe time', () => {
  it('distinguishes absent timing from zero minutes', () => {
    expect(getTotalMinutes({})).toBeUndefined();
    expect(getTotalMinutes({ prepMinutes: 0 })).toBe(0);
  });
  it('sums known values', () => {
    expect(getTotalMinutes({ prepMinutes: 10, cookMinutes: 25 })).toBe(35);
    expect(getTotalMinutes({ cookMinutes: 25 })).toBe(25);
  });
  it.each([-1, 0.5, NaN, Infinity])('rejects invalid minutes %s', (prepMinutes) => {
    expect(() => getTotalMinutes({ prepMinutes })).toThrow(RangeError);
  });
  it('rejects overflow', () => {
    expect(() => getTotalMinutes({ prepMinutes: Number.MAX_SAFE_INTEGER, cookMinutes: 1 })).toThrow(
      RangeError,
    );
  });
});
