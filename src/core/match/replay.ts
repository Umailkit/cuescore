import type { MatchEvent, MatchStatus } from '../types';

/**
 * Recovery path (req #1): when the Snapshot cache is missing or corrupted, the
 * current state can always be rebuilt by replaying the append-only EventLog.
 *
 *   Initial State → Replay EventLog → Current State
 *
 * This generic reducer only tracks core lifecycle status. Game-specific state
 * replay is delegated to each engine in later phases; here we guarantee the
 * match is at least restorable to the correct lifecycle stage.
 */
const STATUS_EVENTS: Partial<Record<MatchEvent['type'], MatchStatus>> = {
  // Creating a match lands it in READY (mirrors MatchService.createMatch).
  MATCH_CREATED: 'READY',
  MATCH_STARTED: 'PLAYING',
  MATCH_PAUSED: 'PAUSED',
  MATCH_RESUMED: 'PLAYING',
  FRAME_STARTED: 'PLAYING',
  FRAME_WON: 'FRAME_END',
  MATCH_WON: 'MATCH_END',
  MATCH_CANCELLED: 'CANCELLED',
};

interface UndoRedoPayloadShape {
  targetEventIds?: string[];
}

/**
 * Resolve the EFFECTIVE event list by honoring UNDO/REDO audit events.
 *
 * Undo/Redo never delete or mutate events — they only append. To replay, we
 * compute which events are currently undone: an UNDO marks its targets undone,
 * a REDO brings the same targets back. Audit events are not facts about match
 * state, so they are excluded from the resulting stream.
 *
 * This keeps the EventLog genuinely authoritative: without it, a replay after
 * "undo" would reproduce the pre-undo state and silently disagree with the
 * snapshot.
 */
export function effectiveEvents(events: MatchEvent[]): MatchEvent[] {
  const undone = new Set<string>();

  for (const e of events) {
    if (e.type !== 'UNDO' && e.type !== 'REDO') continue;
    const targets = (e.payload as UndoRedoPayloadShape).targetEventIds ?? [];
    for (const id of targets) {
      if (e.type === 'UNDO') undone.add(id);
      else undone.delete(id);
    }
  }

  return events.filter(
    (e) => e.type !== 'UNDO' && e.type !== 'REDO' && !undone.has(e.id),
  );
}

export function replayStatus(events: MatchEvent[]): MatchStatus {
  let status: MatchStatus = 'SETUP';
  for (const e of effectiveEvents(events)) {
    const next = STATUS_EVENTS[e.type];
    if (next) status = next;
  }
  return status;
}

export interface ReconstructedSnapshot {
  status: MatchStatus;
  eventCount: number;
  lastEvent: MatchEvent | null;
  lastTimestamp: number | null;
}

export function reconstructSnapshot(events: MatchEvent[]): ReconstructedSnapshot {
  return {
    status: replayStatus(events),
    eventCount: effectiveEvents(events).length,
    lastEvent: events.length ? events[events.length - 1]! : null,
    lastTimestamp: events.length ? events[events.length - 1]!.timestamp : null,
  };
}
