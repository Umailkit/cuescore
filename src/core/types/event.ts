/**
 * MatchEvent — the append-only fact log (the source of truth).
 *
 * Key invariants (req #1, #2):
 *  - Events are NEVER deleted or mutated once written.
 *  - Undo/Redo append new `UNDO` / `REDO` events for audit; they never edit
 *    an existing event (which would corrupt replay).
 *  - Every state change in the app flows from one or more of these events.
 *
 * PHASE 3A adds eight-ball facts. Every one of them must be replayable: given
 * the initial MATCH_CREATED payload plus this log, the engine state can be
 * rebuilt without a snapshot.
 */
export type MatchEventType =
  | 'MATCH_CREATED'
  | 'MATCH_STARTED'
  | 'MATCH_PAUSED'
  | 'MATCH_RESUMED'
  | 'MATCH_CANCELLED'
  | 'FRAME_STARTED'
  | 'FRAME_WON'
  | 'MATCH_WON'
  | 'PLAYER_SWITCHED'
  | 'SCORE_ADDED'
  | 'FOUL'
  | 'ENGINE_EVENT'
  | 'UNDO'
  | 'REDO'
  // ---------- PHASE 3A: eight-ball facts ----------
  /** 开球。payload: { frame, playerIndex } */
  | 'BREAK_STARTED'
  /** 进球。payload: { ball, playerIndex, legal, turnNumber, frame } */
  | 'BALL_POTTED'
  /** 空杆（母球未碰到任何球）。 */
  | 'BALL_MISSED'
  /** 回合结束（换手）。payload: { from, to, turnNumber, frame } */
  | 'TURN_ENDED'
  /** 球台分组完成。payload: { playerIndex, group } */
  | 'GROUPS_ASSIGNED'
  /** 进入打 8 号球阶段。payload: { playerIndex } */
  | 'EIGHT_BALL_PHASE'
  /** 本局判负（非法黑八等）。payload: { frame, loserPlayerIndex, winnerPlayerIndex, reason } */
  | 'FRAME_LOST'
  /** 整场判负。payload: { loserPlayerIndex, winnerPlayerIndex, reason } */
  | 'MATCH_LOST'
  /** 重新摆球。payload: { frame, reason } */
  | 'RERACK'
  /** 指定球+袋。payload: { ball, pocket } */
  | 'CALL_SHOT'
  /** 认输。payload: { playerIndex, frame } */
  | 'CONCEDE';

export interface MatchEvent {
  id: string;
  matchId: string;
  timestamp: number;
  /**
   * Monotonic sequence within a match, starting at 0 for MATCH_CREATED.
   *
   * Required for deterministic replay: several events can legitimately share the
   * same millisecond, and `Array.sort` on equal timestamps is not stable across
   * engines. Ordering by `seq` is what makes "EventLog → replay" reproducible.
   */
  seq?: number;
  playerId?: string;
  type: MatchEventType;
  payload: Record<string, unknown>;
}

/** A UNDO/REDO event references the event(s) it reverses without touching them. */
export interface UndoRedoPayload {
  /** id(s) of the event(s) being undone / redone */
  targetEventIds: string[];
  /** the command that produced the reversed state, for traceability */
  commandType?: string;
}

/**
 * Facts that describe the *outcome* of a frame. The match layer listens for
 * these to update scores — it never decides a winner itself.
 */
export const FRAME_DECIDING_EVENTS: readonly MatchEventType[] = [
  'FRAME_WON',
  'FRAME_LOST',
] as const;

export function isFrameDeciding(type: MatchEventType): boolean {
  return FRAME_DECIDING_EVENTS.includes(type);
}

/** Payload carried by FRAME_WON. */
export interface FrameWonPayload {
  frame?: number;
  winnerPlayerIndex?: number;
  winnerPlayerId?: string | null;
  /** 'eight-ball' | 'concede' | 'opponent-concede' … */
  reason?: string;
}

/** Payload carried by FRAME_LOST. */
export interface FrameLostPayload {
  frame?: number;
  loserPlayerIndex?: number;
  winnerPlayerIndex?: number;
  winnerPlayerId?: string | null;
  reason?: string;
}
