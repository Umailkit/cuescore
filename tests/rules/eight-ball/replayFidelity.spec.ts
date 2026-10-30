import { describe, it, expect } from 'vitest';
import type { MatchCommand, MatchEvent } from '@core/types';
import { MATCH_TEMPLATES, snapshotRuleSet } from '@core/types';
import type { EngineContext } from '@core/engine/types';
import { EightBallEngine, applyEightBallEvent } from '@core/engine/eightBall/engine';
import type { EightBallState } from '@core/engine/eightBall/types';
import { ballsOfGroup } from '@core/engine/eightBall/balls';

/**
 * 重放保真 —— EventLog 是本项目的架构支点（「事件是事实源，Snapshot 只是缓存」），
 * 所以「删掉 Snapshot 后重放出来的 state」必须和现场 reduce 出来的 **逐字段一致**。
 *
 * 既有的 engine.spec.ts 重放测试只比对了 7 个字段
 * （balls / groups / tableStatus / activePlayerIndex / turnNumber / break / frameStatus），
 * 从未比对 foul、runCount、potted、winReason —— 偏差就是这么漏过去的。
 * 这里改为**全字段**比对，任何新字段漏同步都会立刻暴露。
 */

const TEMPLATE = MATCH_TEMPLATES[0]!;
const engine = new EightBallEngine();

function ctxWith(config?: Record<string, unknown>): EngineContext {
  const ruleSet = { ...TEMPLATE.ruleSet, config: { ...TEMPLATE.ruleSet.config, ...config } };
  return {
    matchId: 'm-replay',
    gameType: 'eight-ball',
    players: [
      { playerId: 'p1', displayName: 'P1', isAnonymous: false },
      { playerId: 'p2', displayName: 'P2', isAnonymous: false },
    ],
    ruleSet: snapshotRuleSet(ruleSet, 1),
    target: 7,
    matchFormat: 'singles',
  };
}

/** 走一遍命令序列，返回最终 state 与沿途产生的事件。 */
function play(
  commands: MatchCommand[],
  config?: Record<string, unknown>,
): { state: EightBallState; events: MatchEvent[] } {
  const c = ctxWith(config);
  let state = engine.createInitialState(c);
  const events: MatchEvent[] = [];
  for (const command of commands) {
    const r = engine.reduce(state, command, c);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

function replayed(events: MatchEvent[], config?: Record<string, unknown>): EightBallState {
  return events.reduce(applyEightBallEvent, engine.createInitialState(ctxWith(config)));
}

/** 逐字段比对，失败时把不一致的字段全部列出来，方便定位。 */
function expectIdentical(live: EightBallState, replay: EightBallState): void {
  const keys = [...new Set([...Object.keys(live), ...Object.keys(replay)])].sort();
  const mismatches = keys.filter(
    (k) => JSON.stringify((live as never)[k]) !== JSON.stringify((replay as never)[k]),
  );
  expect(
    mismatches,
    `重放与现场不一致的字段：${mismatches.join(', ')}`,
  ).toEqual([]);
}

/** 开球并把开球这一杆打完（空杆换手），台面 OPEN 且已非开球杆。 */
function openTable(): MatchCommand[] {
  return [{ type: 'BREAK_STARTED' }, { type: 'BALL_MISSED', payload: {} }];
}

describe('eight-ball: 全字段重放保真', () => {
  it('合法清台并打进 8 号球：整局重放后逐字段一致', () => {
    const commands: MatchCommand[] = [
      ...openTable(),
      ...ballsOfGroup('STRIPES').map(
        (b): MatchCommand => ({ type: 'BALL_POTTED', payload: { ball: b } }),
      ),
      { type: 'BALL_POTTED', payload: { ball: 8 } },
    ];
    const { state, events } = play(commands);
    expect(state.frameStatus).toBe('WON');
    expectIdentical(state, replayed(events));
  });

  it('合法进球会清掉上一杆的犯规标记，重放同样清掉', () => {
    const commands: MatchCommand[] = [
      ...openTable(),
      { type: 'FOUL', payload: { reason: 'SCRATCH' } }, // 换手到 P2
      { type: 'BALL_POTTED', payload: { ball: 9 } }, // P2 合法进球
    ];
    const { state, events } = play(commands);

    // 现场：犯规标记已经被这一杆清掉
    expect(state.foul.occurred).toBe(false);
    // 重放：必须同样清掉，否则界面会一直挂着「犯规 · 母球落袋」
    expect(replayed(events).foul.occurred).toBe(false);
    expectIdentical(state, replayed(events));
  });

  it('认输（CONCEDE）路径：winReason 重放一致', () => {
    const { state, events } = play([...openTable(), { type: 'CONCEDE' }]);
    expect(state.frameStatus).toBe('LOST');
    expect(state.winReason).toBe('认输');
    expect(replayed(events).winReason).toBe('认输');
    expectIdentical(state, replayed(events));
  });

  it('裁判指定胜方（COMPLETE_FRAME）：winReason 重放一致', () => {
    const { state, events } = play([
      ...openTable(),
      { type: 'COMPLETE_FRAME', payload: { winnerPlayerIndex: 1 } },
    ]);
    expect(state.frameStatus).toBe('WON');
    expect(state.winnerPlayerIndex).toBe(1);
    expect(replayed(events).winReason).toBe(state.winReason);
    expectIdentical(state, replayed(events));
  });

  it('非法黑八判负路径：8 号球进流水且 winReason 一致', () => {
    const { state, events } = play([
      { type: 'BREAK_STARTED' },
      { type: 'BALL_MISSED', payload: {} },
      { type: 'BALL_POTTED', payload: { ball: 8 } }, // 本方未清空就打 8
    ]);
    expect(state.frameStatus).toBe('LOST');
    // 8 号球确实进袋了，必须记在本局进球流水里
    expect(state.potted.some((p) => p.ball === 8 && p.legal === false)).toBe(true);
    expect(replayed(events).winReason).toBe(state.winReason);
    expectIdentical(state, replayed(events));
  });

  it('runCount 在重放后与现场一致（靠 BALL_POTTED 的 continues 字段）', () => {
    const { state, events } = play([
      ...openTable(),
      { type: 'BALL_POTTED', payload: { ball: 9 } },
      { type: 'BALL_POTTED', payload: { ball: 10 } },
      { type: 'BALL_POTTED', payload: { ball: 11 } },
    ]);
    // 连续合法进球 → runCount 累加
    expect(state.runCount).toBe(3);
    expect(replayed(events).runCount).toBe(3);
    expectIdentical(state, replayed(events));
  });

  /**
   * 已知缺陷（审计 BUG-7）：打进对方球后没有换手。
   *
   * engine.ts 的注释写的是「打进对方球：默认不是犯规，但本回合不继续、换手」，
   * 但实现是 `continues = !fouled && !opponentBallFoul`，而
   * `opponentBallPocketedIsFoul` 默认 false —— 于是 continues 恒为 true，
   * 打进对方球反而被判成「合法进球，继续击球」。
   *
   * 这里用 it.fails 把「期望行为」固定住：修好后这条会失败，提示移除标记。
   */
  it.fails('打进对方球应当结束本回合并换手（已知缺陷 BUG-7）', () => {
    const { state } = play([
      ...openTable(),
      { type: 'BALL_POTTED', payload: { ball: 9 } },
      { type: 'BALL_POTTED', payload: { ball: 10 } },
      { type: 'BALL_POTTED', payload: { ball: 1 } }, // 对方球
    ]);
    // 打进对方球不是犯规……
    expect(state.foul.occurred).toBe(false);
    // ……但本回合应当结束
    expect(state.runCount).toBe(0);
  });
});
