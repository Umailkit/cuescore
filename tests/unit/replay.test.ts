import { describe, it, expect } from 'vitest';
import { effectiveEvents, replayStatus } from '@core/match/replay';
import { reconstructMatchFromEvents } from '@data/recovery';
import type { Match, MatchEvent } from '@core/types';
import { MATCH_TEMPLATES, MATCH_SCHEMA_VERSION, snapshotRuleSet } from '@core/types';

function baseMatch(): Match {
  const t = MATCH_TEMPLATES[0]!;
  const now = Date.now();
  return {
    id: 'm_test',
    shareCode: 'ABC234',
    displayName: t.name,
    gameType: t.gameType,
    ruleSetSnapshot: snapshotRuleSet(t.ruleSet, now),
    matchFormat: 'singles',
    players: [
      { playerId: null, displayName: 'A', isAnonymous: true },
      { playerId: null, displayName: 'B', isAnonymous: true },
    ],
    activePlayerIndex: 0,
    status: 'READY',
    currentFrame: 1,
    target: t.target,
    engineState: {},
    engineStateVersion: 0,
    eventSeq: 1,
    schemaVersion: MATCH_SCHEMA_VERSION,
    frames: [],
    winnerPlayerId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function ev(
  id: string,
  type: MatchEvent['type'],
  payload: Record<string, unknown> = {},
  ts = 1,
): MatchEvent {
  return { id, matchId: 'm_test', timestamp: ts, type, payload };
}

describe('EventLog replay honors UNDO / REDO (append-only safety)', () => {
  it('replays to PLAYING from MATCH_CREATED + MATCH_STARTED', () => {
    const m = baseMatch();
    const log = [
      ev('e1', 'MATCH_CREATED', { match: m }, 1),
      ev('e2', 'MATCH_STARTED', {}, 2),
    ];
    expect(replayStatus(log)).toBe('PLAYING');
    expect(reconstructMatchFromEvents(log)?.status).toBe('PLAYING');
  });

  it('MATCH_CREATED alone replays to READY (not SETUP)', () => {
    const m = baseMatch();
    const log = [ev('e1', 'MATCH_CREATED', { match: m }, 1)];
    expect(replayStatus(log)).toBe('READY');
  });

  it('UNDO of MATCH_STARTED hides it without deleting the record', () => {
    const m = baseMatch();
    const log = [
      ev('e1', 'MATCH_CREATED', { match: m }, 1),
      ev('e2', 'MATCH_STARTED', {}, 2),
      ev('e3', 'UNDO', { targetEventIds: ['e2'] }, 3),
    ];

    // The raw log still contains the original event (append-only)…
    expect(log).toHaveLength(3);
    expect(log.some((e) => e.id === 'e2')).toBe(true);

    // …but the effective stream excludes it, so state goes back to READY.
    const effective = effectiveEvents(log);
    expect(effective.map((e) => e.id)).toEqual(['e1']);
    expect(replayStatus(log)).toBe('READY');
  });

  it('REDO after UNDO restores the event', () => {
    const m = baseMatch();
    const log = [
      ev('e1', 'MATCH_CREATED', { match: m }, 1),
      ev('e2', 'MATCH_STARTED', {}, 2),
      ev('e3', 'UNDO', { targetEventIds: ['e2'] }, 3),
      ev('e4', 'REDO', { targetEventIds: ['e2'] }, 4),
    ];
    expect(replayStatus(log)).toBe('PLAYING');
  });

  it('replayed frames drop when a FRAME_WON is undone', () => {
    const m = baseMatch();
    const log = [
      ev('e1', 'MATCH_CREATED', { match: m }, 1),
      ev('e2', 'MATCH_STARTED', {}, 2),
      ev('e3', 'FRAME_STARTED', { frame: 1 }, 2),
      ev('e4', 'FRAME_WON', { frame: 1, winnerPlayerIndex: 1 }, 3),
      ev('e5', 'UNDO', { targetEventIds: ['e4'] }, 4),
    ];

    const recovered = reconstructMatchFromEvents(log);
    expect(recovered).not.toBeNull();
    expect(recovered!.frames).toHaveLength(0);
    expect(recovered!.status).toBe('PLAYING');
  });

  it('replayed frames survive when nothing is undone', () => {
    const m = baseMatch();
    const log = [
      ev('e1', 'MATCH_CREATED', { match: m }, 1),
      ev('e2', 'MATCH_STARTED', {}, 2),
      ev('e3', 'FRAME_STARTED', { frame: 1 }, 2),
      ev('e4', 'FRAME_WON', { frame: 1, winnerPlayerIndex: 1 }, 3),
      ev('e5', 'MATCH_STARTED', {}, 4),
      ev('e6', 'FRAME_STARTED', { frame: 2 }, 4),
    ];

    const recovered = reconstructMatchFromEvents(log);
    expect(recovered!.frames).toHaveLength(1);
    expect(recovered!.frames[0]?.winnerPlayerIndex).toBe(1);
    expect(recovered!.currentFrame).toBe(2);
    expect(recovered!.status).toBe('PLAYING');
  });
});
