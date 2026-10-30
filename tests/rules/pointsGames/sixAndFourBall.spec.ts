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

  it('未给分值时使用 config.scoring.p1 档位（追分模板为 4）', () => {
    const s = fourState(fourFresh(), { type: 'SCORE', payload: {} });
    expect(s.points[0]).toBe(4);
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
    const cfg: Record<string, unknown> = { targetPoints: 15 };
    const r = fourRun(
      fourFresh(cfg),
      {
        type: 'ADJUST_SCORE',
        payload: { points: 15 },
      },
      cfg,
    );
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

// ---------------------------------------------------------------------------
// 追分：五档得分类型，上家/下家按规则表赔付
// ---------------------------------------------------------------------------
describe('四球追分：上家/下家赔付', () => {
  const NAMES = ['甲', '乙', '丙', '丁'];

  function ctx4(): EngineContext {
    return {
      matchId: 'm-chase',
      gameType: 'four-ball',
      players: NAMES.map((n, i) => ({
        playerId: `p${i}`,
        displayName: n,
        isAnonymous: false,
      })),
      ruleSet: snapshotRuleSet(FOUR.ruleSet, 1),
      target: 0,
      matchFormat: 'singles',
    };
  }
  const fresh4 = () => fourEngine.createInitialState(ctx4());
  const run4 = (s: FourBallState, c: MatchCommand) => fourEngine.reduce(s, c, ctx4());
  const chase = (s: FourBallState, kind: string, playerIndex?: number) =>
    run4(s, { type: 'CHASE_SCORED', payload: { kind, ...(playerIndex !== undefined ? { playerIndex } : {}) } });

  it('普胜：上家赔 4，本家 +4', () => {
    const r = chase(fresh4(), 'normal', 1);
    expect(r.state.points).toEqual({ 0: -4, 1: 4, 2: 0, 3: 0 });
  });

  it('小金：上家赔 7，本家 +7', () => {
    const r = chase(fresh4(), 'smallGold', 2);
    expect(r.state.points).toEqual({ 0: 0, 1: -7, 2: 7, 3: 0 });
  });

  it('大金：上家与下家各赔 10，本家 +20', () => {
    const r = chase(fresh4(), 'bigGold', 0);
    expect(r.state.points).toEqual({ 0: 20, 1: -10, 2: 0, 3: -10 });
  });

  it('黄金九：上家与下家各赔 4，本家 +8', () => {
    const r = chase(fresh4(), 'goldNine', 0);
    expect(r.state.points).toEqual({ 0: 8, 1: -4, 2: 0, 3: -4 });
  });

  it('黑金：本家赔给上/下家各 10，净得 -20', () => {
    const r = chase(fresh4(), 'blackGold', 0);
    expect(r.state.points).toEqual({ 0: -20, 1: 10, 2: 0, 3: 10 });
  });

  it('任何一档结算都是零和（分数不会凭空出现）', () => {
    for (const kind of ['normal', 'smallGold', 'bigGold', 'goldNine', 'blackGold']) {
      const r = chase(fresh4(), kind, 1);
      const sum = Object.values(r.state.points).reduce((a, b) => a + b, 0);
      expect(sum, `${kind} 应零和`).toBe(0);
    }
  });

  it('两人局：上家与下家是同一个人，赔付叠加', () => {
    const s = fourEngine.createInitialState(ctxFor(FOUR));
    const r = fourEngine.reduce(
      s,
      { type: 'CHASE_SCORED', payload: { kind: 'bigGold' } },
      ctxFor(FOUR),
    );
    expect(r.state.points).toEqual({ 0: 20, 1: -20 });
  });

  it('未知的得分类型被拒绝', () => {
    const r = chase(fresh4(), 'nope', 0);
    expect(r.trace.validation).toBe('ILLEGAL');
    expect(r.events).toEqual([]);
  });

  it('可以指定算给谁，且不改变击球方', () => {
    const r = chase(fresh4(), 'normal', 3);
    expect(r.state.points[3]).toBe(4);
    expect(r.state.activePlayerIndex).toBe(0);
  });

  it('重放后逐字段一致（连续结算 + 改账）', () => {
    let s = fresh4();
    const events: MatchEvent[] = [];
    for (const cmd of [
      { type: 'CHASE_SCORED', payload: { kind: 'bigGold', playerIndex: 0 } },
      { type: 'CHASE_SCORED', payload: { kind: 'goldNine', playerIndex: 2 } },
      { type: 'CHASE_SCORED', payload: { kind: 'blackGold', playerIndex: 1 } },
      // 人工改账仍不允许扣成负数，所以这里用加分
      { type: 'ADJUST_SCORE', payload: { points: 1, playerIndex: 3 } },
    ] as MatchCommand[]) {
      const r = fourEngine.reduce(s, cmd, ctx4());
      s = r.state;
      events.push(...r.events);
    }
    const replayed = events.reduce(applyFourBallEvent, fresh4());
    const keys = [...new Set([...Object.keys(s), ...Object.keys(replayed)])].sort();
    const mismatches = keys.filter(
      (k) => JSON.stringify((s as never)[k]) !== JSON.stringify((replayed as never)[k]),
    );
    expect(mismatches).toEqual([]);
    // 大金（0 号 +20）/ 黄金九（2 号 +8）/ 黑金（1 号 -20）/ 改账 +1
    expect(s.points).toEqual({ 0: 30, 1: -34, 2: 18, 3: -13 });
  });

  it('开新局不清零（追分整场累计）', () => {
    const r = chase(fresh4(), 'normal', 0);
    const next = fourEngine.startFrame(r.state, 0, ctx4());
    expect(next.points).toEqual(r.state.points);
    expect(next.frameStatus).toBe('PLAYING');
  });

  it('本局快照就是累计总分，且允许为负', () => {
    const r = chase(fresh4(), 'blackGold', 0);
    expect(fourEngine.getFrameScores(r.state)).toEqual({ 0: -20, 1: 10, 2: 0, 3: 10 });
  });
});
