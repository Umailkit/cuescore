import { describe, it, expect } from 'vitest';
import type { MatchCommand } from '@core/types';
import { MATCH_TEMPLATES, snapshotRuleSet } from '@core/types';
import type { EngineContext } from '@core/engine/types';
import { NineBallEngine } from '@core/engine/nineBall/engine';
import type { NineBallState } from '@core/engine/nineBall/types';
import { FourBallEngine } from '@core/engine/fourBall/engine';
import type { FourBallState } from '@core/engine/fourBall/types';
import { DEFAULT_QUICK_POINTS, quickActions } from '@app/services/boardView';

const NINE = MATCH_TEMPLATES.find((t) => t.gameType === 'nine-ball')!;
const FOUR = MATCH_TEMPLATES.find((t) => t.gameType === 'four-ball')!;

const nineEngine = new NineBallEngine();
const fourEngine = new FourBallEngine();

function ctxFor(template: typeof NINE, config?: Record<string, unknown>): EngineContext {
  const ruleSet = { ...template.ruleSet, config: { ...template.ruleSet.config, ...config } };
  return {
    matchId: 'm-quick',
    gameType: template.gameType,
    players: [
      { playerId: 'p1', displayName: '张三', isAnonymous: false },
      { playerId: 'p2', displayName: '李四', isAnonymous: false },
    ],
    ruleSet: snapshotRuleSet(ruleSet, 1),
    target: template.target,
    matchFormat: 'singles',
  };
}

function nineFresh(config?: Record<string, unknown>): NineBallState {
  return nineEngine.createInitialState(ctxFor(NINE, config));
}
function nineRun(s: NineBallState, c: MatchCommand, config?: Record<string, unknown>) {
  return nineEngine.reduce(s, c, ctxFor(NINE, config));
}
function nineState(s: NineBallState, c: MatchCommand, config?: Record<string, unknown>) {
  return nineRun(s, c, config).state;
}

function fourFresh(config?: Record<string, unknown>): FourBallState {
  return fourEngine.createInitialState(ctxFor(FOUR, config));
}

describe('快捷档位：加一 / 加四 / 加八 / 加十', () => {
  it('默认档位就是 1 / 4 / 8 / 10', () => {
    expect(DEFAULT_QUICK_POINTS).toEqual([1, 4, 8, 10]);
  });

  it('九球（记分制）加扣成对给出四档', () => {
    const labels = quickActions('nine-ball', NINE.ruleSet.config).map((q) => q.label);
    expect(labels).toEqual(['+1', '+4', '+8', '+10', '-1', '-4', '-8', '-10']);
  });

  it('四球不是档位，而是追分五档得分类型', () => {
    const actions = quickActions('four-ball', FOUR.ruleSet.config);
    expect(actions.map((q) => q.label)).toEqual(['普胜', '小金', '大金', '黄金九', '黑金']);
    expect(actions.map((q) => q.hint)).toEqual(['+4', '+7', '+20', '+8', '-20']);
    expect(actions.map((q) => q.action.payload?.kind)).toEqual([
      'normal',
      'smallGold',
      'bigGold',
      'goldNine',
      'blackGold',
    ]);
    expect(actions.every((q) => q.action.type === 'CHASE_SCORED')).toBe(true);
  });

  it('档位由规则集配置决定，可覆盖（九球记分制）', () => {
    const labels = quickActions('nine-ball', {
      ...NINE.ruleSet.config,
      quickPoints: [2, 3],
    }).map((q) => q.label);
    expect(labels).toEqual(['+2', '+3', '-2', '-3']);
  });

  it('非法档位配置回落到默认值', () => {
    const config = { ...NINE.ruleSet.config, quickPoints: [0, -1, 'x'] };
    expect(quickActions('nine-ball', config)).toHaveLength(DEFAULT_QUICK_POINTS.length * 2);
    expect(quickActions('nine-ball', NINE.ruleSet.config).map((q) => q.label)).toEqual([
      '+1',
      '+4',
      '+8',
      '+10',
      '-1',
      '-4',
      '-8',
      '-10',
    ]);
  });

  it('档位按钮发出的命令就是 ADJUST_SCORE + 对应分值', () => {
    const plus8 = quickActions('nine-ball', NINE.ruleSet.config).find((q) => q.label === '+8')!;
    expect(plus8.action).toEqual({ type: 'ADJUST_SCORE', payload: { points: 8 } });
    const minus10 = quickActions('nine-ball', NINE.ruleSet.config).find(
      (q) => q.label === '-10',
    )!;
    expect(minus10.action).toEqual({ type: 'ADJUST_SCORE', payload: { points: -10 } });
  });
});

describe('选定谁就给谁加分', () => {
  it('九球可以指定记到对手名下，且不改变击球方', () => {
    const s = nineState(nineFresh(), {
      type: 'ADJUST_SCORE',
      payload: { points: 4, playerIndex: 1 },
    });
    expect(s.points).toEqual({ 0: 0, 1: 4 });
    expect(s.activePlayerIndex).toBe(0);
  });

  it('不指定席位时记给当前击球方', () => {
    const s = nineState(nineFresh(), { type: 'ADJUST_SCORE', payload: { points: 8 } });
    expect(s.points).toEqual({ 0: 8, 1: 0 });
  });

  it('席位越界被拒绝，且不产生事件', () => {
    const r = nineRun(nineFresh(), {
      type: 'ADJUST_SCORE',
      payload: { points: 1, playerIndex: 5 },
    });
    expect(r.trace.validation).toBe('ILLEGAL');
    expect(r.events).toEqual([]);
    expect(r.state.points).toEqual({ 0: 0, 1: 0 });
  });

  it('先给 A 加、再给 B 加，两人各记各的', () => {
    let s = nineFresh();
    s = nineState(s, { type: 'ADJUST_SCORE', payload: { points: 4, playerIndex: 0 } });
    s = nineState(s, { type: 'ADJUST_SCORE', payload: { points: 1, playerIndex: 1 } });
    expect(s.points).toEqual({ 0: 4, 1: 1 });
  });

  it('四球也支持指定席位', () => {
    const ctx = ctxFor(FOUR);
    const s = fourEngine.reduce(
      fourFresh(),
      { type: 'ADJUST_SCORE', payload: { points: 4, playerIndex: 1 } },
      ctx,
    ).state;
    expect(s.points).toEqual({ 0: 0, 1: 4 });
  });

  it('加到目标分即本局结束，快照仍带完整比分', () => {
    const s = nineState(nineFresh(), {
      type: 'ADJUST_SCORE',
      payload: { points: 10, playerIndex: 0 },
    });
    expect(s.frameStatus).toBe('WON');
    expect(s.winnerPlayerIndex).toBe(0);
    expect(nineEngine.getFrameScores(s)).toEqual({ 0: 10, 1: 0 });

    // 本局已结束，再记分会被忽略（不会记到下一局去）
    const after = nineRun(s, { type: 'ADJUST_SCORE', payload: { points: 1, playerIndex: 1 } });
    expect(after.state.points).toEqual({ 0: 10, 1: 0 });
  });
});

describe('本局分数快照（供排名总览累计）', () => {
  it('还没得分时返回 null，不产生空快照', () => {
    expect(nineEngine.getFrameScores(nineFresh())).toBeNull();
    expect(fourEngine.getFrameScores(fourFresh())).toBeNull();
  });

  it('得分后返回每个座位的分数', () => {
    const s = nineState(nineFresh(), { type: 'ADJUST_SCORE', payload: { points: 8 } });
    expect(nineEngine.getFrameScores(s)).toEqual({ 0: 8, 1: 0 });
  });

  it('重摆本局后分数归零，快照回到 null', () => {
    let s = nineState(nineFresh(), { type: 'ADJUST_SCORE', payload: { points: 4 } });
    s = nineState(s, { type: 'RERACK' });
    expect(nineEngine.getFrameScores(s)).toBeNull();
  });
});
