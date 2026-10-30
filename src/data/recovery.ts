import type { Match, MatchEvent, FrameResult } from '@core/types';
import { replayStatus, effectiveEvents } from '@core/match/replay';
import { getEngine } from '@core/engine/registry';
import { registerPlaceholderEngines } from '@core/engine/noopEngine';
import { applyEightBallEvent } from '@core/engine/eightBall/engine';
import { applyNineBallEvent } from '@core/engine/nineBall/engine';
import { applySixBallEvent } from '@core/engine/sixBall/engine';
import { applyFourBallEvent } from '@core/engine/fourBall/engine';
import { applySnookerEvent } from '@core/engine/snooker/engine';

/**
 * Event-sourcing recovery (req #1): when the Snapshot cache is unavailable, the
 * current match is rebuilt by replaying the append-only EventLog.
 *
 *   Initial State (MATCH_CREATED payload) → Replay Events → Current State
 *
 * MATCH_CREATED carries the full initial Match (players / ruleset / target), so
 * the static shape survives without a snapshot. Everything that CHANGES during
 * play is then derived from the events themselves:
 *   - FRAME_WON / FRAME_LOST  → append a frame result (winner seat + player id)
 *   - FRAME_STARTED           → current frame number
 *   - engine facts            → engineState rebuilt by the engine's applyEvent
 *
 * PHASE 3A: the engine state is now genuinely rebuilt from the log too, so a
 * match mid-frame recovers with the exact same balls/groups/turn as before.
 */

interface FrameWonPayload {
  frame?: number;
  winnerPlayerIndex?: number;
  loserPlayerIndex?: number;
  winnerPlayerId?: string | null;
  /** 计分制玩法在本局结束时写入的座位分数快照。 */
  scores?: Record<number, number>;
}

function replayFrames(events: MatchEvent[]): FrameResult[] {
  const frames: FrameResult[] = [];
  for (const e of events) {
    if (e.type !== 'FRAME_WON' && e.type !== 'FRAME_LOST') continue;
    const p = e.payload as FrameWonPayload;
    const winnerIndex =
      typeof p.winnerPlayerIndex === 'number'
        ? p.winnerPlayerIndex
        : typeof p.loserPlayerIndex === 'number'
          ? (p.loserPlayerIndex + 1) % 2
          : 0;
    frames.push({
      index: typeof p.frame === 'number' && p.frame > 0 ? p.frame : frames.length + 1,
      winnerPlayerIndex: winnerIndex,
      winnerPlayerId: p.winnerPlayerId ?? null,
      ...(p.scores ? { scores: p.scores } : {}),
    });
  }
  return frames;
}

/** Highest frame number that has been started (1-based). */
function replayCurrentFrame(events: MatchEvent[]): number {
  let current = 1;
  for (const e of events) {
    if (e.type !== 'FRAME_STARTED') continue;
    const p = e.payload as { frame?: number };
    if (typeof p.frame === 'number' && p.frame > 0) current = p.frame;
  }
  return current;
}

/** Last seat the engine reported as on strike. */
function replayActiveIndex(events: MatchEvent[], fallback: number): number {
  let active = fallback;
  for (const e of events) {
    if (e.type === 'TURN_ENDED') {
      const p = e.payload as { to?: number };
      if (typeof p.to === 'number') active = p.to;
    } else if (e.type === 'FRAME_WON' || e.type === 'FRAME_LOST') {
      const p = e.payload as FrameWonPayload;
      if (typeof p.winnerPlayerIndex === 'number') active = p.winnerPlayerIndex;
    }
  }
  return active;
}

/**
 * Rebuild the engine state by replaying the effective event stream.
 * Uses the engine's own `applyEvent` where available, so there is exactly ONE
 * definition of what an event means (no duplicate re-derivation in the data
 * layer).
 */
export function replayEngineState(base: Match, events: MatchEvent[]): unknown {
  // Ensure registration has happened even when recovery runs before any service.
  registerPlaceholderEngines();
  const engine = getEngine(base.gameType);
  if (!engine) return base.engineState;

  const ctx = {
    matchId: base.id,
    gameType: base.gameType,
    players: base.players,
    ruleSet: base.ruleSetSnapshot,
    target: base.target,
    matchFormat: base.matchFormat,
  };

  // 从引擎自己的初始状态出发重放 —— 不复用 base.engineState，
  // 因为 Snapshot 里的 engineState 可能落后于日志。
  let state = engine.createInitialState(ctx);
  for (const e of events) {
    state = applyEngineEvent(base.gameType, state, e);
  }
  return state;
}

/** 按游戏类型把一条事实事件应用到引擎状态上。 */
function applyEngineEvent(
  gameType: string,
  state: unknown,
  event: MatchEvent,
): unknown {
  switch (gameType) {
    case 'eight-ball':
      return applyEightBallEvent(state as never, event);
    case 'nine-ball':
      return applyNineBallEvent(state as never, event);
    case 'six-ball':
      return applySixBallEvent(state as never, event);
    case 'four-ball':
      return applyFourBallEvent(state as never, event);
    case 'snooker':
      return applySnookerEvent(state as never, event);
    default:
      return state;
  }
}

export function reconstructMatchFromEvents(events: MatchEvent[]): Match | null {
  if (events.length === 0) return null;
  const created = events.find((e) => e.type === 'MATCH_CREATED');
  if (!created) return null;
  const base = created.payload.match as Match | undefined;
  if (!base) return null;

  // Honor UNDO/REDO: replay the effective stream, not the raw append log.
  const effective = effectiveEvents(events);
  const frames = replayFrames(effective);
  const lastEvent = effective[effective.length - 1] ?? created;

  return {
    ...base,
    status: replayStatus(events),
    frames,
    // Frames already won advance the match; never regress below 1.
    currentFrame: Math.max(replayCurrentFrame(effective), frames.length + 1),
    activePlayerIndex: replayActiveIndex(effective, base.activePlayerIndex),
    engineState: replayEngineState(base, effective),
    winnerPlayerId:
      frames.length > 0
        ? (frames[frames.length - 1]?.winnerPlayerId ?? base.winnerPlayerId)
        : base.winnerPlayerId,
    eventSeq: effective.length,
    updatedAt: lastEvent.timestamp,
  };
}
