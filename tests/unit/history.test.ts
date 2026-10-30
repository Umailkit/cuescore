import { describe, it, expect } from 'vitest';
import {
  createHistory,
  pushHistory,
  undo,
  redo,
  canUndo,
  canRedo,
} from '@core/match/history';

describe('History (past / present / future)', () => {
  it('initial history has present only', () => {
    const h = createHistory(0);
    expect(h.present).toBe(0);
    expect(h.past).toEqual([]);
    expect(canUndo(h)).toBe(false);
  });

  it('push moves present into past', () => {
    let h = createHistory(0);
    h = pushHistory(h, 1);
    h = pushHistory(h, 2);
    expect(h.present).toBe(2);
    expect(h.past).toEqual([0, 1]);
    expect(h.future).toEqual([]);
  });

  it('undo restores previous present and stacks future', () => {
    let h = createHistory(0);
    h = pushHistory(h, 1);
    h = pushHistory(h, 2);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(h.future).toEqual([2]);
    expect(canUndo(h)).toBe(true);
    // undo to the beginning
    h = undo(h);
    expect(h.present).toBe(0);
    expect(canUndo(h)).toBe(false);
  });

  it('redo reapplies undone states', () => {
    let h = createHistory(0);
    h = pushHistory(h, 1);
    h = pushHistory(h, 2);
    h = undo(h);
    h = undo(h);
    h = redo(h);
    expect(h.present).toBe(1);
    h = redo(h);
    expect(h.present).toBe(2);
    expect(canRedo(h)).toBe(false);
  });

  it('pushing a new state clears the redo future', () => {
    let h = createHistory(0);
    h = pushHistory(h, 1);
    h = pushHistory(h, 2);
    h = undo(h);
    h = pushHistory(h, 99);
    expect(h.present).toBe(99);
    expect(h.future).toEqual([]);
    expect(canRedo(h)).toBe(false);
  });
});
