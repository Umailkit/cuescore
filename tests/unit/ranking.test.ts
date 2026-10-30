import { describe, it, expect } from 'vitest';
import type { GameType, Match, FrameResult } from '@core/types';
import { buildRanking, hasScores, seatTotals } from '@app/services/ranking';

let seq = 0;

function frame(scores?: Record<number, number>, winnerPlayerIndex = 0): FrameResult {
  return { index: 0, winnerPlayerIndex, winnerPlayerId: null, ...(scores ? { scores } : {}) };
}

function match(opts: {
  players: Array<{ displayName: string; playerId?: string | null }>;
  frames?: FrameResult[];
  gameType?: GameType;
  id?: string;
}): Match {
  seq += 1;
  return {
    id: opts.id ?? `m${seq}`,
    shareCode: 'X',
    displayName: 'x',
    gameType: opts.gameType ?? 'four-ball',
    ruleSetSnapshot: {
      id: 'r',
      name: 'r',
      version: '1',
      description: '',
      source: '',
      config: {},
      frozenAt: 0,
    },
    matchFormat: 'singles',
    players: opts.players.map((p) => ({
      playerId: p.playerId ?? null,
      displayName: p.displayName,
      isAnonymous: !p.playerId,
    })),
    activePlayerIndex: 0,
    status: 'MATCH_END',
    currentFrame: 1,
    target: 0,
    engineState: null,
    engineStateVersion: 0,
    eventSeq: 0,
    schemaVersion: 1,
    frames: opts.frames ?? [],
    winnerPlayerId: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('seatTotals', () => {
  it('sums each seat across frames', () => {
    const m = match({
      players: [{ displayName: '张三' }, { displayName: '李四' }],
      frames: [frame({ 0: 8, 1: 4 }), frame({ 0: 1, 1: 10 })],
    });
    expect(seatTotals(m)).toEqual([9, 14]);
  });

  it('treats a match without scores as zero (八球 etc.)', () => {
    const m = match({
      players: [{ displayName: '张三' }, { displayName: '李四' }],
      frames: [frame(undefined), frame(undefined)],
      gameType: 'eight-ball',
    });
    expect(seatTotals(m)).toEqual([0, 0]);
    expect(hasScores(m)).toBe(false);
  });
});

describe('buildRanking', () => {
  it('merges the same registered player across matches', () => {
    const a = match({
      players: [{ displayName: '张三', playerId: 'p1' }, { displayName: '李四', playerId: 'p2' }],
      frames: [frame({ 0: 8, 1: 4 })],
    });
    const b = match({
      players: [{ displayName: '张三', playerId: 'p1' }, { displayName: '李四', playerId: 'p2' }],
      frames: [frame({ 0: 1, 1: 10 })],
    });

    const rows = buildRanking([a, b]);
    const zhang = rows.find((r) => r.name === '张三');
    expect(zhang).toMatchObject({ total: 9, matches: 2, frames: 2, best: 8 });
    expect(rows.map((r) => r.name)).toEqual(['李四', '张三']);
  });

  it('merges anonymous players by name and skips matches without scores', () => {
    const scored = match({
      players: [{ displayName: '王五' }, { displayName: '赵六' }],
      frames: [frame({ 0: 4, 1: 0 })],
    });
    const eightBall = match({
      players: [{ displayName: '王五' }, { displayName: '赵六' }],
      frames: [frame(undefined), frame(undefined, 1)],
      gameType: 'eight-ball',
    });

    const rows = buildRanking([scored, eightBall]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: '王五', total: 4, matches: 1, frames: 1 });
  });

  it('keeps zero-score participants of a scoring match', () => {
    const m = match({
      players: [{ displayName: '张三' }, { displayName: '李四' }],
      frames: [frame({ 0: 10, 1: 0 })],
    });
    const rows = buildRanking([m]);
    expect(rows.map((r) => [r.name, r.total])).toEqual([
      ['张三', 10],
      ['李四', 0],
    ]);
  });

  it('returns an empty ranking when nothing is scored', () => {
    expect(buildRanking([match({ players: [{ displayName: '张三' }] })])).toEqual([]);
  });
});
