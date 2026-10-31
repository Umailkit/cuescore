import { describe, it, expect } from 'vitest';
import type { MatchCommand, MatchEvent } from '@core/types';
import { MATCH_TEMPLATES, snapshotRuleSet } from '@core/types';
import type { EngineContext } from '@core/engine/types';
import {
  NineBallEngine,
  applyNineBallEvent,
  replayNineBallState,
} from '@core/engine/nineBall/engine';
import type { NineBallState } from '@core/engine/nineBall/types';

const CHASE = MATCH_TEMPLATES.find((t) => t.id === 'nine-ball.chase')!;
const STANDARD = MATCH_TEMPLATES.find((t) => t.id === 'nine-ball.standard.2p.rt7')!;

const engine = new NineBallEngine();
const NAMES = ['甲', '乙', '丙', '丁'];

function ctx(template = CHASE, seats = 4): EngineContext {
  return {
    matchId: 'm-nine-chase',
    gameType: 'nine-ball',
    players: NAMES.slice(0, seats).map((n, i) => ({
      playerId: `p${i}`,
      displayName: n,
      isAnonymous: false,
    })),
    ruleSet: snapshotRuleSet(template.ruleSet, 1),
    target: template.target,
    matchFormat: 'singles',
  };
}

const fresh = (seats = 4) => engine.createInitialState(ctx(CHASE, seats));
const run = (s: NineBallState, c: MatchCommand, seats = 4) => engine.reduce(s, c, ctx(CHASE, seats));
const chase = (s: NineBallState, kind: string, playerIndex?: number, seats = 4) =>
  run(
    s,
    {
      type: 'CHASE_SCORED',
      payload: { kind, ...(playerIndex !== undefined ? { playerIndex } : {}) },
    },
    seats,
  );

describe('九球追分：上家/下家赔付', () => {
  it('普胜：上家赔 4，本家 +4', () => {
    expect(chase(fresh(), 'normal', 1).state.points).toEqual({ 0: -4, 1: 4, 2: 0, 3: 0 });
  });

  it('小金：上家赔 7，本家 +7', () => {
    expect(chase(fresh(), 'smallGold', 2).state.points).toEqual({ 0: 0, 1: -7, 2: 7, 3: 0 });
  });

  it('大金：上家与下家各赔 10，本家 +20', () => {
    expect(chase(fresh(), 'bigGold', 0).state.points).toEqual({ 0: 20, 1: -10, 2: 0, 3: -10 });
  });

  it('黄金九：上家与下家各赔 4，本家 +8', () => {
    expect(chase(fresh(), 'goldNine', 0).state.points).toEqual({ 0: 8, 1: -4, 2: 0, 3: -4 });
  });

  it('黑金：本家倒赔，净得 -20 且允许负分', () => {
    expect(chase(fresh(), 'blackGold', 0).state.points).toEqual({
      0: -20,
      1: 10,
      2: 0,
      3: 10,
    });
  });

  it('任何一档结算都是零和', () => {
    for (const kind of ['normal', 'smallGold', 'bigGold', 'goldNine', 'blackGold']) {
      const r = chase(fresh(), kind, 1);
      const sum = Object.values(r.state.points).reduce((a, b) => a + b, 0);
      expect(sum, `${kind} 应零和`).toBe(0);
    }
  });

  it('两人局：上家与下家同一人，赔付叠加', () => {
    expect(chase(fresh(2), 'bigGold', 0, 2).state.points).toEqual({ 0: 20, 1: -20 });
  });

  it('可以指定算给谁，且不改变击球方', () => {
    const r = chase(fresh(), 'normal', 3);
    expect(r.state.points[3]).toBe(4);
    expect(r.state.activePlayerIndex).toBe(0);
  });

  it('未知的得分类型被拒绝，不产生事件', () => {
    const r = chase(fresh(), 'nope', 0);
    expect(r.trace.validation).toBe('ILLEGAL');
    expect(r.events).toEqual([]);
  });

  it('席位越界被拒绝', () => {
    const r = chase(fresh(), 'normal', 9);
    expect(r.trace.validation).toBe('ILLEGAL');
    expect(r.events).toEqual([]);
  });

  it('追分不判胜负：达到旧的目标分也不会结束本局', () => {
    let s = fresh();
    for (let i = 0; i < 6; i += 1) s = chase(s, 'bigGold', 0).state;
    expect(s.points[0]).toBe(120);
    expect(s.frameStatus).toBe('PLAYING');
  });
});

describe('九球追分：累计与重放', () => {
  it('开新局不清零（追分是整场累计）', () => {
    const s = chase(fresh(), 'bigGold', 0).state;
    const next = engine.startFrame(s, 1, ctx(CHASE));
    expect(next.points).toEqual({ 0: 20, 1: -10, 2: 0, 3: -10 });
  });

  it('标准九球（有目标分）开新局仍然清零', () => {
    const s = chase(fresh(), 'bigGold', 0).state;
    const next = engine.startFrame(s, 1, ctx(STANDARD));
    expect(next.points).toEqual({ 0: 0, 1: 0, 2: 0, 3: 0 });
  });

  it('重放后逐字段一致（连续结算 + 负分改账）', () => {
    let s = fresh();
    const events: MatchEvent[] = [];
    for (const cmd of [
      { type: 'CHASE_SCORED', payload: { kind: 'bigGold', playerIndex: 0 } },
      { type: 'CHASE_SCORED', payload: { kind: 'goldNine', playerIndex: 2 } },
      { type: 'CHASE_SCORED', payload: { kind: 'blackGold', playerIndex: 1 } },
      // 人工改账只能「在已有负分上继续扣」，不允许从非负直接拉负
      { type: 'ADJUST_SCORE', payload: { points: -5, playerIndex: 1 } },
    ] as MatchCommand[]) {
      const r = run(s, cmd);
      s = r.state;
      events.push(...r.events);
    }

    const replayed = events.reduce(applyNineBallEvent, fresh());
    const keys = [...new Set([...Object.keys(s), ...Object.keys(replayed)])].sort();
    const mismatches = keys.filter(
      (k) => JSON.stringify((s as never)[k]) !== JSON.stringify((replayed as never)[k]),
    );
    expect(mismatches).toEqual([]);
    // 大金 0 号 +20 / 黄金九 2 号 +8 / 黑金 1 号 -20 / 1 号再改账 -5
    expect(s.points).toEqual({ 0: 30, 1: -39, 2: 18, 3: -14 });
    expect(s.runCount).toBe(3);
  });

  it('replayNineBallState 同样能还原分数', () => {
    const events: MatchEvent[] = [];
    let s = fresh();
    for (const kind of ['normal', 'bigGold']) {
      const r = chase(s, kind, 1);
      s = r.state;
      events.push(...r.events);
    }
    const replayed = replayNineBallState(fresh(), events);
    expect(replayed.points).toEqual(s.points);
    expect(replayed.runCount).toBe(s.runCount);
  });
});
