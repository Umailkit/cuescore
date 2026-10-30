import type { MatchEventType } from './event';

/**
 * A command is the user's *intent*. The engine turns it into facts (events).
 * UI never mutates match data directly — it only dispatches commands.
 *
 * Lifecycle commands (START_MATCH … COMPLETE_MATCH) are owned by the service +
 * state machine. Game-specific commands are owned by the engine, which is the
 * only place that knows the actual rules.
 */
export type MatchCommandType =
  | 'START_MATCH'
  | 'PAUSE_MATCH'
  | 'RESUME_MATCH'
  | 'CANCEL_MATCH'
  | 'SWITCH_PLAYER'
  | 'COMPLETE_FRAME'
  | 'COMPLETE_MATCH'
  /** Engine-specific scoring/foul command (handled by the game engine). */
  | 'ENGINE_COMMAND'
  // ---------- PHASE 3A: eight-ball engine commands ----------
  /** 开球：本局第一杆。 */
  | 'BREAK_STARTED'
  /** 打进一颗球（球号在 payload.ball）。引擎自行判断合法性与后果。 */
  | 'BALL_POTTED'
  /** 空杆：母球没有碰到任何目标球。 */
  | 'BALL_MISSED'
  /** 显式犯规（例如母球落袋 / 先碰错球），reason 放 payload.reason。 */
  | 'FOUL'
  /** 结束本方回合，换手。 */
  | 'END_TURN'
  /** 指定球+袋（Call Shot，可选规则）。 */
  | 'CALL_SHOT'
  /** 认输本局。 */
  | 'CONCEDE'
  /** 重新摆球（开球 8 号球落袋等场景）。 */
  | 'RERACK'
  // ---------- 九球 / 斯诺克 ----------
  /** 九球 Push Out：开球后第一杆可声明推杆，由对手决定是否接手。 */
  | 'PUSH_OUT'
  /** 计分：把一颗球的分值记给当前击球方（payload.ball 为球值或球名）。 */
  | 'SCORE'
  /** 结束单杆（斯诺克）：换手且单杆归零。 */
  | 'END_BREAK'
  /**
   * 人工加减分（记分制玩法）：`payload.points` 正数为加、负数为减。
   *
   * 与 `SCORE` 的区别：`SCORE` 是「这一杆进了哪颗球」，分值由引擎按球解释；
   * `ADJUST_SCORE` 是记分员直接给分 —— 记错要改、或者这个玩法本来就不看球号。
   */
  | 'ADJUST_SCORE';

export interface MatchCommand {
  type: MatchCommandType;
  playerId?: string;
  payload?: Record<string, unknown>;
}

/**
 * Maps a *lifecycle* command to the core event it emits.
 *
 * Deliberately absent:
 *  - COMPLETE_FRAME / COMPLETE_MATCH: who won is a RULE decision owned by the
 *    engine (FRAME_WON / FRAME_LOST). The service must never invent a winner,
 *    so these are not mapped here.
 *  - Engine commands (BALL_POTTED / FOUL / …): the engine emits their facts.
 */
export const COMMAND_EVENT_MAP: Partial<Record<MatchCommandType, MatchEventType>> = {
  START_MATCH: 'MATCH_STARTED',
  PAUSE_MATCH: 'MATCH_PAUSED',
  RESUME_MATCH: 'MATCH_RESUMED',
  CANCEL_MATCH: 'MATCH_CANCELLED',
  /** Ending the series is administrative: no game rule is involved. */
  COMPLETE_MATCH: 'MATCH_WON',
  SWITCH_PLAYER: 'PLAYER_SWITCHED',
  RERACK: 'RERACK',
};

/**
 * Engine-owned commands. The service forwards these to the engine and does NOT
 * synthesize a lifecycle event for them — the engine's own events are the facts.
 *
 * COMPLETE_FRAME is included: "who won this frame" is a rule decision. Routing
 * it through the engine is what removes PHASE 2's placeholder winner.
 */
export const ENGINE_COMMAND_TYPES: readonly MatchCommandType[] = [
  'ENGINE_COMMAND',
  'BREAK_STARTED',
  'BALL_POTTED',
  'BALL_MISSED',
  'FOUL',
  'END_TURN',
  'CALL_SHOT',
  'CONCEDE',
  'COMPLETE_FRAME',
  'PUSH_OUT',
  'SCORE',
  'END_BREAK',
  'ADJUST_SCORE',
];

export function isEngineCommand(type: MatchCommandType): boolean {
  return ENGINE_COMMAND_TYPES.includes(type);
}

/** Payload shape of a BALL_POTTED command. */
export interface BallPottedPayload {
  ball: number;
  /** 打进的是不是母球（也可用 FOUL + SCRATCH 表达，这里兼容两种写法）。 */
  scratch?: boolean;
  /** 本杆先碰到的球号，用于 WRONG_BALL_FIRST 判定。 */
  firstContact?: number;
  /** Call Shot 指定的袋口。 */
  pocket?: string;
}

/** Payload shape of a FOUL command. */
export interface FoulPayload {
  reason?: string;
  ball?: number;
  firstContact?: number;
  detail?: string;
}

/** Payload shape of a CALL_SHOT command. */
export interface CallShotPayload {
  ball: number;
  pocket?: string;
}

/** Payload shape of a BALL_MISSED command. */
export interface BallMissedPayload {
  firstContact?: number;
}
