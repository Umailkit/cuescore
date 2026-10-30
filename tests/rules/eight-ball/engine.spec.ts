import { describe, it, expect, beforeEach } from 'vitest';
import type { MatchCommand } from '@core/types';
import type { EngineContext } from '@core/engine/types';
import type { MatchEvent } from '@core/types';
import { snapshotRuleSet, MATCH_TEMPLATES } from '@core/types';
import { EightBallEngine, applyEightBallEvent } from '@core/engine/eightBall/engine';
import {
  EIGHT_BALL,
  type EightBallState,
  type EightBallRules,
} from '@core/engine/eightBall/types';
import {
  getBallGroup,
  getLegalTargetBalls,
  remainingInGroup,
  ballsOfGroup,
  isObjectBall,
} from '@core/engine/eightBall/balls';
import { resolveEightBallRules } from '@core/engine/eightBall/rules';

const TEMPLATE = MATCH_TEMPLATES[0]!;

function ctxWith(config?: Record<string, unknown>): EngineContext {
  const ruleSet = { ...TEMPLATE.ruleSet, config: { ...TEMPLATE.ruleSet.config, ...config } };
  return {
    matchId: 'm-test',
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

const engine = new EightBallEngine();
let ctx: EngineContext;

/** Apply a command and return the reduced state. */
function run(
  state: EightBallState,
  command: MatchCommand,
  context: EngineContext = ctx,
): { state: EightBallState; events: string[]; trace: ReturnType<typeof engine.reduce>['trace'] } {
  const r = engine.reduce(state, command, context);
  return { state: r.state, events: r.events.map((e) => e.type), trace: r.trace };
}

function fresh(config?: Record<string, unknown>): EightBallState {
  return engine.createInitialState(ctxWith(config));
}

/** Break, then clear every ball of a group for `seat` by potting them. */
function clearGroup(state: EightBallState, group: 'SOLIDS' | 'STRIPES'): EightBallState {
  let s = state;
  for (const ball of ballsOfGroup(group)) {
    if (s.balls[ball] !== 'ON_TABLE') continue;
    const r = run(s, { type: 'BALL_POTTED', payload: { ball } });
    s = r.state;
  }
  return s;
}

beforeEach(() => {
  ctx = ctxWith();
});

// ---------------------------------------------------------------------------
// 基础
// ---------------------------------------------------------------------------
describe('eight-ball: basics', () => {
  it('starts with 16 balls on the table (cue + 15 object balls)', () => {
    const s = fresh();
    expect(Object.keys(s.balls)).toHaveLength(16);
    expect(s.balls[0]).toBe('ON_TABLE');
    for (let b = 1; b <= 15; b += 1) expect(s.balls[b]).toBe('ON_TABLE');
  });

  it('starts OPEN, on the first turn, with no winner', () => {
    const s = fresh();
    expect(s.tableStatus).toBe('OPEN');
    expect(s.activePlayerIndex).toBe(0);
    expect(s.turnNumber).toBe(1);
    expect(s.frameStatus).toBe('PLAYING');
    expect(s.winnerPlayerIndex).toBeUndefined();
    expect(s.break.completed).toBe(false);
    expect(s.foul.occurred).toBe(false);
  });

  it('assigns ball numbers to groups correctly', () => {
    for (let b = 1; b <= 7; b += 1) expect(getBallGroup(b)).toBe('SOLIDS');
    expect(getBallGroup(8)).toBeNull();
    for (let b = 9; b <= 15; b += 1) expect(getBallGroup(b)).toBe('STRIPES');
    expect(getBallGroup(0)).toBeNull();
    expect(getBallGroup(16)).toBeNull();
    expect(getBallGroup(-1)).toBeNull();
    expect(getBallGroup(1.5)).toBeNull();
  });

  it('recognises object balls only in 1..15', () => {
    expect(isObjectBall(1)).toBe(true);
    expect(isObjectBall(15)).toBe(true);
    expect(isObjectBall(0)).toBe(false);
    expect(isObjectBall(16)).toBe(false);
  });

  it('two players start with no group', () => {
    const s = fresh();
    expect(s.groups[0]).toBeNull();
    expect(s.groups[1]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 开球
// ---------------------------------------------------------------------------
describe('eight-ball: break', () => {
  it('BREAK_STARTED marks the break as completed', () => {
    const { state, events } = run(fresh(), { type: 'BREAK_STARTED' });
    expect(state.break.completed).toBe(true);
    expect(events).toEqual(['BREAK_STARTED']);
  });

  it('a second BREAK_STARTED is ignored', () => {
    const r1 = run(fresh(), { type: 'BREAK_STARTED' });
    const r2 = run(r1.state, { type: 'BREAK_STARTED' });
    expect(r2.events).toEqual([]);
    expect(r2.trace.validation).toBe('IGNORED');
    expect(r2.state).toBe(r1.state);
  });

  it('breaking player keeps the turn when a ball drops', () => {
    const r1 = run(fresh(), { type: 'BREAK_STARTED' });
    const r2 = run(r1.state, { type: 'BALL_POTTED', payload: { ball: 3 } });
    expect(r2.state.balls[3]).toBe('POCKETED');
    expect(r2.state.activePlayerIndex).toBe(0);
    expect(r2.events).toContain('BALL_POTTED');
    expect(r2.events).not.toContain('TURN_ENDED');
  });

  it('does not assign groups on the break shot', () => {
    const r1 = run(fresh(), { type: 'BREAK_STARTED' });
    const r2 = run(r1.state, { type: 'BALL_POTTED', payload: { ball: 3 } });
    expect(r2.state.tableStatus).toBe('OPEN');
    expect(r2.state.groups[0]).toBeNull();
  });

  it('a break foul hands the table over', () => {
    const r1 = run(fresh(), { type: 'BREAK_STARTED' });
    const r2 = run(r1.state, { type: 'BALL_MISSED' });
    expect(r2.state.activePlayerIndex).toBe(1);
    expect(r2.state.foul.occurred).toBe(true);
    expect(r2.state.foul.reason).toBe('NO_CONTACT');
    expect(r2.events).toEqual(['BALL_MISSED', 'FOUL', 'TURN_ENDED']);
  });

  it('pocketing the 8 on the break re-racks by default (RuleSet.config)', () => {
    const r1 = run(fresh(), { type: 'BREAK_STARTED' });
    const r2 = run(r1.state, { type: 'BALL_POTTED', payload: { ball: EIGHT_BALL } });
    expect(r2.state.frameStatus).toBe('RERACK');
    expect(r2.events).toContain('RERACK');
    expect(r2.state.winnerPlayerIndex).toBeUndefined();
  });

  it('eightOnBreak=win config changes the outcome (no hard-coded rules)', () => {
    const localCtx = ctxWith({ eightOnBreak: 'win' });
    const r1 = run(fresh({ eightOnBreak: 'win' }), { type: 'BREAK_STARTED' }, localCtx);
    const r2 = run(r1.state, { type: 'BALL_POTTED', payload: { ball: EIGHT_BALL } }, localCtx);
    expect(r2.state.frameStatus).toBe('WON');
    expect(r2.state.winnerPlayerIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 分组
// ---------------------------------------------------------------------------
describe('eight-ball: group assignment', () => {
  function broken(): EightBallState {
    return run(fresh(), { type: 'BREAK_STARTED' }).state;
  }

  it('assigns SOLIDS then STRIPES to the opponent', () => {
    const s = broken();
    // Break shot ends the "break shot" window without assigning groups.
    const afterBreakShot = run(s, { type: 'BALL_POTTED', payload: { ball: 2 } }).state;
    expect(afterBreakShot.groups[0]).toBeNull();

    // Next legal pot assigns the group.
    const r = run(afterBreakShot, { type: 'BALL_POTTED', payload: { ball: 5 } });
    expect(r.state.groups[0]).toBe('SOLIDS');
    expect(r.state.groups[1]).toBe('STRIPES');
    expect(r.state.tableStatus).toBe('GROUPS_ASSIGNED');
    expect(r.events).toContain('GROUPS_ASSIGNED');
  });

  it('assigns STRIPES when a stripe drops first', () => {
    const s = broken();
    const first = run(s, { type: 'END_TURN' }).state; // end break turn, P2 to shoot
    expect(first.activePlayerIndex).toBe(1);
    const r = run(first, { type: 'BALL_POTTED', payload: { ball: 11 } });
    expect(r.state.groups[1]).toBe('STRIPES');
    expect(r.state.groups[0]).toBe('SOLIDS');
  });

  it('never re-assigns groups once set', () => {
    const s = broken();
    const a = run(s, { type: 'BALL_POTTED', payload: { ball: 2 } }).state;
    const b = run(a, { type: 'BALL_POTTED', payload: { ball: 5 } }).state;
    expect(b.groups[0]).toBe('SOLIDS');

    // Potting a stripe afterwards must NOT flip the assignment.
    const c = run(b, { type: 'BALL_POTTED', payload: { ball: 11 } }).state;
    expect(c.groups[0]).toBe('SOLIDS');
    expect(c.groups[1]).toBe('STRIPES');
  });
});

// ---------------------------------------------------------------------------
// 合法目标
// ---------------------------------------------------------------------------
describe('eight-ball: legal targets', () => {
  it('before the break there are no legal targets at all', () => {
    // 开球前本局第一杆还没打，规则上任何球都不是「合法目标」。
    expect(getLegalTargetBalls(fresh(), 0)).toEqual([]);
  });

  it('OPEN table after the break: every non-8 ball is legal', () => {
    const broken = run(fresh(), { type: 'BREAK_STARTED' }).state;
    const targets = getLegalTargetBalls(broken, 0);
    expect(targets).toHaveLength(14);
    expect(targets).not.toContain(EIGHT_BALL);
    expect(targets).toContain(1);
    expect(targets).toContain(15);
  });

  it('after assignment: only the player’s own group', () => {
    const s = run(fresh(), { type: 'BREAK_STARTED' }).state;
    const a = run(s, { type: 'BALL_POTTED', payload: { ball: 2 } }).state;
    const b = run(a, { type: 'BALL_POTTED', payload: { ball: 5 } }).state;
    const targets = getLegalTargetBalls(b, 0);
    expect(targets.every((t) => t <= 7)).toBe(true);
    expect(targets).not.toContain(9);
  });

  it('once the group is cleared, the 8 becomes the only legal target', () => {
    const s = fresh();
    let cur = run(s, { type: 'BREAK_STARTED' }).state;
    cur = run(cur, { type: 'BALL_POTTED', payload: { ball: 2 } }).state; // break shot
    cur = run(cur, { type: 'BALL_POTTED', payload: { ball: 3 } }).state; // assigns SOLIDS
    cur = clearGroup(cur, 'SOLIDS');
    expect(getLegalTargetBalls(cur, 0)).toEqual([EIGHT_BALL]);
    expect(cur.tableStatus).toBe('EIGHT_BALL');
  });

  it('a frame that is already decided has no legal targets', () => {
    const s = { ...fresh(), frameStatus: 'WON' as const };
    expect(getLegalTargetBalls(s, 0)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 击球 / 换手
// ---------------------------------------------------------------------------
describe('eight-ball: potting and turn flow', () => {
  it('a legal pot keeps the shooter at the table', () => {
    const s = run(fresh(), { type: 'BREAK_STARTED' }).state;
    const a = run(s, { type: 'BALL_POTTED', payload: { ball: 2 } }).state;
    const b = run(a, { type: 'BALL_POTTED', payload: { ball: 5 } });
    expect(b.state.activePlayerIndex).toBe(0);
    expect(b.state.runCount).toBeGreaterThan(0);
  });

  it('a miss is a foul and switches players', () => {
    const r = run(fresh(), { type: 'BALL_MISSED' });
    expect(r.state.activePlayerIndex).toBe(1);
    expect(r.events).toEqual(['BALL_MISSED', 'FOUL', 'TURN_ENDED']);
  });

  it('END_TURN switches players without a foul', () => {
    const r = run(fresh(), { type: 'END_TURN' });
    expect(r.state.activePlayerIndex).toBe(1);
    expect(r.state.foul.occurred).toBe(false);
    expect(r.state.turnNumber).toBe(2);
  });

  it('rejects an invalid ball number without mutating state', () => {
    const s = fresh();
    const r = run(s, { type: 'BALL_POTTED', payload: { ball: 99 } });
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
    expect(r.trace.validation).toBe('ILLEGAL');
  });

  it('rejects potting a ball twice', () => {
    const a = run(fresh(), { type: 'BALL_POTTED', payload: { ball: 4 } }).state;
    const b = run(a, { type: 'BALL_POTTED', payload: { ball: 4 } });
    expect(b.state).toBe(a);
    expect(b.trace.validation).toBe('ILLEGAL');
  });

  /**
   * 一杆多球尚未实现（审计 未实现项 U-1）。
   *
   * BALL_POTTED 只接受单颗 `ball`。把 `balls: [...]` 传进来必须被**明确拒绝**，
   * 而不是静默当成空操作 —— 否则调用方会以为「一杆打进 1 和 9」已经记上了。
   * 这条测试钉住「要么拒绝、要么真实现」：将来若实现了多球，这里会失败并
   * 提醒同步更新规则矩阵。
   */
  it('multi-ball payload is rejected outright (one-shot multi-pot not supported)', () => {
    const s = run(fresh(), { type: 'BREAK_STARTED' }).state;
    const r = run(s, { type: 'BALL_POTTED', payload: { balls: [1, 9] } });
    expect(r.trace.validation).toBe('ILLEGAL');
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 犯规
// ---------------------------------------------------------------------------
describe('eight-ball: fouls', () => {
  it('SCRATCH on the cue ball is a foul and a turn change', () => {
    const r = run(fresh(), { type: 'BALL_POTTED', payload: { ball: 0 } });
    expect(r.state.foul.reason).toBe('SCRATCH');
    expect(r.state.activePlayerIndex).toBe(1);
    expect(r.events).toEqual(['FOUL', 'TURN_ENDED']);
  });

  it('WRONG_BALL_FIRST is detected from firstContact', () => {
    // Assign SOLIDS to P1 first.
    let s = run(fresh(), { type: 'BREAK_STARTED' }).state;
    s = run(s, { type: 'BALL_POTTED', payload: { ball: 2 } }).state;
    s = run(s, { type: 'BALL_POTTED', payload: { ball: 3 } }).state;
    expect(s.groups[0]).toBe('SOLIDS');

    // Now P1 hits a stripe first, then pots one of their own.
    const r = run(s, {
      type: 'BALL_POTTED',
      payload: { ball: 4, firstContact: 11 },
    });
    expect(r.state.foul.reason).toBe('WRONG_BALL_FIRST');
    expect(r.state.activePlayerIndex).toBe(1);
  });

  it('an explicit FOUL command records the reason and switches', () => {
    const r = run(fresh(), { type: 'FOUL', payload: { reason: 'ILLEGAL_BREAK' } });
    expect(r.state.foul.reason).toBe('ILLEGAL_BREAK');
    expect(r.state.activePlayerIndex).toBe(1);
  });

  it('unknown foul reasons fall back to OTHER instead of crashing', () => {
    const r = run(fresh(), { type: 'FOUL', payload: { reason: 'MADE_UP' } });
    expect(r.state.foul.reason).toBe('OTHER');
  });

  it('a foul is recorded as an event, not just a flag', () => {
    const r = run(fresh(), { type: 'BALL_MISSED' });
    expect(r.events).toContain('FOUL');
  });
});

// ---------------------------------------------------------------------------
// 8 号球
// ---------------------------------------------------------------------------
describe('eight-ball: the 8 ball', () => {
  function atEightBall(): EightBallState {
    let s = run(fresh(), { type: 'BREAK_STARTED' }).state;
    s = run(s, { type: 'BALL_POTTED', payload: { ball: 2 } }).state;
    s = run(s, { type: 'BALL_POTTED', payload: { ball: 3 } }).state;
    s = clearGroup(s, 'SOLIDS');
    return s;
  }

  it('clearing the group enters the EIGHT_BALL phase', () => {
    const s = atEightBall();
    expect(s.tableStatus).toBe('EIGHT_BALL');
    expect(s.balls[EIGHT_BALL]).toBe('ON_TABLE');
  });

  it('a legal 8-ball pot wins the frame', () => {
    const s = atEightBall();
    const r = run(s, { type: 'BALL_POTTED', payload: { ball: EIGHT_BALL } });
    expect(r.state.frameStatus).toBe('WON');
    expect(r.state.winnerPlayerIndex).toBe(0);
    expect(r.events).toContain('FRAME_WON');
    expect(r.state.balls[EIGHT_BALL]).toBe('POCKETED');
  });

  it('potting the 8 early loses the frame (default config)', () => {
    const s = fresh();
    const r = run(s, { type: 'BALL_POTTED', payload: { ball: EIGHT_BALL } });
    // Not on the break, group not cleared → illegal.
    expect(r.state.frameStatus).toBe('LOST');
    expect(r.state.loserPlayerIndex).toBe(0);
    expect(r.state.winnerPlayerIndex).toBe(1);
    expect(r.events).toContain('FRAME_LOST');
  });

  it('potting the 8 with a scratch loses the frame', () => {
    const s = atEightBall();
    const r = run(s, { type: 'BALL_POTTED', payload: { ball: EIGHT_BALL, scratch: true } });
    expect(r.state.frameStatus).toBe('LOST');
    expect(r.state.loserPlayerIndex).toBe(0);
  });

  it('eightBallEarlyLosesFrame=false turns an early 8 into a plain foul', () => {
    const localCtx = ctxWith({ eightBallEarlyLosesFrame: false });
    const s = engine.createInitialState(localCtx);
    const r = run(s, { type: 'BALL_POTTED', payload: { ball: EIGHT_BALL } }, localCtx);
    expect(r.state.frameStatus).toBe('PLAYING');
    expect(r.state.foul.reason).toBe('ILLEGAL_EIGHT_BALL');
    expect(r.state.balls[EIGHT_BALL]).toBe('ON_TABLE');
    expect(r.state.activePlayerIndex).toBe(1);
  });

  it('a decided frame ignores further potting commands', () => {
    const s = atEightBall();
    const won = run(s, { type: 'BALL_POTTED', payload: { ball: EIGHT_BALL } }).state;
    const after = run(won, { type: 'BALL_POTTED', payload: { ball: 1 } });
    expect(after.events).toEqual([]);
    expect(after.trace.validation).toBe('IGNORED');
    expect(after.state).toBe(won);
  });
});

// ---------------------------------------------------------------------------
// 胜负
// ---------------------------------------------------------------------------
describe('eight-ball: frame outcome', () => {
  it('CONCEDE hands the frame to the opponent', () => {
    const r = run(fresh(), { type: 'CONCEDE' });
    expect(r.state.frameStatus).toBe('LOST');
    expect(r.state.loserPlayerIndex).toBe(0);
    expect(r.state.winnerPlayerIndex).toBe(1);
    expect(r.events).toContain('FRAME_LOST');
  });

  it('the winner is decided by the engine, never by the caller', () => {
    const s = run(fresh(), { type: 'BREAK_STARTED' }).state;
    const conceded = run(s, { type: 'CONCEDE' }).state;
    expect(conceded.winnerPlayerIndex).toBe(1);
    expect(conceded.loserPlayerIndex).toBe(0);
  });

  it('isFrameComplete / getWinner reflect the engine state', () => {
    const playing = fresh();
    expect(engine.isFrameComplete(playing)).toBe(false);
    expect(engine.getWinner(playing)).toBeNull();

    const won = run(playing, { type: 'CONCEDE' }).state;
    expect(engine.isFrameComplete(won)).toBe(true);
    expect(engine.getWinner(won)).toBe('1');
  });

  it('the engine refuses to aggregate match wins (that is the match layer)', () => {
    const s = fresh();
    expect(engine.isMatchComplete(s)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 摆球 / Call Shot
// ---------------------------------------------------------------------------
describe('eight-ball: rerack and call shot', () => {
  it('RERACK restores a full table', () => {
    let s = run(fresh(), { type: 'BREAK_STARTED' }).state;
    s = run(s, { type: 'BALL_POTTED', payload: { ball: 2 } }).state;
    expect(s.balls[2]).toBe('POCKETED');
    const r = run(s, { type: 'RERACK' });
    expect(r.state.balls[2]).toBe('ON_TABLE');
    expect(r.state.tableStatus).toBe('OPEN');
    expect(r.state.potted).toHaveLength(0);
  });

  it('CALL_SHOT is ignored unless the ruleset enables it', () => {
    const r = run(fresh(), { type: 'CALL_SHOT', payload: { ball: 5, pocket: 'TL' } });
    expect(r.events).toEqual([]);
    expect(r.trace.validation).toBe('IGNORED');
  });

  it('CALL_SHOT records the call when enabled', () => {
    const localCtx = ctxWith({ callShot: true });
    const s = engine.createInitialState(localCtx);
    const r = run(s, { type: 'CALL_SHOT', payload: { ball: 5, pocket: 'TL' } }, localCtx);
    expect(r.state.calledBall).toBe(5);
    expect(r.state.calledPocket).toBe('TL');
    expect(r.events).toEqual(['CALL_SHOT']);
  });
});

// ---------------------------------------------------------------------------
// RuleSet.config 归一化
// ---------------------------------------------------------------------------
describe('eight-ball: ruleset config plumbing', () => {
  it('falls back to defaults for missing config', () => {
    const rules: EightBallRules = resolveEightBallRules({});
    expect(rules.eightOnBreak).toBe('rerack');
    expect(rules.breakPocketContinues).toBe(true);
    expect(rules.eightBallEarlyLosesFrame).toBe(true);
  });

  it('ignores invalid enum / type values instead of crashing', () => {
    const rules = resolveEightBallRules({
      eightOnBreak: 'explode',
      breakPocketContinues: 'yes',
      breakRequiresPocketOrRailCount: -3,
    });
    expect(rules.eightOnBreak).toBe('rerack');
    expect(rules.breakPocketContinues).toBe(true);
    expect(rules.breakRequiresPocketOrRailCount).toBe(0);
  });

  it('reads real values when provided', () => {
    const rules = resolveEightBallRules({
      eightOnBreak: 'lose',
      callShot: true,
      breakRequiresPocketOrRailCount: 2,
    });
    expect(rules.eightOnBreak).toBe('lose');
    expect(rules.callShot).toBe(true);
    expect(rules.breakRequiresPocketOrRailCount).toBe(2);
  });

  it('remainingInGroup counts only balls still on the table', () => {
    const s = fresh();
    expect(remainingInGroup(s, 'SOLIDS')).toBe(7);
    const after = run(s, { type: 'BALL_POTTED', payload: { ball: 3 } }).state;
    expect(remainingInGroup(after, 'SOLIDS')).toBe(6);
    expect(remainingInGroup(after, 'STRIPES')).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------
describe('eight-ball: event replay', () => {
  it('replays a 12+ event sequence into the same state', () => {
    const cmds: MatchCommand[] = [
      { type: 'BREAK_STARTED' },
      { type: 'BALL_POTTED', payload: { ball: 2 } },
      { type: 'BALL_POTTED', payload: { ball: 3 } }, // assigns SOLIDS
      { type: 'BALL_POTTED', payload: { ball: 4 } },
      { type: 'END_TURN' },
      { type: 'BALL_MISSED' },
      { type: 'BALL_POTTED', payload: { ball: 0 } }, // scratch
      { type: 'BALL_POTTED', payload: { ball: 1 } },
      { type: 'END_TURN' },
      { type: 'BALL_POTTED', payload: { ball: 5 } },
      { type: 'END_TURN' },
      { type: 'BALL_POTTED', payload: { ball: 6 } },
    ];

    let state = fresh();
    const allEvents: MatchEvent[] = [];
    for (const c of cmds) {
      const r = engine.reduce(state, c, ctx);
      state = r.state;
      allEvents.push(...r.events);
    }
    expect(allEvents.length).toBeGreaterThanOrEqual(10);

    const replayed = allEvents.reduce(applyEightBallEvent, fresh());
    expect(replayed.balls).toEqual(state.balls);
    expect(replayed.groups).toEqual(state.groups);
    expect(replayed.tableStatus).toBe(state.tableStatus);
    expect(replayed.activePlayerIndex).toBe(state.activePlayerIndex);
    expect(replayed.turnNumber).toBe(state.turnNumber);
    expect(replayed.break).toEqual(state.break);
    expect(replayed.frameStatus).toBe(state.frameStatus);
  });

  it('replays 20+ events with an 8-ball finish', () => {
    let state = fresh();
    const allEvents: MatchEvent[] = [];
    const push = (c: MatchCommand) => {
      const r = engine.reduce(state, c, ctx);
      state = r.state;
      allEvents.push(...r.events);
    };

    push({ type: 'BREAK_STARTED' });
    push({ type: 'BALL_POTTED', payload: { ball: 2 } });
    push({ type: 'BALL_POTTED', payload: { ball: 3 } });
    for (const b of [4, 5, 6, 7, 1]) push({ type: 'BALL_POTTED', payload: { ball: b } });
    push({ type: 'END_TURN' });
    push({ type: 'BALL_MISSED' });
    push({ type: 'END_TURN' });
    push({ type: 'FOUL', payload: { reason: 'SCRATCH' } });
    push({ type: 'END_TURN' });
    push({ type: 'BALL_POTTED', payload: { ball: EIGHT_BALL } });

    expect(allEvents.length).toBeGreaterThanOrEqual(20);
    expect(state.frameStatus).toBe('WON');

    const replayed = allEvents.reduce(applyEightBallEvent, fresh());
    expect(replayed.frameStatus).toBe('WON');
    expect(replayed.winnerPlayerIndex).toBe(state.winnerPlayerIndex);
    expect(replayed.balls[EIGHT_BALL]).toBe('POCKETED');
  });

  it('replay is deterministic regardless of how many events share a timestamp', () => {
    const cmds: MatchCommand[] = [
      { type: 'BREAK_STARTED' },
      { type: 'BALL_POTTED', payload: { ball: 2 } },
      { type: 'BALL_POTTED', payload: { ball: 3 } },
    ];
    let state = fresh();
    const events: MatchEvent[] = [];
    for (const c of cmds) {
      const r = engine.reduce(state, c, ctx);
      state = r.state;
      events.push(...r.events.map((e) => ({ ...e, timestamp: 1000 })));
    }
    const a = events.reduce(applyEightBallEvent, fresh());
    const b = events.reduce(applyEightBallEvent, fresh());
    expect(a).toEqual(b);
  });

  it('replay ignores unknown event types', () => {
    const s = fresh();
    const out = applyEightBallEvent(s, {
      id: 'x',
      matchId: 'm',
      timestamp: 1,
      type: 'MATCH_CREATED',
      payload: {},
    });
    expect(out).toEqual(s);
  });
});
