import type { GameType } from './gameType';
import type { RuleSetSnapshot, MatchFormat } from './ruleset';

/**
 * Core match status state machine. Transitions are validated by
 * `core/match/stateMachine.ts`. Status is the ONLY place a match's lifecycle
 * is expressed — never a pile of booleans.
 */
export type MatchStatus =
  | 'SETUP'
  | 'READY'
  | 'PLAYING'
  | 'PAUSED'
  | 'FRAME_END'
  | 'MATCH_END'
  | 'CANCELLED';

/**
 * Snapshot of a participant inside a match. `displayName` is frozen at match
 * creation (Q6): merging an anonymous player into a real Player later must
 * never rewrite history, so we never reference the live Player here.
 */
export interface MatchPlayer {
  playerId: string | null;
  displayName: string;
  isAnonymous: boolean;
  /** seat index for doubles / rotation (PHASE 1 reserves the field) */
  seat?: number;
}

/**
 * What the UI hands the service when creating a match. Two cases:
 *  - existing Player  → { playerId, displayName } (isAnonymous false)
 *  - temporary player → { displayName } only         (isAnonymous true)
 *
 * The service FREEZES `displayName` into `MatchPlayer` — later renaming the
 * Player must never rewrite this match's history (Q6).
 */
export interface MatchPlayerInput {
  playerId?: string | null;
  displayName: string;
  isAnonymous?: boolean;
}

/**
 * Unified Match model. Every game type shares this shape; game-specific data
 * lives opaquely in `engineState` and is interpreted only by its engine.
 */
export interface Match {
  id: string;
  /** Short, human-shareable code (e.g. printed on a scoreboard / sent to a friend). */
  shareCode: string;
  displayName: string;
  gameType: GameType;
  /** Frozen ruleset — immune to later default changes (req #6). */
  ruleSetSnapshot: RuleSetSnapshot;
  matchFormat: MatchFormat;

  players: MatchPlayer[];
  activePlayerIndex: number;

  status: MatchStatus;
  currentFrame: number;
  /** Generic target container: Race-To N or Best-Of N, interpreted per ruleset. */
  target: number;

  /** Opaque, engine-owned state. Core never reads its internals. */
  engineState: unknown;
  /** Bumped whenever engineState is replaced (req: optimistic-concurrency). */
  engineStateVersion: number;
  /** Total events appended to this match's EventLog (req: append-only audit). */
  eventSeq: number;
  /** Schema version of this Match record; enables future migrations. */
  schemaVersion: number;

  frames: FrameResult[];
  winnerPlayerId: string | null;

  createdAt: number;
  updatedAt: number;
}

export interface FrameResult {
  index: number;
  /** Stable seat index of the frame winner (works even for anonymous players). */
  winnerPlayerIndex: number;
  /** Best-effort player id when the winner was a known Player; null for anonymous. */
  winnerPlayerId: string | null;
  /** human-readable summary, e.g. "张三 Win" or "83 : 42" */
  detail?: string;
  /**
   * 本局结束时的座位分数（seat → 分数）。
   *
   * 只有计分制玩法（六球 / 四球 / 斯诺克 / 记分制九球）会写；
   * 八球这类按局定胜负的玩法没有分数，字段缺省。
   * 排名总览按它跨局累计，不另外冗余存统计表。
   */
  scores?: Record<number, number>;
}

/**
 * Current Match record schema version. Bump when the persisted shape changes so
 * a future migration can upgrade old records instead of failing to read them.
 */
export const MATCH_SCHEMA_VERSION = 1;
