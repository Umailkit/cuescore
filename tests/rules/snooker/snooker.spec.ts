import { describe, it, expect } from 'vitest';
import type { MatchCommand } from '@core/types';
import { MATCH_TEMPLATES, snapshotRuleSet } from '@core/types';
import type { EngineContext } from '@core/engine/types';
import { SnookerEngine, applySnookerEvent } from '@core/engine/snooker/engine';
import {
  BALL_VALUES,
  MAX_BREAK,
  RED_COUNT,
  nextColour,
  pointsRemaining,
  snookersRequired,
  type SnookerState,
} from '@core/engine/snooker/types';

/**
 * Snooker rules —— docs/rules/snooker.md 的 16 条契约逐条落地。
 *
 * 这里的每个 it 都对应文档里的一节「规则说明 → 状态转换 → Event → Unit Test」。
 */
const TEMPLATE = MATCH_TEMPLATES.find((t) => t.gameType === 'snooker')!;
const engine = new SnookerEngine();

function ctxWith(config?: Record<string, unknown>): EngineContext {
  const ruleSet = { ...TEMPLATE.ruleSet, config: { ...TEMPLATE.ruleSet.config, ...config } };
  return {
    matchId: 'm-snooker',
    gameType: 'snooker',
    players: [
      { playerId: 'p1', displayName: 'P1', isAnonymous: false },
      { playerId: 'p2', displayName: 'P2', isAnonymous: false },
    ],
    ruleSet: snapshotRuleSet(ruleSet, 1),
    target: 3,
    matchFormat: 'singles',
  };
}

const ctx = ctxWith();

function fresh(config?: Record<string, unknown>): SnookerState {
  return engine.createInitialState(ctxWith(config));
}

function run(s: SnookerState, c: MatchCommand): SnookerState {
  return engine.reduce(s, c, ctx).state;
}

/** 打进一颗红球（合法：红球阶段且本杆还没打彩球）。 */
function potRed(s: SnookerState): SnookerState {
  return run(s, { type: 'SCORE', payload: { ball: 'red' } });
}
/** 打进一颗彩球。 */
function potColour(s: SnookerState, colour: string): SnookerState {
  return run(s, { type: 'SCORE', payload: { ball: colour } });
}

describe('Snooker: 2.1 147 满分杆', () => {
  it('147 maximum break', () => {
    let s = fresh();
    for (let i = 0; i < RED_COUNT; i += 1) {
      s = potRed(s);
      s = potColour(s, 'black');
    }
    expect(s.redsRemaining).toBe(0);
    expect(s.stage).toBe('colours');
    // 红球阶段累计 15×8 = 120
    expect(s.scores[0]).toBe(RED_COUNT * (BALL_VALUES.red + BALL_VALUES.black));
    expect(s.breaks[0]).toBe(120);

    for (const c of ['yellow', 'green', 'brown', 'blue', 'pink', 'black']) {
      s = potColour(s, c);
    }
    expect(s.scores[0]).toBe(147);
    expect(s.highestBreak[0]).toBe(147);
    expect(s.frameComplete).toBe(true);
    expect(MAX_BREAK).toBe(147);
  });
});

describe('Snooker: 2.2 Foul 4/5/6/7 罚分', () => {
  it('minimum foul penalty is 4', () => {
    const s = run(fresh(), { type: 'FOUL', payload: {} });
    expect(s.scores[1]).toBe(4);
  });

  it('foul on yellow still awards the 4-point minimum', () => {
    // 黄球 2 分 < 最低罚分 4 → 取 4
    const s = run(fresh(), { type: 'FOUL', payload: { ball: 'yellow' } });
    expect(s.scores[1]).toBe(4);
  });

  it('foul on blue awards 5', () => {
    const s = run(fresh(), { type: 'FOUL', payload: { ball: 'blue' } });
    expect(s.scores[1]).toBe(5);
  });

  it('foul on pink awards 6', () => {
    const s = run(fresh(), { type: 'FOUL', payload: { ball: 'pink' } });
    expect(s.scores[1]).toBe(6);
  });

  it('foul on black awards 7', () => {
    const s = run(fresh(), { type: 'FOUL', payload: { ball: 'black' } });
    expect(s.scores[1]).toBe(7);
  });

  it('a foul resets the offender break and switches the player', () => {
    let s = potRed(fresh());
    s = potColour(s, 'black');
    expect(s.breaks[0]).toBe(8);
    s = run(s, { type: 'FOUL', payload: {} });
    expect(s.breaks[0]).toBe(0);
    expect(s.activePlayerIndex).toBe(1);
  });
});

describe('Snooker: 2.3 / 2.4 Free Ball', () => {
  it('free ball allows substituting any colour', () => {
    // 标记形成斯诺克 → 犯规 → 应判自由球
    let s = run(fresh(), {
      type: 'ENGINE_COMMAND',
      payload: { action: 'snookered' },
    });
    expect(s.snookered).toBe(true);
    s = run(s, { type: 'FOUL', payload: {} });
    expect(s.freeBall).toBe(true);
    expect(s.scores[1]).toBe(4);

    // 自由球状态下打进绿球（红球阶段本不允许先碰彩球）
    s = potColour(s, 'green');
    expect(s.scores[1]).toBe(4 + BALL_VALUES.green);
    expect(s.freeBall).toBe(false);
  });

  it('free ball can be granted directly and is honoured once', () => {
    let s = run(fresh(), { type: 'ENGINE_COMMAND', payload: { action: 'free-ball' } });
    expect(s.freeBall).toBe(true);
    s = potColour(s, 'brown');
    expect(s.freeBall).toBe(false);
  });

  it('free ball is refused when the ruleset disables it', () => {
    const c = ctxWith({ freeBall: false });
    const s = engine.reduce(fresh({ freeBall: false }), {
      type: 'ENGINE_COMMAND',
      payload: { action: 'free-ball' },
    }, c);
    expect(s.trace.validation).toBe('IGNORED');
    expect(s.state.freeBall).toBe(false);
  });
});

describe('Snooker: 2.5 Miss', () => {
  it('miss is a foul with minimum 4 penalty', () => {
    const s = run(fresh(), { type: 'BALL_MISSED', payload: {} });
    expect(s.scores[1]).toBe(4);
    expect(s.activePlayerIndex).toBe(1);
    expect(s.breaks[0]).toBe(0);
  });
});

describe('Snooker: 2.6 Re-Spot', () => {
  it('re-spot returns a colour to its spot', () => {
    let s = fresh();
    // 手动把黑球标记为已清，再 re-spot 回来
    s = { ...s, coloursOnTable: { ...s.coloursOnTable, black: false } };
    expect(s.coloursOnTable.black).toBe(false);
    s = run(s, { type: 'ENGINE_COMMAND', payload: { action: 're-spot', ball: 'black' } });
    expect(s.coloursOnTable.black).toBe(true);
  });

  it('potting a colour during the reds stage re-spots it (stays on table)', () => {
    const s = potRed(fresh());
    const r = engine.reduce(s, { type: 'SCORE', payload: { ball: 'black' } }, ctx);
    expect(r.state.coloursOnTable.black).toBe(true);
    expect(r.state.scores[0]).toBe(BALL_VALUES.red + BALL_VALUES.black);
    expect(r.events.some((e) => e.type === 'ENGINE_EVENT')).toBe(true);
  });
});

describe('Snooker: 2.7 Re-Rack', () => {
  it('re-rack resets frame state', () => {
    let s = potRed(fresh());
    s = potColour(s, 'black');
    expect(s.redsRemaining).toBe(14);
    s = run(s, { type: 'RERACK', payload: {} });
    expect(s.redsRemaining).toBe(RED_COUNT);
    expect(s.stage).toBe('reds');
    expect(s.scores[0]).toBe(0);
  });
});

describe('Snooker: 2.8 Concede', () => {
  it('concede awards frame to opponent and marks the match complete', () => {
    const s = run(fresh(), { type: 'CONCEDE', payload: {} });
    expect(s.frameComplete).toBe(true);
    expect(s.winnerPlayerIndex).toBe(1);
    expect(s.winReason).toBe('认输');
    // 引擎宣布整场结束，MatchService 据此收场
    expect(engine.isMatchComplete(s)).toBe(true);
  });
});

describe('Snooker: 2.9 最后一颗黑球', () => {
  /** 构造「彩球阶段只剩黑球」的局面。 */
  function onlyBlackLeft(scores: [number, number]): SnookerState {
    return {
      ...fresh(),
      stage: 'colours',
      redsRemaining: 0,
      coloursOnTable: {
        yellow: false,
        green: false,
        brown: false,
        blue: false,
        pink: false,
        black: true,
      },
      scores: { 0: scores[0], 1: scores[1] },
    };
  }

  it('final black ends frame when not tied', () => {
    const s = onlyBlackLeft([60, 30]);
    const after = potColour(s, 'black');
    expect(after.frameComplete).toBe(true);
    expect(after.winnerPlayerIndex).toBe(0);
  });

  it('tie on final black is left to the referee (re-spot), engine does not auto-decide', () => {
    const s = onlyBlackLeft([50, 50]);
    // 平分时打进黑球仍然结束本局（胜者为打进方），
    // 是否重摆黑球由裁判通过 ENGINE_COMMAND re-spot 决定。
    const after = potColour(s, 'black');
    expect(after.frameComplete).toBe(true);
    expect(after.scores[0]).toBe(57);
    expect(after.winnerPlayerIndex).toBe(0);
  });
});

describe('Snooker: 2.10 Snookers Required', () => {
  it('computes snookers required when behind', () => {
    // 落后 40 分，台面还剩 15×8+27=147 → 不需要斯诺克
    const even = fresh();
    expect(snookersRequired(even, 0)).toBe(0);

    // 落后 60 分，台面只剩 8 分 → 还差 52，每次斯诺克追 2 → 26
    const behind: SnookerState = {
      ...fresh(),
      stage: 'colours',
      redsRemaining: 0,
      coloursOnTable: {
        yellow: false,
        green: false,
        brown: false,
        blue: false,
        pink: false,
        black: true,
      },
      scores: { 0: 0, 1: 60 },
    };
    expect(pointsRemaining(behind)).toBe(7);
    expect(snookersRequired(behind, 0)).toBe(Math.ceil((60 - 7) / 2));
  });

  it('returns 0 when ahead or level', () => {
    const s: SnookerState = { ...fresh(), scores: { 0: 30, 1: 10 } };
    expect(snookersRequired(s, 0)).toBe(0);
  });
});

describe('Snooker: 2.11 Points Remaining', () => {
  it('computes points remaining on table', () => {
    expect(pointsRemaining(fresh())).toBe(147);
    let s = fresh();
    for (let i = 0; i < 5; i += 1) {
      s = potRed(s);
      s = potColour(s, 'black');
    }
    expect(pointsRemaining(s)).toBe(10 * 8 + 27);
  });
});

describe('Snooker: 2.12 Break 单杆连续得分', () => {
  it('accumulates current break across pots', () => {
    let s = potRed(fresh());
    s = potColour(s, 'black');
    s = potRed(s);
    s = potColour(s, 'pink');
    expect(s.breaks[0]).toBe(1 + 7 + 1 + 6);
    expect(s.highestBreak[0]).toBe(15);
  });

  it('foul resets current break', () => {
    let s = potRed(fresh());
    s = potColour(s, 'black');
    expect(s.breaks[0]).toBe(8);
    s = run(s, { type: 'FOUL', payload: {} });
    expect(s.breaks[0]).toBe(0);
    // 最高单杆要留下来
    expect(s.highestBreak[0]).toBe(8);
  });
});

describe('Snooker: 2.13 End Break', () => {
  it('end break switches player and resets break', () => {
    let s = potRed(fresh());
    s = potColour(s, 'black');
    expect(s.breaks[0]).toBe(8);
    s = run(s, { type: 'END_BREAK', payload: {} });
    expect(s.breaks[0]).toBe(0);
    expect(s.activePlayerIndex).toBe(1);
    expect(s.lastColourOnBreak).toBeNull();
  });
});

describe('Snooker: 顺序与合法性', () => {
  it('红球阶段必须先碰红球：直接打彩球被拒', () => {
    const r = engine.reduce(fresh(), { type: 'SCORE', payload: { ball: 'black' } }, ctx);
    expect(r.trace.validation).toBe('ILLEGAL');
    expect(r.state.scores[0]).toBe(0);
  });

  it('同一杆不能连打两颗彩球', () => {
    let s = potRed(fresh());
    s = potColour(s, 'black');
    const r = engine.reduce(s, { type: 'SCORE', payload: { ball: 'black' } }, ctx);
    expect(r.trace.validation).toBe('ILLEGAL');
  });

  it('彩球阶段必须按分值由低到高', () => {
    const s: SnookerState = { ...fresh(), stage: 'colours', redsRemaining: 0 };
    const r = engine.reduce(s, { type: 'SCORE', payload: { ball: 'black' } }, ctx);
    expect(r.trace.validation).toBe('ILLEGAL');
    expect(nextColour(s)).toBe('yellow');
  });

  it('无效球名被拒且不改状态', () => {
    const s = fresh();
    const r = engine.reduce(s, { type: 'SCORE', payload: { ball: 'purple' } }, ctx);
    expect(r.trace.validation).toBe('ILLEGAL');
    expect(r.state).toBe(s);
  });
});

describe('Snooker: 重放保真', () => {
  it('replays a full 147 sequence into the same state', () => {
    let s = fresh();
    const events: never[] = [];
    const push = (c: MatchCommand) => {
      const r = engine.reduce(s, c, ctx);
      s = r.state;
      events.push(...(r.events as never[]));
    };
    for (let i = 0; i < RED_COUNT; i += 1) {
      push({ type: 'SCORE', payload: { ball: 'red' } });
      push({ type: 'SCORE', payload: { ball: 'black' } });
    }
    for (const c of ['yellow', 'green', 'brown', 'blue', 'pink', 'black']) {
      push({ type: 'SCORE', payload: { ball: c } });
    }
    const replayed = (events as never[]).reduce(applySnookerEvent, fresh());
    expect(replayed.scores[0]).toBe(147);
    expect(replayed.frameComplete).toBe(true);
  });
});
