import { describe, it, expect } from 'vitest';
import type { MatchCommand, MatchEvent } from '@core/types';
import { MATCH_TEMPLATES, snapshotRuleSet } from '@core/types';
import type { EngineContext } from '@core/engine/types';
import { SixBallEngine, applySixBallEvent } from '@core/engine/sixBall/engine';
import type { SixBallState } from '@core/engine/sixBall/types';
import { FourBallEngine, applyFourBallEvent } from '@core/engine/fourBall/engine';
import type { FourBallState } from '@core/engine/fourBall/types';

const SIX = MATCH_TEMPLATES.find((t) => t.gameType === 'six-ball')!;
const FOUR = MATCH_TEMPLATES.find((t) => t.gameType === 'four-ball')!;

const sixEngine = new SixBallEngine();
const fourEngine = new FourBallEngine();

function ctxFor(template: typeof SIX, config?: Record<string, unknown>): EngineContext {
  const ruleSet = { ...template.ruleSet, config: { ...template.ruleSet.config, ...config } };
  return {
    matchId: 'm-points',
    gameType: template.gameType,
    players: [
      { playerId: 'p1', displayName: 'P1', isAnonymous: false },
      { playerId: 'p2', displayName: 'P2', isAnonymous: false },
    ],
    ruleSet: snapshotRuleSet(ruleSet, 1),
    target: template.target,
    matchFormat: 'singles',
  };
}

function sixFresh(config?: Record<string, unknown>): SixBallState {
  return sixEngine.createInitialState(ctxFor(SIX, config));
}
function sixRun(s: SixBallState, c: MatchCommand, config?: Record<string, unknown>) {
  return sixEngine.reduce(s, c, ctxFor(SIX, config));
}
function sixState(s: SixBallState, c: MatchCommand, config?: Record<string, unknown>): SixBallState {
  return sixRun(s, c, config).state;
}

function fourFresh(config?: Record<string, unknown>): FourBallState {
  return fourEngine.createInitialState(ctxFor(FOUR, config));
}
function fourRun(s: FourBallState, c: MatchCommand, config?: Record<string, unknown>) {
  return fourEngine.reduce(s, c, ctxFor(FOUR, config));
}
function fourState(s: FourBallState, c: MatchCommand, config?: Record<string, unknown>): FourBallState {
  return fourRun(s, c, config).state;
}

// ---------------------------------------------------------------------------
describe('六球：计分制', () => {
  it('每球 1 分（config.perBall 默认 1）', () => {
    let s = sixState(sixFresh(), { type: 'BREAK_STARTED' });
    s = sixState(s, { type: 'BALL_POTTED', payload: { ball: 1 } });
    expect(s.points[0]).toBe(1);
    s = sixState(s, { type: 'BALL_POTTED', payload: { ball: 2 } });
    expect(s.points[0]).toBe(2);
  });

  it('perBall 可配置', () => {
    const cfg: Record<string, unknown> = { perBall: 2 };
    let s = sixState(sixFresh(cfg), { type: 'BREAK_STARTED' }, cfg);
    s = sixState(s, { type: 'BALL_POTTED', payload: { ball: 1 } }, cfg);
    expect(s.points[0]).toBe(2);
  });

  it('先达到 targetPoints 赢下本局', () => {
    const cfg: Record<string, unknown> = { perBall: 1, targetPoints: 3 };
    let s = sixState(sixFresh(cfg), { type: 'BREAK_STARTED' }, cfg);
    s = sixState(s, { type: 'BALL_POTTED', payload: { ball: 1 } }, cfg);
    s = sixState(s, { type: 'BALL_POTTED', payload: { ball: 2 } }, cfg);
    expect(s.frameStatus).toBe('PLAYING');
    const r = sixRun(s, { type: 'BALL_POTTED', payload: { ball: 3 } }, cfg);
    expect(r.state.frameStatus).toBe('WON');
    expect(r.state.winnerPlayerIndex).toBe(0);
    expect(r.events.map((e) => e.type)).toContain('FRAME_WON');
  });

  it('犯规给对手加分（默认 +1）', () => {
    let s = sixState(sixFresh(), { type: 'BREAK_STARTED' });
    s = sixState(s, { type: 'FOUL', payload: { reason: 'SCRATCH' } });
    expect(s.points[1]).toBe(1);
    expect(s.activePlayerIndex).toBe(1);
  });

  it('犯规加分也可能直接把对手送到目标分', () => {
    const cfg: Record<string, unknown> = { targetPoints: 1, foulPenalty: 1 };
    const s = sixState(sixFresh(cfg), { type: 'BREAK_STARTED' }, cfg);
    const r = sixRun(s, { type: 'FOUL', payload: { reason: 'SCRATCH' } }, cfg);
    expect(r.state.frameStatus).toBe('WON');
    expect(r.state.winnerPlayerIndex).toBe(1);
  });

  it('空杆判犯规', () => {
    const s = sixState(sixFresh(), { type: 'BALL_MISSED', payload: {} });
    expect(s.foul.reason).toBe('NO_CONTACT');
  });

  it('非法球号被拒且不改状态', () => {
    const s = sixState(sixFresh(), { type: 'BREAK_STARTED' });
    const r = sixRun(s, { type: 'BALL_POTTED', payload: { ball: 9 } });
    expect(r.trace.validation).toBe('ILLEGAL');
    expect(r.state).toBe(s);
  });

  it('重放后逐字段一致', () => {
    let s = sixFresh();
    const events: MatchEvent[] = [];
    const push = (c: MatchCommand) => {
      const r = sixEngine.reduce(s, c, ctxFor(SIX));
      s = r.state;
      events.push(...r.events);
    };
    push({ type: 'BREAK_STARTED' });
    push({ type: 'BALL_POTTED', payload: { ball: 1 } });
    push({ type: 'BALL_MISSED', payload: {} });
    push({ type: 'BALL_POTTED', payload: { ball: 2 } });
    const replayed = events.reduce(applySixBallEvent, sixFresh());
    const keys = [...new Set([...Object.keys(s), ...Object.keys(replayed)])].sort();
    expect(
      keys.filter(
        (k) => JSON.stringify((s as never)[k]) !== JSON.stringify((replayed as never)[k]),
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('四球：自定义加分', () => {
  it('SCORE 直接按给定分值加分', () => {
    const s = fourState(fourFresh(), { type: 'SCORE', payload: { points: 3 } });
    expect(s.points[0]).toBe(3);
  });

  it('未给分值时使用 config.scoring.p1 档位（默认 +1）', () => {
    const s = fourState(fourFresh(), { type: 'SCORE', payload: {} });
    expect(s.points[0]).toBe(1);
  });

  it('快捷档位 p1/p2/p3 可从 config 读出', () => {
    const cfg: Record<string, unknown> = { scoring: { p1: 1, p2: 2, p3: 3, custom: 0 } };
    const s = fourState(fourFresh(cfg), { type: 'SCORE', payload: { points: 2 } }, cfg);
    expect(s.points[0]).toBe(2);
  });

  it('0 或负数的分值被拒', () => {
    const r = fourRun(fourFresh(), { type: 'SCORE', payload: { points: 0 } });
    expect(r.trace.validation).toBe('ILLEGAL');
    expect(r.state.points[0]).toBe(0);
  });

  it('先达到 targetPoints 赢下本局', () => {
    const cfg: Record<string, unknown> = { targetPoints: 5 };
    const s = fourState(fourFresh(cfg), { type: 'SCORE', payload: { points: 3 } }, cfg);
    expect(s.frameStatus).toBe('PLAYING');
    const r = fourRun(s, { type: 'SCORE', payload: { points: 2 } }, cfg);
    expect(r.state.frameStatus).toBe('WON');
    expect(r.state.winnerPlayerIndex).toBe(0);
  });

  it('犯规默认对手 +1（config.foul = opponent_plus_1）', () => {
    const s = fourState(fourFresh(), { type: 'FOUL', payload: { reason: 'SCRATCH' } });
    expect(s.points[1]).toBe(1);
    expect(s.activePlayerIndex).toBe(1);
  });

  it('foul = none 时不加分', () => {
    const cfg: Record<string, unknown> = { foul: 'none' };
    const s = fourState(fourFresh(cfg), { type: 'FOUL', payload: { reason: 'SCRATCH' } }, cfg);
    expect(s.points[1]).toBe(0);
  });

  it('空杆按犯规处理', () => {
    const s = fourState(fourFresh(), { type: 'BALL_MISSED', payload: {} });
    expect(s.points[1]).toBe(1);
  });

  it('认输把本局判给对手', () => {
    const r = fourRun(fourFresh(), { type: 'CONCEDE', payload: {} });
    expect(r.state.frameStatus).toBe('LOST');
    expect(r.state.winnerPlayerIndex).toBe(1);
  });

  it('重放后逐字段一致', () => {
    let s = fourFresh();
    const events: MatchEvent[] = [];
    const push = (c: MatchCommand) => {
      const r = fourEngine.reduce(s, c, ctxFor(FOUR));
      s = r.state;
      events.push(...r.events);
    };
    push({ type: 'SCORE', payload: { points: 2 } });
    push({ type: 'END_TURN', payload: {} });
    push({ type: 'SCORE', payload: { points: 3 } });
    push({ type: 'FOUL', payload: { reason: 'SCRATCH' } });
    const replayed = events.reduce(applyFourBallEvent, fourFresh());
    const keys = [...new Set([...Object.keys(s), ...Object.keys(replayed)])].sort();
    expect(
      keys.filter(
        (k) => JSON.stringify((s as never)[k]) !== JSON.stringify((replayed as never)[k]),
      ),
    ).toEqual([]);
  });
});

describe('四球：加多少扣多少', () => {
  it('扣分能把记错的一笔改回来', () => {
    let s = fourState(fourFresh(), { type: 'SCORE', payload: { points: 3 } });
    expect(s.points[0]).toBe(3);
    s = fourState(s, { type: 'ADJUST_SCORE', payload: { points: -2 } });
    expect(s.points[0]).toBe(1);
  });

  it('扣成负数被拒绝', () => {
    const base = fourState(fourFresh(), { type: 'ADJUST_SCORE', payload: { points: 2 } });
    const r = fourRun(base, { type: 'ADJUST_SCORE', payload: { points: -3 } });
    expect(r.trace.validation).toBe('ILLEGAL');
    expect(r.events).toEqual([]);
    expect(r.state.points[0]).toBe(2);
  });

  it('人工加分也能触发达标获胜', () => {
    const r = fourRun(fourFresh(), {
      type: 'ADJUST_SCORE',
      payload: { points: 15 },
    });
    expect(r.state.frameStatus).toBe('WON');
    expect(r.state.winnerPlayerIndex).toBe(0);
    expect(r.events.some((e) => e.type === 'FRAME_WON')).toBe(true);
  });

  it('重放后逐字段一致（含扣分）', () => {
    let s = fourFresh();
    const events: MatchEvent[] = [];
    for (const cmd of [
      { type: 'SCORE', payload: { points: 3 } },
      { type: 'ADJUST_SCORE', payload: { points: -1 } },
      { type: 'ADJUST_SCORE', payload: { points: 2 } },
    ] as MatchCommand[]) {
      const r = fourRun(s, cmd);
      s = r.state;
      events.push(...r.events);
    }
    const replayed = events.reduce(applyFourBallEvent, fourFresh());
    const keys = [...new Set([...Object.keys(s), ...Object.keys(replayed)])].sort();
    const mismatches = keys.filter(
      (k) => JSON.stringify((s as never)[k]) !== JSON.stringify((replayed as never)[k]),
    );
    expect(mismatches).toEqual([]);
    expect(s.points[0]).toBe(4);
  });
});
