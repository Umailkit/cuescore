import type {
  GameType,
  MatchCommand,
  MatchEvent,
  MatchPlayer,
  RuleSetSnapshot,
  MatchFormat,
} from '../types';

/**
 * Everything an engine needs to interpret a command without touching the
 * framework, storage or UI layers.
 */
export interface EngineContext {
  matchId: string;
  gameType: GameType;
  players: MatchPlayer[];
  ruleSet: RuleSetSnapshot;
  target: number;
  matchFormat: MatchFormat;
}

export interface EngineResult<S> {
  state: S;
  events: MatchEvent[];
}

/**
 * Generic, game-agnostic summary used by UI to render scoreboards without
 * knowing the internals of any specific engine.
 */
export interface ScoreSummary {
  lines: { playerId: string | null; label: string; value: string | number }[];
  note?: string;
}

/**
 * The single contract every game implements (req: GameEngine architecture).
 * Pure & deterministic: `reduce(state, command)` returns a NEW state plus the
 * events it produced. No side effects, no storage, no DOM — so the same engine
 * runs in the browser, in tests, and (later) on a server.
 */
export interface GameEngine<S = unknown> {
  readonly gameType: GameType;
  createInitialState(ctx: EngineContext): S;
  reduce(state: S, command: MatchCommand, ctx: EngineContext): EngineResult<S>;
  /**
   * Reset the engine to a fresh frame, with `breakPlayerIndex` on strike.
   *
   * Optional so engines that don't model frames can omit it. The service calls
   * it when a new frame starts, which keeps "a frame has ended, so the next one
   * begins" logic out of the engine AND keeps the engine's internal frame flag
   * (e.g. eight-ball's frameStatus) from ever going stale.
   */
  startFrame?(state: S, breakPlayerIndex: number, ctx: EngineContext): S;
  getScoreSummary(state: S): ScoreSummary;
  isFrameComplete(state: S): boolean;
  isMatchComplete(state: S): boolean;
  getWinner(state: S): string | null;
  getStatistics(state: S): unknown;
  /**
   * 本局打完时的座位分数快照（seat → 分数）。
   *
   * 只给「计分制」玩法实现（六球 / 四球 / 斯诺克 / 记分制九球）；
   * 八球、清台制九球没有分数概念，返回 null。
   * MatchService 用它把分数存进 FrameResult，排名总览才能跨局累计 ——
   * 引擎仍是唯一知道「这局谁得了多少分」的地方。
   */
  getFrameScores?(state: S): Record<number, number> | null;
}
