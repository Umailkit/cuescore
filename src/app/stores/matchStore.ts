import { create } from 'zustand';
import type {
  Match,
  MatchCommand,
  MatchEvent,
  MatchPlayerInput,
  MatchTemplate,
} from '@core/types';
import {
  createHistory,
  pushHistory,
  replacePresent,
  undo as histUndo,
  redo as histRedo,
  canUndo,
  canRedo,
  type History,
} from '@core/match/history';
import { MatchService } from '../services/matchService';
import { repos } from '../repos';

const service = new MatchService(repos);

interface MatchStore {
  current: Match | null;
  history: History<Match | null>;
  log: MatchEvent[];
  lastEventIds: string[];
  /** Most recent command rejection, surfaced by the UI as a toast/inline note. */
  lastError: string | null;

  create: (
    template: MatchTemplate,
    players: MatchPlayerInput[],
    opts?: { target?: number; displayName?: string },
  ) => Promise<Match | null>;
  load: (id: string) => Promise<void>;
  dispatch: (command: MatchCommand) => Promise<void>;
  /** 一组命令只算一步历史（用于「记一局」这类复合操作）。 */
  dispatchBatch: (
    commands: MatchCommand[],
    opts?: { mergeWithPrevious?: boolean },
  ) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearError: () => void;
}

export const useMatchStore = create<MatchStore>((set, get) => ({
  current: null,
  history: createHistory<Match | null>(null),
  log: [],
  lastEventIds: [],
  lastError: null,

  async create(template, players, opts) {
    const { match, event } = await service.createMatch(template, players, opts);
    set({
      current: match,
      history: createHistory<Match | null>(match),
      log: [event],
      lastEventIds: [event.id],
      lastError: null,
    });
    return match;
  },

  async load(id) {
    const match = await service.recover(id);
    if (!match) return;
    const events = await service.listEvents(id);
    set({
      current: match,
      history: createHistory<Match | null>(match),
      log: events,
      lastEventIds: events.length ? [events[events.length - 1]!.id] : [],
      lastError: null,
    });
  },

  async dispatch(command) {
    const cur = get().current;
    if (!cur) return;
    let result;
    try {
      result = await service.applyCommand(cur, command);
    } catch (err) {
      const message = (err as Error).message;
      console.warn('[matchStore] command blocked:', message);
      set({ lastError: message });
      return;
    }
    const { match, events } = result;
    set({
      current: match,
      history: pushHistory(get().history, match),
      log: [...get().log, ...events],
      lastEventIds: events.map((e) => e.id),
      lastError: null,
    });
  },

  /**
   * 执行一组命令，整组只占一步撤销。
   *
   * 记一局在实现上是「开赛 → 记胜负 → 开下一局」几条命令，但对用户来说
   * 只是「点了一下张三赢」。撤销必须一次退回这一步，而不是退三次。
   *
   * `mergeWithPrevious` 用于「上一条历史已经压过」的场景（例如记完一局后
   * 自动续局）：此时用新状态替换栈顶，而不是再压一层。
   */
  async dispatchBatch(commands, opts) {
    const start = get().current;
    if (!start) return;
    let latest = start;
    const allEvents: MatchEvent[] = [];

    for (const command of commands) {
      try {
        const { match, events } = await service.applyCommand(latest, command);
        latest = match;
        allEvents.push(...events);
      } catch (err) {
        const message = (err as Error).message;
        console.warn('[matchStore] batch command blocked:', message);
        set({ lastError: message });
        break;
      }
    }

    if (latest === start) return;
    const history = opts?.mergeWithPrevious
      ? replacePresent(get().history, latest)
      : pushHistory(get().history, latest);
    set({
      current: latest,
      history,
      log: [...get().log, ...allEvents],
      lastEventIds: allEvents.map((e) => e.id),
      lastError: null,
    });
  },

  async undo() {
    const h = get().history;
    if (!canUndo(h)) return;
    const next = histUndo(h);
    const present = next.present;
    if (!present) return;
    // UNDO 事件本身要占一个 seq，所以 current 用服务返回的那份（eventSeq 已递增）。
    const { event, match } = await service.recordUndo(present, get().lastEventIds);
    set({
      history: next,
      current: match,
      log: [...get().log, event],
      lastEventIds: [event.id],
    });
  },

  async redo() {
    const h = get().history;
    if (!canRedo(h)) return;
    const next = histRedo(h);
    const present = next.present;
    if (!present) return;
    const { event, match } = await service.recordRedo(present, get().lastEventIds);
    set({
      history: next,
      current: match,
      log: [...get().log, event],
      lastEventIds: [event.id],
    });
  },

  canUndo: () => canUndo(get().history),
  canRedo: () => canRedo(get().history),
  clearError: () => set({ lastError: null }),
}));
