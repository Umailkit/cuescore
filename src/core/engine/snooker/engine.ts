import type { EngineContext, EngineResult, GameEngine, ScoreSummary } from '../types';
import type { MatchCommand, MatchEvent } from '../../types';
import {
  BALL_VALUES,
  COLOUR_ORDER,
  MAX_BREAK,
  RED_COUNT,
  nextColour,
  pointsRemaining,
  snookersRequired,
  type BallName,
  type ColourName,
  type SnookerRules,
  type SnookerState,
} from './types';
import { resolveSnookerRules } from './rules';
import { createId } from '../../util/id';

export interface SnookerResult extends EngineResult<SnookerState> {
  trace: {
    command: string;
    playerIndex: number;
    validation: 'LEGAL' | 'ILLEGAL' | 'IGNORED';
    decision: string;
    reasons: string[];
    events: string[];
  };
}

function makeEvent(type: MatchEvent['type'], payload: Record<string, unknown>): MatchEvent {
  return { id: createId('ev'), matchId: '', timestamp: 0, type, payload };
}

function freshColours(): Record<ColourName, boolean> {
  return {
    yellow: true,
    green: true,
    brown: true,
    blue: true,
    pink: true,
    black: true,
  };
}

const COLOUR_NAMES: readonly ColourName[] = COLOUR_ORDER;

function isColourName(v: unknown): v is ColourName {
  return typeof v === 'string' && (COLOUR_NAMES as readonly string[]).includes(v);
}

/** 把 payload.ball（球名或分值）解析成球名。 */
function parseBall(v: unknown): BallName | null {
  if (v === 'red') return 'red';
  if (isColourName(v)) return v;
  if (typeof v === 'number') {
    if (v === 1) return 'red';
    for (const c of COLOUR_NAMES) if (BALL_VALUES[c] === v) return c;
  }
  return null;
}

/**
 * SnookerEngine —— 斯诺克规则的唯一事实来源（标准 15 红）。
 *
 * 契约来源：docs/rules/snooker.md，每一条场景都在这里有对应实现，
 * 并由 tests/rules/snooker/snooker.spec.ts 逐条覆盖。
 *
 * 与八球/九球的结构性差别：**这是计分制**，一局结束于「彩球清完」或认输，
 * 而不是「打进某颗球」。所以 FRAME_WON 的判定在这里是按分数高低。
 */
export class SnookerEngine implements GameEngine<SnookerState> {
  readonly gameType = 'snooker' as const;

  createInitialState(ctx: EngineContext): SnookerState {
    const seats = Math.max(1, ctx.players.length);
    const scores: Record<number, number> = {};
    const breaks: Record<number, number> = {};
    const highestBreak: Record<number, number> = {};
    for (let i = 0; i < seats; i += 1) {
      scores[i] = 0;
      breaks[i] = 0;
      highestBreak[i] = 0;
    }
    return {
      stage: 'reds',
      redsRemaining: RED_COUNT,
      coloursOnTable: freshColours(),
      scores,
      breaks,
      highestBreak,
      activePlayerIndex: 0,
      turnNumber: 1,
      freeBall: false,
      snookered: false,
      expectingColour: false,
      lastColourOnBreak: null,
      frameComplete: false,
      matchComplete: false,
    };
  }

  private rulesOf(ctx: EngineContext): SnookerRules {
    return resolveSnookerRules(ctx.ruleSet.config);
  }

  private opponentSeat(state: SnookerState): number {
    const seats = Object.keys(state.scores).length || 2;
    return (state.activePlayerIndex + 1) % Math.max(1, seats);
  }

  reduce(state: SnookerState, command: MatchCommand, ctx: EngineContext): SnookerResult {
    const rules = this.rulesOf(ctx);
    const seat = state.activePlayerIndex;
    const trace = (
      decision: string,
      validation: SnookerResult['trace']['validation'],
    ): SnookerResult['trace'] => ({
      command: command.type,
      playerIndex: seat,
      validation,
      decision,
      reasons: [],
      events: [],
    });

    if (state.frameComplete) {
      const t = trace('本局已结束，忽略指令', 'IGNORED');
      t.reasons.push('frameComplete=true');
      return { state, events: [], trace: t };
    }

    switch (command.type) {
      case 'SCORE':
      case 'BALL_POTTED':
        return this.onScore(state, command, ctx, trace);
      case 'FOUL':
        return this.onFoul(state, command, rules, trace);
      case 'BALL_MISSED':
        return this.onFoul(
          state,
          { type: 'FOUL', payload: { reason: 'miss' } },
          rules,
          trace,
        );
      case 'END_BREAK':
        return this.onEndBreak(state, trace);
      case 'END_TURN':
        return this.onEndBreak(state, trace);
      case 'CONCEDE':
        return this.onConcede(state, ctx, trace);
      case 'RERACK':
        return this.onRerack(state, ctx, trace);
      case 'COMPLETE_FRAME':
        return this.onCompleteFrame(state, command, ctx, trace);
      case 'ENGINE_COMMAND':
        return this.onEngineCommand(state, command, rules, trace);
      default:
        return { state, events: [], trace: trace('非斯诺克指令', 'IGNORED') };
    }
  }

  // -------------------------------------------------------------- scoring ---
  private onScore(
    state: SnookerState,
    command: MatchCommand,
    ctx: EngineContext,
    trace: (d: string, v: SnookerResult['trace']['validation']) => SnookerResult['trace'],
  ): SnookerResult {
    const payload = (command.payload ?? {}) as { ball?: unknown };
    const ball = parseBall(payload.ball);
    const t0 = trace('', 'LEGAL');

    if (!ball) {
      t0.decision = `无效球名 ${String(payload.ball)}`;
      t0.validation = 'ILLEGAL';
      t0.reasons.push('可用：red / yellow(2) / green(3) / brown(4) / blue(5) / pink(6) / black(7)');
      return { state, events: [], trace: t0 };
    }

    const value = BALL_VALUES[ball];

    // --- 彩球阶段：必须按分值由低到高 -------------------------------------
    if (state.stage === 'colours') {
      const expected = nextColour(state);
      if (ball === 'red') {
        t0.decision = '彩球阶段没有红球';
        t0.validation = 'ILLEGAL';
        return { state, events: [], trace: t0 };
      }
      if (!state.coloursOnTable[ball]) {
        t0.decision = `${ball} 已清台`;
        t0.validation = 'ILLEGAL';
        return { state, events: [], trace: t0 };
      }
      if (ball !== expected) {
        t0.decision = `彩球阶段应先打 ${expected}`;
        t0.validation = 'ILLEGAL';
        t0.reasons.push(expected ? `当前应打 ${expected}（${BALL_VALUES[expected]} 分）` : '彩球已清完');
        return { state, events: [], trace: t0 };
      }
      return this.applyScore(state, ctx, ball, value, trace, { removeColour: true });
    }

    // --- 红球阶段 ---------------------------------------------------------
    if (ball === 'red') {
      if (state.redsRemaining <= 0) {
        t0.decision = '红球已清完，进入彩球阶段';
        t0.validation = 'ILLEGAL';
        return { state, events: [], trace: t0 };
      }
      if (state.expectingColour) {
        t0.decision = '刚打进红球，下一目标应是一颗彩球';
        t0.validation = 'ILLEGAL';
        return { state, events: [], trace: t0 };
      }
      return this.applyScore(state, ctx, 'red', value, trace, {});
    }

    // 红球阶段打彩球：必须先打进过一颗红球（或持有自由球）
    if (!state.expectingColour && !state.freeBall) {
      t0.decision = '红球阶段必须先碰红球';
      t0.validation = 'ILLEGAL';
      return { state, events: [], trace: t0 };
    }
    if (state.expectingColour && state.lastColourOnBreak !== null) {
      t0.decision = '同一杆不能连续打两颗彩球';
      t0.validation = 'ILLEGAL';
      return { state, events: [], trace: t0 };
    }
    // 红球阶段打进彩球 → 计分后彩球放回点位（re-spot）
    return this.applyScore(state, ctx, ball, value, trace, { respot: true });
  }

  /** 记分并推进阶段。 */
  private applyScore(
    state: SnookerState,
    ctx: EngineContext,
    ball: BallName,
    value: number,
    trace: (d: string, v: SnookerResult['trace']['validation']) => SnookerResult['trace'],
    opts: { removeColour?: boolean; respot?: boolean },
  ): SnookerResult {
    const seat = state.activePlayerIndex;
    const scores = { ...state.scores, [seat]: (state.scores[seat] ?? 0) + value };
    const breaks = { ...state.breaks, [seat]: (state.breaks[seat] ?? 0) + value };
    const highestBreak = {
      ...state.highestBreak,
      [seat]: Math.max(state.highestBreak[seat] ?? 0, breaks[seat] ?? 0),
    };

    const t = trace(`${ball} +${value}`, 'LEGAL');
    const events: MatchEvent[] = [
      makeEvent('SCORE_ADDED', { playerIndex: seat, points: value, ball }),
    ];

    let stage = state.stage;
    let redsRemaining = state.redsRemaining;
    let coloursOnTable = state.coloursOnTable;
    let lastColourOnBreak: number | null = state.lastColourOnBreak;
    let expectingColour = state.expectingColour;
    let freeBall = state.freeBall;
    let frameComplete = false;
    let winnerPlayerIndex = state.winnerPlayerIndex;
    let winReason = state.winReason;

    if (opts.removeColour && ball !== 'red') {
      coloursOnTable = { ...coloursOnTable, [ball]: false };
      lastColourOnBreak = value;
      expectingColour = false;
    } else if (opts.respot && ball !== 'red') {
      // 红球阶段打进彩球：计分后放回点位（不影响 coloursOnTable）
      events.push(makeEvent('ENGINE_EVENT', { action: 're-spot', ball }));
      lastColourOnBreak = value;
      expectingColour = false; // 下一目标又是红球
    } else if (ball === 'red') {
      redsRemaining = state.redsRemaining - 1;
      expectingColour = true; // 下一目标是一颗彩球
      // 打进红球意味着「上一颗彩球」这个事实已经过去，
      // 否则下一杆打彩球会被误判成「同一杆连打两颗彩球」。
      lastColourOnBreak = null;
    }
    freeBall = false;

    // 红球清完 → 进入彩球阶段
    // 红球清完后，要等这一杆的彩球也打完才真正进入彩球阶段
    if (stage === 'reds' && redsRemaining === 0 && !expectingColour) {
      stage = 'colours';
      lastColourOnBreak = null;
      events.push(makeEvent('ENGINE_EVENT', { action: 'colours-phase' }));
    }

    // 彩球阶段清完 → 本局结束
    if (stage === 'colours' && nextColour({ ...state, coloursOnTable }) === null) {
      frameComplete = true;
      winnerPlayerIndex = this.leaderSeat(scores);
      winReason = '彩球清台';
      events.push(
        makeEvent('FRAME_WON', {
          frame: 0,
          winnerPlayerIndex,
          winnerPlayerId: ctx.players[winnerPlayerIndex]?.playerId ?? null,
          reason: 'colours-cleared',
          winReason,
        }),
      );
    }

    t.events = events.map((e) => e.type);
    return {
      state: {
        ...state,
        stage,
        redsRemaining,
        coloursOnTable,
        scores,
        breaks,
        highestBreak,
        lastColourOnBreak,
        expectingColour,
        freeBall,
        frameComplete,
        winnerPlayerIndex,
        winReason,
      },
      events,
      trace: t,
    };
  }

  private leaderSeat(scores: Record<number, number>): number {
    let best = 0;
    for (const k of Object.keys(scores)) {
      const i = Number(k);
      if ((scores[i] ?? 0) > (scores[best] ?? 0)) best = i;
    }
    return best;
  }

  // ----------------------------------------------------------------- foul ---
  private onFoul(
    state: SnookerState,
    command: MatchCommand,
    rules: SnookerRules,
    trace: (d: string, v: SnookerResult['trace']['validation']) => SnookerResult['trace'],
  ): SnookerResult {
    const payload = (command.payload ?? {}) as { ball?: unknown; reason?: unknown };
    const seat = state.activePlayerIndex;
    const next = this.opponentSeat(state);

    // 罚分 = max(最低罚分, 所涉及球的分值)
    const ball = parseBall(payload.ball);
    const ballValue = ball ? BALL_VALUES[ball] : 0;
    const penalty = Math.max(rules.minFoulPenalty, ballValue);

    const scores = { ...state.scores, [next]: (state.scores[next] ?? 0) + penalty };
    const breaks = { ...state.breaks, [seat]: 0 };

    const events: MatchEvent[] = [
      makeEvent('SCORE_ADDED', {
        playerIndex: next,
        points: penalty,
        reason: 'foul',
      }),
      makeEvent('FOUL', {
        reason: typeof payload.reason === 'string' ? payload.reason : 'OTHER',
        penalty,
        playerIndex: seat,
      }),
    ];

    // 犯规后形成斯诺克 → 自由球
    let freeBall = false;
    if (rules.freeBall && state.snookered) {
      freeBall = true;
      events.push(makeEvent('ENGINE_EVENT', { action: 'free-ball', awardedTo: next }));
    }

    events.push(
      makeEvent('TURN_ENDED', { from: seat, to: next, turnNumber: state.turnNumber + 1 }),
    );

    const t = trace(`犯规，对手 +${penalty}`, 'ILLEGAL');
    t.reasons.push(`罚分取 max(${rules.minFoulPenalty}, ${ballValue})`);
    t.events = events.map((e) => e.type);

    return {
      state: {
        ...state,
        scores,
        breaks,
        activePlayerIndex: next,
        turnNumber: state.turnNumber + 1,
        expectingColour: false,
        lastColourOnBreak: null,
        freeBall,
      },
      events,
      trace: t,
    };
  }

  // ------------------------------------------------------------ end break ---
  private onEndBreak(
    state: SnookerState,
    trace: (d: string, v: SnookerResult['trace']['validation']) => SnookerResult['trace'],
  ): SnookerResult {
    const seat = state.activePlayerIndex;
    const next = this.opponentSeat(state);
    const t = trace('结束单杆，换手', 'LEGAL');
    t.events = ['PLAYER_SWITCHED'];
    return {
      state: {
        ...state,
        breaks: { ...state.breaks, [seat]: 0 },
        activePlayerIndex: next,
        turnNumber: state.turnNumber + 1,
        expectingColour: false,
        lastColourOnBreak: null,
      },
      events: [
        makeEvent('PLAYER_SWITCHED', {
          from: seat,
          to: next,
          turnNumber: state.turnNumber + 1,
        }),
      ],
      trace: t,
    };
  }

  // --------------------------------------------------------------- misc -----
  private onEngineCommand(
    state: SnookerState,
    command: MatchCommand,
    rules: SnookerRules,
    trace: (d: string, v: SnookerResult['trace']['validation']) => SnookerResult['trace'],
  ): SnookerResult {
    const payload = (command.payload ?? {}) as { action?: unknown; ball?: unknown };
    const action = String(payload.action ?? '');

    if (action === 're-spot') {
      const ball = parseBall(payload.ball);
      const t = trace(ball ? `重置 ${ball} 到点位` : '重置彩球到点位', 'LEGAL');
      t.events = ['ENGINE_EVENT'];
      const coloursOnTable = ball && ball !== 'red' ? { ...state.coloursOnTable, [ball]: true } : state.coloursOnTable;
      return {
        state: { ...state, coloursOnTable },
        events: [makeEvent('ENGINE_EVENT', { action: 're-spot', ball: ball ?? undefined })],
        trace: t,
      };
    }

    if (action === 'snookered') {
      const t = trace('标记形成斯诺克（下一次犯规将判自由球）', 'LEGAL');
      t.events = ['ENGINE_EVENT'];
      return {
        state: { ...state, snookered: true },
        events: [makeEvent('ENGINE_EVENT', { action: 'snookered' })],
        trace: t,
      };
    }

    if (action === 'free-ball') {
      if (!rules.freeBall) {
        const t = trace('本规则集未启用自由球，忽略', 'IGNORED');
        return { state, events: [], trace: t };
      }
      const t = trace('判自由球', 'LEGAL');
      t.events = ['ENGINE_EVENT'];
      return {
        state: { ...state, freeBall: true, snookered: false },
        events: [
          makeEvent('ENGINE_EVENT', {
            action: 'free-ball',
            awardedTo: state.activePlayerIndex,
          }),
        ],
        trace: t,
      };
    }

    return { state, events: [], trace: trace(`未知的引擎指令 ${action}`, 'IGNORED') };
  }

  private onConcede(
    state: SnookerState,
    ctx: EngineContext,
    trace: (d: string, v: SnookerResult['trace']['validation']) => SnookerResult['trace'],
  ): SnookerResult {
    const loser = state.activePlayerIndex;
    const winner = this.opponentSeat(state);
    const t = trace('认输，对手获胜', 'LEGAL');
    t.events = ['CONCEDE', 'FRAME_WON'];
    return {
      state: {
        ...state,
        frameComplete: true,
        matchComplete: true,
        winnerPlayerIndex: winner,
        loserPlayerIndex: loser,
        winReason: '认输',
      },
      events: [
        makeEvent('CONCEDE', { playerIndex: loser }),
        makeEvent('FRAME_WON', {
          frame: 0,
          winnerPlayerIndex: winner,
          winnerPlayerId: ctx.players[winner]?.playerId ?? null,
          reason: 'concede',
          winReason: '认输',
        }),
      ],
      trace: t,
    };
  }

  private onRerack(
    state: SnookerState,
    ctx: EngineContext,
    trace: (d: string, v: SnookerResult['trace']['validation']) => SnookerResult['trace'],
  ): SnookerResult {
    const t = trace('重新摆球，本局重置', 'LEGAL');
    t.events = ['RERACK'];
    return {
      state: this.startFrame(state, state.activePlayerIndex, ctx),
      events: [makeEvent('RERACK', { reason: 'manual' })],
      trace: t,
    };
  }

  private onCompleteFrame(
    state: SnookerState,
    command: MatchCommand,
    ctx: EngineContext,
    trace: (d: string, v: SnookerResult['trace']['validation']) => SnookerResult['trace'],
  ): SnookerResult {
    const payload = (command.payload ?? {}) as { winnerPlayerIndex?: unknown };
    const declared = Number(payload.winnerPlayerIndex);
    const hasDeclared = Number.isInteger(declared) && declared >= 0;
    if (hasDeclared && declared >= ctx.players.length) {
      const t = trace(`无效的胜方席位 ${declared}`, 'ILLEGAL');
      return { state, events: [], trace: t };
    }
    // 斯诺克按分数定胜负：没指定就取当前领先方（不是"当前击球方"）
    const winner = hasDeclared ? declared : this.leaderSeat(state.scores);
    const winReason = hasDeclared ? `裁判判定第 ${winner + 1} 位选手获胜` : '按分数判定';
    const t = trace(winReason, 'LEGAL');
    t.events = ['FRAME_WON'];
    return {
      state: {
        ...state,
        frameComplete: true,
        winnerPlayerIndex: winner,
        winReason,
      },
      events: [
        makeEvent('FRAME_WON', {
          frame: 0,
          winnerPlayerIndex: winner,
          winnerPlayerId: ctx.players[winner]?.playerId ?? null,
          reason: hasDeclared ? 'referee' : 'points',
          winReason,
        }),
      ],
      trace: t,
    };
  }

  startFrame(state: SnookerState, breakPlayerIndex: number, ctx: EngineContext): SnookerState {
    const seats = Math.max(2, ctx.players.length);
    const scores: Record<number, number> = {};
    const breaks: Record<number, number> = {};
    const highestBreak: Record<number, number> = {};
    for (let i = 0; i < seats; i += 1) {
      scores[i] = 0;
      breaks[i] = 0;
      highestBreak[i] = state.highestBreak[i] ?? 0; // 最高单杆跨局保留
    }
    const breaker = breakPlayerIndex >= 0 && breakPlayerIndex < seats ? breakPlayerIndex : 0;
    return {
      stage: 'reds',
      redsRemaining: RED_COUNT,
      coloursOnTable: freshColours(),
      scores,
      breaks,
      highestBreak,
      activePlayerIndex: breaker,
      turnNumber: 1,
      freeBall: false,
      snookered: false,
      expectingColour: false,
      lastColourOnBreak: null,
      frameComplete: false,
      matchComplete: false,
      winnerPlayerIndex: undefined,
      loserPlayerIndex: undefined,
      winReason: undefined,
    };
  }

  getScoreSummary(state: SnookerState): ScoreSummary {
    return {
      lines: Object.keys(state.scores)
        .sort()
        .map((k) => ({
          playerId: null,
          label: `P${Number(k) + 1}`,
          value: state.scores[Number(k)] ?? 0,
        })),
      note:
        state.stage === 'reds'
          ? `红球阶段 · 剩 ${state.redsRemaining} 红`
          : '彩球阶段',
    };
  }

  isFrameComplete(state: SnookerState): boolean {
    return state.frameComplete;
  }

  /**
   * 认输时引擎会把 matchComplete 置位 —— 整场随之结束。
   * 其余情况（彩球清台）只是一局结束，整场由 Match 层的 Race To 决定。
   */
  isMatchComplete(state: SnookerState): boolean {
    return state.matchComplete;
  }

  getWinner(state: SnookerState): string | null {
    return state.winnerPlayerIndex === undefined ? null : String(state.winnerPlayerIndex);
  }

  getStatistics(state: SnookerState): unknown {
    const seats = Object.keys(state.scores).map((k) => Number(k));
    const leader = this.leaderSeat(state.scores);
    const margin = Object.keys(state.scores).length
      ? Math.max(...seats.map((i) => state.scores[i] ?? 0)) -
        Math.min(...seats.map((i) => state.scores[i] ?? 0))
      : 0;
    return {
      stage: state.stage,
      redsRemaining: state.redsRemaining,
      scores: state.scores,
      breaks: state.breaks,
      highestBreak: state.highestBreak,
      currentBreak: state.breaks[state.activePlayerIndex] ?? 0,
      margin,
      pointsRemaining: pointsRemaining(state),
      snookersRequired: Object.fromEntries(
        seats.map((i) => [String(i), snookersRequired(state, i)]),
      ),
      freeBall: state.freeBall,
      maxBreak: MAX_BREAK,
      leader,
    };
  }

  /** 本局分数快照，供排名总览跨局累计。 */
  getFrameScores(state: SnookerState): Record<number, number> | null {
    const values = Object.values(state.scores ?? {});
    return values.some((v) => v !== 0) ? state.scores : null;
  }
}

/** EventLog 重放。 */
export function applySnookerEvent(state: SnookerState, event: MatchEvent): SnookerState {
  const p = event.payload as Record<string, unknown>;
  switch (event.type) {
    case 'SCORE_ADDED': {
      const playerIndex =
        typeof p.playerIndex === 'number' ? p.playerIndex : state.activePlayerIndex;
      const points = typeof p.points === 'number' ? p.points : 0;
      const isFoul = p.reason === 'foul';
      const ball = parseBall(p.ball);
      const scores = { ...state.scores, [playerIndex]: (state.scores[playerIndex] ?? 0) + points };
      const breaks = isFoul
        ? state.breaks
        : { ...state.breaks, [playerIndex]: (state.breaks[playerIndex] ?? 0) + points };
      const highestBreak = {
        ...state.highestBreak,
        [playerIndex]: Math.max(
          state.highestBreak[playerIndex] ?? 0,
          breaks[playerIndex] ?? 0,
        ),
      };
      let next: SnookerState = { ...state, scores, breaks, highestBreak };
      if (!isFoul && ball) {
        if (ball === 'red') {
          next = {
            ...next,
            redsRemaining: Math.max(0, state.redsRemaining - 1),
            expectingColour: true,
            lastColourOnBreak: null,
          };
        } else if (state.stage === 'colours') {
          next = {
            ...next,
            coloursOnTable: { ...state.coloursOnTable, [ball]: false },
            expectingColour: false,
          };
        } else {
          // 红球阶段打进彩球：放回点位，下一目标又是红球
          next = { ...next, expectingColour: false, lastColourOnBreak: BALL_VALUES[ball] };
        }
      }
      return next;
    }
    case 'FOUL': {
      const seat = typeof p.playerIndex === 'number' ? p.playerIndex : state.activePlayerIndex;
      return {
        ...state,
        breaks: { ...state.breaks, [seat]: 0 },
        expectingColour: false,
        lastColourOnBreak: null,
      };
    }
    case 'TURN_ENDED':
    case 'PLAYER_SWITCHED': {
      const to = typeof p.to === 'number' ? p.to : state.activePlayerIndex;
      return {
        ...state,
        activePlayerIndex: to,
        turnNumber: typeof p.turnNumber === 'number' ? p.turnNumber : state.turnNumber + 1,
        expectingColour: false,
        lastColourOnBreak: null,
      };
    }
    case 'ENGINE_EVENT': {
      const action = String(p.action ?? '');
      if (action === 'free-ball') return { ...state, freeBall: true, snookered: false };
      if (action === 'snookered') return { ...state, snookered: true };
      if (action === 're-spot') {
        const ball = parseBall(p.ball);
        if (ball && ball !== 'red') {
          return { ...state, coloursOnTable: { ...state.coloursOnTable, [ball]: true } };
        }
        return state;
      }
      return state;
    }
    case 'RERACK':
      return {
        ...state,
        stage: 'reds',
        redsRemaining: RED_COUNT,
        coloursOnTable: freshColours(),
        expectingColour: false,
        lastColourOnBreak: null,
        freeBall: false,
        snookered: false,
        frameComplete: false,
        winnerPlayerIndex: undefined,
        loserPlayerIndex: undefined,
        winReason: undefined,
      };
    case 'FRAME_WON': {
      const winner =
        typeof p.winnerPlayerIndex === 'number' ? p.winnerPlayerIndex : state.activePlayerIndex;
      return {
        ...state,
        frameComplete: true,
        winnerPlayerIndex: winner,
        winReason:
          typeof p.winReason === 'string'
            ? p.winReason
            : typeof p.reason === 'string'
              ? p.reason
              : undefined,
      };
    }
    case 'FRAME_LOST': {
      const loser =
        typeof p.loserPlayerIndex === 'number' ? p.loserPlayerIndex : state.activePlayerIndex;
      const winner =
        typeof p.winnerPlayerIndex === 'number'
          ? p.winnerPlayerIndex
          : (loser + 1) % (Object.keys(state.scores).length || 2);
      return {
        ...state,
        frameComplete: true,
        loserPlayerIndex: loser,
        winnerPlayerIndex: winner,
        winReason:
          typeof p.winReason === 'string'
            ? p.winReason
            : typeof p.reason === 'string'
              ? p.reason
              : undefined,
      };
    }
    case 'CONCEDE':
      return { ...state, matchComplete: true };
    default:
      return state;
  }
}

export function replaySnookerState(initial: SnookerState, events: MatchEvent[]): SnookerState {
  return events.reduce(applySnookerEvent, initial);
}
