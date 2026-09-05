import { describe, expect, it } from 'vitest';
import {
  EMPTY_COMPOSITION_HISTORY,
  constrainCompositionGeometry,
  moveCompositionGeometry,
  recordCompositionCommand,
  redoCompositionCommand,
  undoCompositionCommand,
} from './composition-commands';

const geometry = {
  pageId: 'page-1',
  x: 10,
  y: 20,
  width: 30,
  height: 25,
  rotation: 0,
  zIndex: 2,
  locked: false,
} as const;

describe('composition commands', () => {
  it('keeps content on its grid and inside the physical page', () => {
    expect(
      constrainCompositionGeometry(
        { ...geometry, x: 94.7, y: -4, width: 20.2, height: 110, rotation: 45 },
        'content',
      ),
    ).toEqual({
      ...geometry,
      x: 80,
      y: 0,
      width: 20,
      height: 100,
      rotation: 0,
    });
  });

  it('keeps decorative precision and bounded rotation', () => {
    expect(
      constrainCompositionGeometry(
        { ...geometry, x: 90.125, width: 12.5, rotation: 250, zIndex: 20_000 },
        'decor',
      ),
    ).toMatchObject({ x: 87.5, width: 12.5, rotation: 180, zIndex: 10_000 });
  });

  it('does not move a locked element', () => {
    const locked = { ...geometry, locked: true };
    expect(moveCompositionGeometry(locked, 'content', 12, 12)).toBe(locked);
  });

  it('records one completed gesture and restores the exact before/after snapshots', () => {
    const after = moveCompositionGeometry(geometry, 'content', 5, -3);
    const command = { target: 'content:title', kind: 'content' as const, before: geometry, after };
    const recorded = recordCompositionCommand(EMPTY_COMPOSITION_HISTORY, command);
    expect(recorded.past).toHaveLength(1);
    const undone = undoCompositionCommand(recorded);
    expect(undone.geometry).toEqual(geometry);
    expect(undone.history.past).toHaveLength(0);
    const redone = redoCompositionCommand(undone.history);
    expect(redone.geometry).toEqual(after);
    expect(redone.history.past).toEqual([command]);
  });

  it('does not add an unchanged or cancelled gesture', () => {
    expect(
      recordCompositionCommand(EMPTY_COMPOSITION_HISTORY, {
        target: 'content:title',
        kind: 'content',
        before: geometry,
        after: geometry,
      }),
    ).toBe(EMPTY_COMPOSITION_HISTORY);
  });
});
