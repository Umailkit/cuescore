import { describe, it, expect } from 'vitest';
import type { MatchCommand, MatchEvent } from '@core/types';
import { MATCH_TEMPLATES, snapshotRuleSet } from '@core/types';
import type { EngineContext } from '@core/engine/types';
import { NineBallEngine, applyNineBallEvent, lowestBallOnTable } from '@core/engine/nineBall/engine';
import type { NineBallState } from '@core/engine/nineBall/types';

const TEMPLATE = MATCH_TEMPLATES.find((t) => t.gameType === 'nine-ball')!;
const engine = new NineBallEngine();

function ctxWith(config?: Record<string, unknown>): EngineContext {
  // 模板默认是记分制；本文件的「按号序击打」用例显式钉在清台口径上，
  // 记分制的用例自己传 scoringMode: 'points'。
  const ruleSet = {
    ...TEMPLATE.ruleSet,
    config: { ...TEMPLATE.ruleSet.config, scoringMode: 'sequence', targetPoints: 0, ...config },
  };
  return {
    matchId: 'm-nine',
    gameType: 'nine-ball',
    players: [
      { playerId: 'p1', displayName: 'P1', isAnonymous: false },
      { playerId: 'p2', displayName: 'P2', isAnonymous: false },
    ],
    ruleSet: snapshotRuleSet(ruleSet, 1),
    target: 7,
    matchFormat: 'singles',
  };
}

const ctx = ctxWith();

function fresh(config?: Record<string, unknown>): NineBallState {
  return engine.createInitialState(ctxWith(config));
}
function run(s: NineBallState, c: MatchCommand, config?: Record<string, unknown>) {
  return engine.reduce(s, c, ctxWith(config));
}
function state(s: NineBallState, c: MatchCommand, config?: Record<string, unknown>): NineBallState {
  return run(s, c, config).state;
}
/** 开球（开球这一杆还没打）。 */
function broken(config?: Record<string, unknown>): NineBallState {
  return state(fresh(config), { type: 'BREAK_STARTED' }, config);
}

describe('九球：按号序击打', () => {
  it('开球后台面最小号球是 1 号', () => {
    expect(lowestBallOnTable(fresh())).toBe(1);
  });

  it('先碰的必须是台面最小号球，否则判犯规换手', () => {
    const s = broken();
    const r = run(s, { type: 'BALL_POTTED', payload: { ball: 1, firstContact: 5 } });
    expect(r.trace.validation).toBe('ILLEGAL');
    expect(r.state.foul.reason).toBe('WRONG_BALL_FIRST');
    expect(r.state.activePlayerIndex).toBe(1);
  });

  it('先碰最小号球即为合法', () => {
    const r = run(broken(), { type: 'BALL_POTTED', payload: { ball: 1, firstContact: 1 } });
    expect(r.trace.validation).toBe('LEGAL');
    expect(r.state.activePlayerIndex).toBe(0);
  });

  it('打进一颗球后台面最小号球前移', () => {
    let s = state(broken(), { type: 'BALL_POTTED', payload: { ball: 1 } });
    expect(lowestBallOnTable(s)).toBe(2);
    s = state(s, { type: 'BALL_POTTED', payload: { ball: 2 } });
    expect(lowestBallOnTable(s)).toBe(3);
  });
});

describe('九球：9 号球', () => {
  it('合法打进 9 号球赢下本局', () => {
    let s = broken();
    for (const b of [1, 2, 3, 4, 5, 6, 7, 8]) {
      s = state(s, { type: 'BALL_POTTED', payload: { ball: b } });
    }
    const r = run(s, { type: 'BALL_POTTED', payload: { ball: 9 } });
    expect(r.state.frameStatus).toBe('WON');
    expect(r.state.winnerPlayerIndex).toBe(0);
    expect(r.events.map((e) => e.type)).toContain('FRAME_WON');
  });

  it('开球打进 9 号球直接获胜（config.nineOnBreak 默认 true）', () => {
    const r = run(broken(), { type: 'BALL_POTTED', payload: { ball: 9 } });
    expect(r.state.frameStatus).toBe('WON');
    expect(r.state.winReason).toBe('开球打进 9 号球');
  });

  it('nineOnBreak=false 时开球打进 9 号要重新摆球', () => {
    const r = run(broken({ nineOnBreak: false }), { type: 'BALL_POTTED', payload: { ball: 9 } }, { nineOnBreak: false });
    expect(r.state.frameStatus).toBe('PLAYING');
    expect(r.state.balls[9]).toBe('ON_TABLE');
    expect(r.events.map((e) => e.type)).toContain('RERACK');
  });

  it('非法打进 9 号球要摆回台面，而不是判负', () => {
    const s = broken();
    const r = run(s, { type: 'BALL_POTTED', payload: { ball: 9, firstContact: 3 } });
    expect(r.state.frameStatus).toBe('PLAYING');
    expect(r.state.balls[9]).toBe('ON_TABLE');
    expect(r.state.foul.reason).toBe('WRONG_BALL_FIRST');
    expect(r.state.activePlayerIndex).toBe(1);
  });
});

describe('九球：犯规', () => {
  it('母球落袋判犯规并换手', () => {
    const r = run(broken(), { type: 'BALL_POTTED', payload: { ball: 0 } });
    expect(r.state.foul.reason).toBe('SCRATCH');
    expect(r.state.activePlayerIndex).toBe(1);
    expect(r.state.ballInHand).toBe(true);
  });

  it('空杆判犯规并换手', () => {
    const r = run(broken(), { type: 'BALL_MISSED', payload: {} });
    expect(r.state.foul.reason).toBe('NO_CONTACT');
    expect(r.state.activePlayerIndex).toBe(1);
  });

  it('连续三次犯规判负本局', () => {
    const c: Record<string, unknown> = { threeFoulsLosesFrame: true };
    let s = broken(c);
    // P1 犯规 → P2 → P2 犯规 → P1 → P1 第二次犯规 → P1 第三次
    s = state(s, { type: 'FOUL', payload: { reason: 'NO_CONTACT' } }, c); // P1 #1
    s = state(s, { type: 'FOUL', payload: { reason: 'NO_CONTACT' } }, c); // P2 #1
    s = state(s, { type: 'FOUL', payload: { reason: 'NO_CONTACT' } }, c); // P1 #2
    expect(s.frameStatus).toBe('PLAYING');
    const r = run(s, { type: 'FOUL', payload: { reason: 'NO_CONTACT' } }, c); // P2 #2
    expect(r.state.frameStatus).toBe('PLAYING');
    const r2 = run(r.state, { type: 'FOUL', payload: { reason: 'NO_CONTACT' } }, c); // P1 #3
    expect(r2.state.frameStatus).toBe('LOST');
    expect(r2.state.loserPlayerIndex).toBe(0);
  });

  it('threeFoulsLosesFrame=false 时不判负', () => {
    const c: Record<string, unknown> = { threeFoulsLosesFrame: false };
    let s = broken(c);
    for (let i = 0; i < 5; i += 1) {
      s = state(s, { type: 'FOUL', payload: { reason: 'NO_CONTACT' } }, c);
    }
    expect(s.frameStatus).toBe('PLAYING');
  });

  it('合法击球会清掉连续犯规计数', () => {
    let s = broken();
    // P1 犯规 → 换手到 P2
    s = state(s, { type: 'FOUL', payload: { reason: 'NO_CONTACT' } });
    // P2 交回球权（不犯规），让 P1 能再犯一次
    s = state(s, { type: 'END_TURN', payload: {} });
    s = state(s, { type: 'FOUL', payload: { reason: 'NO_CONTACT' } });
    expect(s.consecutiveFouls[0]).toBe(2);
    s = state(s, { type: 'END_TURN', payload: {} });
    s = state(s, { type: 'BALL_POTTED', payload: { ball: 1 } });
    expect(s.consecutiveFouls[0]).toBe(0);
  });
});

describe('九球：Push Out', () => {
  it('开球后第一杆可以声明 Push Out，之后换手', () => {
    const s = broken();
    const r = run(s, { type: 'PUSH_OUT', payload: {} });
    expect(r.trace.validation).toBe('LEGAL');
    expect(r.state.pushOut.used).toBe(true);
    expect(r.state.activePlayerIndex).toBe(1);
  });

  it('Push Out 一局只能用一次', () => {
    let s = broken();
    s = state(s, { type: 'PUSH_OUT', payload: {} });
    const r = run(s, { type: 'PUSH_OUT', payload: {} });
    expect(r.trace.validation).toBe('IGNORED');
  });

  it('开球前不能 Push Out', () => {
    const r = run(fresh(), { type: 'PUSH_OUT', payload: {} });
    expect(r.trace.validation).toBe('IGNORED');
  });

  it('config.pushOut=false 时忽略', () => {
    const c: Record<string, unknown> = { pushOut: false };
    const r = run(broken(c), { type: 'PUSH_OUT', payload: {} }, c);
    expect(r.trace.validation).toBe('IGNORED');
  });
});

describe('九球：认输与裁判裁定', () => {
  it('认输把本局判给对手', () => {
    const r = run(broken(), { type: 'CONCEDE', payload: {} });
    expect(r.state.frameStatus).toBe('LOST');
    expect(r.state.winnerPlayerIndex).toBe(1);
  });

  it('COMPLETE_FRAME 可指定胜方', () => {
    const r = run(broken(), { type: 'COMPLETE_FRAME', payload: { winnerPlayerIndex: 1 } });
    expect(r.state.winnerPlayerIndex).toBe(1);
  });

  it('席位越界被拒', () => {
    const r = run(broken(), { type: 'COMPLETE_FRAME', payload: { winnerPlayerIndex: 9 } });
    expect(r.trace.validation).toBe('ILLEGAL');
  });
});

describe('九球：重放保真', () => {
  it('整局重放后逐字段一致', () => {
    let s = fresh();
    const events: MatchEvent[] = [];
    const push = (c: MatchCommand) => {
      const r = engine.reduce(s, c, ctx);
      s = r.state;
      events.push(...r.events);
    };
    push({ type: 'BREAK_STARTED' });
    push({ type: 'BALL_POTTED', payload: { ball: 1 } });
    push({ type: 'BALL_MISSED', payload: {} });
    push({ type: 'BALL_POTTED', payload: { ball: 2 } });
    push({ type: 'FOUL', payload: { reason: 'SCRATCH' } });
    push({ type: 'BALL_POTTED', payload: { ball: 3 } });

    const replayed = events.reduce(applyNineBallEvent, fresh());
    const keys = [...new Set([...Object.keys(s), ...Object.keys(replayed)])].sort();
    const mismatches = keys.filter(
      (k) => JSON.stringify((s as never)[k]) !== JSON.stringify((replayed as never)[k]),
    );
    expect(mismatches).toEqual([]);
  });
});

describe('九球：记分制（加多少扣多少）', () => {
  const SCORING = { scoringMode: 'points', targetPoints: 7 };

  it('加分：进一颗球记一分', () => {
    const s = state(fresh(SCORING), { type: 'ADJUST_SCORE', payload: { points: 1 } }, SCORING);
    expect(s.points[0]).toBe(1);
    expect(s.frameStatus).toBe('PLAYING');
  });

  it('扣分：记错了能扣回来', () => {
    let s = fresh(SCORING);
    s = state(s, { type: 'ADJUST_SCORE', payload: { points: 3 } }, SCORING);
    s = state(s, { type: 'ADJUST_SCORE', payload: { points: -1 } }, SCORING);
    expect(s.points[0]).toBe(2);
  });

  it('扣成负数被拒绝，分数不变', () => {
    const base = state(fresh(SCORING), { type: 'ADJUST_SCORE', payload: { points: 2 } }, SCORING);
    const r = run(base, { type: 'ADJUST_SCORE', payload: { points: -5 } }, SCORING);
    expect(r.trace.validation).toBe('ILLEGAL');
    expect(r.events).toEqual([]);
    expect(r.state.points[0]).toBe(2);
  });

  it('分值为 0 或非整数被拒绝', () => {
    for (const points of [0, 1.5, 'x']) {
      const r = run(fresh(SCORING), { type: 'ADJUST_SCORE', payload: { points } }, SCORING);
      expect(r.trace.validation).toBe('ILLEGAL');
      expect(r.events).toEqual([]);
    }
  });

  it('先到 targetPoints 分赢下本局', () => {
    const r = run(fresh(SCORING), { type: 'ADJUST_SCORE', payload: { points: 7 } }, SCORING);
    expect(r.state.frameStatus).toBe('WON');
    expect(r.state.winnerPlayerIndex).toBe(0);
    expect(r.state.winReason).toContain('7');
    expect(r.events.some((e) => e.type === 'FRAME_WON')).toBe(true);
  });

  it('清台口径下不认加减分（不悄悄改语义）', () => {
    const r = run(fresh(), { type: 'ADJUST_SCORE', payload: { points: 1 } });
    expect(r.trace.validation).toBe('IGNORED');
    expect(r.events).toEqual([]);
  });

  it('重放后逐字段一致', () => {
    let s = fresh(SCORING);
    const events: MatchEvent[] = [];
    for (const points of [1, 2, -1, 3]) {
      const r = engine.reduce(s, { type: 'ADJUST_SCORE', payload: { points } }, ctxWith(SCORING));
      s = r.state;
      events.push(...r.events);
    }
    const replayed = events.reduce(applyNineBallEvent, fresh(SCORING));
    expect(replayed.points).toEqual(s.points);
    expect(replayed.frameStatus).toBe(s.frameStatus);
    expect(replayed.winnerPlayerIndex).toBe(s.winnerPlayerIndex);
    expect(s.points[0]).toBe(5);
  });
});
