/**
 * Command-history model for reliable Undo/Redo (req #2).
 *
 * We keep THREE stacks:
 *  - past:    previously-visited states
 *  - present: the current state
 *  - future:  states undone and available for redo
 *
 * This is intentionally independent of the append-only EventLog. Undo/Redo here
 * is an O(1) user-facing operation; the EventLog remains the audit source of
 * truth and is only *appended to* (with UNDO/REDO events), never mutated.
 */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export function createHistory<T>(initial: T): History<T> {
  return { past: [], present: initial, future: [] };
}

export function pushHistory<T>(h: History<T>, next: T): History<T> {
  return { past: [...h.past, h.present], present: next, future: [] };
}

/**
 * 用新状态替换当前状态，但不新增历史条目。
 *
 * 用于「一次用户操作 = 多条命令」的场景：整组命令应当只占一步撤销，
 * 所以后续命令用这个函数收尾，而不是再 push 一层。
 */
export function replacePresent<T>(h: History<T>, next: T): History<T> {
  return { past: h.past, present: next, future: [] };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}

export function undo<T>(h: History<T>): History<T> {
  if (!canUndo(h)) return h;
  const previous = h.past[h.past.length - 1]!;
  return {
    past: h.past.slice(0, -1),
    present: previous,
    future: [h.present, ...h.future],
  };
}

export function redo<T>(h: History<T>): History<T> {
  if (!canRedo(h)) return h;
  const next = h.future[0]!;
  return {
    past: [...h.past, h.present],
    present: next,
    future: h.future.slice(1),
  };
}
