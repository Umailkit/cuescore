import type { EngineContext, EngineResult, GameEngine, ScoreSummary } from '../types';
import type { MatchCommand, MatchEvent } from '../../types';
import {
  CUE_BALL,
  SIX_BALL_FOUL_LABELS,
  SIX_BALL_NUMBERS,
  type BallStatus,
  type FoulReason,
  type FoulRecord,
  type SixBallRules,
  type SixBallState,
} from './types';
import { resolveSixBallRules } from './rules';
import { createId } from '../../util/id';

export interface SixBallResult extends EngineResult<SixBallState> {
  trace: {
    command: string;
    playerIndex: number;
    validation: 'LEGAL' | 'ILLEGAL' | 'IGNORED';
    decision: string;
    reasons: string[];
    events: string[];
  };
}

const NO_FOUL: FoulRecord = { occurred: false };

function initialBalls(): Record<number, BallStatus> {
  const out: Record<number, BallStatus> = {};
  for (const b of SIX_BALL_NUMBERS) out[b] = 'ON_TABLE';
  return out;
}

function makeEvent(type: MatchEvent['type'], payload: Record<string, unknown>): MatchEvent {
  return { id: createId('ev'), matchId: '', timestamp: 0, type, payload };
}

function foulOf(reason: FoulReason, ball?: number, detail?: string): FoulRecord {
  return {
    occurred: true,
    reason,
    ball,
    detail: detail ?? SIX_BALL_FOUL_LABELS[reason],
  };
}

/** 台面上最小号的球 —— 六球按号序击打。 */
export function lowestBallOnTable(state: SixBallState): number | null {
  for (const b of SIX_BALL_NUMBERS) {
    if (state.balls[b] === 'ON_TABLE') return b;
  }
  return null;
}

/**
 * SixBallEngine —— CueScore Standard 六球。
 *
 * 与八球/九球的关键差别：**这是计分制，不是「清台制」**。
 * 打进一颗球是本方 `perBall` 分（不是 score++ 的隐藏魔法），
 * 先到 `targetPoints` 分者赢下本局。
 */
export class SixBallEngine implements GameEngine<SixBallState> {
  readonly gameType = 'six-ball' as const;

  createInitialState(ctx: EngineContext): SixBallState {
    const seats = Math.max(1, ctx.players.length);
    const points: Record<number, number> = {};
    for (let i = 0; i < seats; i += 1) points[i] = 0;
    return {
      balls: initialBalls(),
      activePlayerIndex: 0,
      turnNumber: 1,
      points,
      break: { completed: false, shotTaken: false, playerIndex: 0 },
      foul: NO_FOUL,
      potted: [],
      runCount: 0,
      frameStatus: 'PLAYING',
    };
  }

  private rulesOf(ctx: EngineContext): SixBallRules {
    return resolveSixBallRules(ctx.ruleSet.config);
  }

  private opponentSeat(state: SixBallState): number {
    const seats = Object.keys(state.points).length || 2;
    return (state.activePlayerIndex + 1) % Math.max(1, seats);
  }

  private markBreakShotTaken(state: SixBallState): SixBallState['break'] {
    return state.break.completed ? { ...state.break, shotTaken: true } : state.break;
  }

  reduce(state: SixBallState, command: MatchCommand, ctx: EngineContext): SixBallResult {
    const rules = this.rulesOf(ctx);
    const seat = state.activePlayerIndex;
    const trace = (
      decision: string,
      validation: SixBallResult['trace']['validation'],
    ): SixBallResult['trace'] => ({
      command: command.type,
      playerIndex: seat,
      validation,
      decision,
      reasons: [],
      events: [],
    });

    if (state.frameStatus !== 'PLAYING') {
      const t = trace('本局已结束，忽略击球指令', 'IGNORED');
      t.reasons.push(`frameStatus=${state.frameStatus}`);
      return { state, events: [], trace: t };
    }

    switch (command.type) {
      case 'BREAK_STARTED':
        return this.onBreak(state, trace);
      case 'BALL_POTTED':
      case 'SCORE':
        return this.onBallPotted(state, command, ctx, rules, trace);
      case 'BALL_MISSED':
        return this.onBallMissed(state, ctx, rules, trace);
      case 'FOUL':
        return this.onFoul(state, command, ctx, rules, trace);
      case 'END_TURN':
        return this.onEndTurn(state, trace);
      case 'CONCEDE':
        return this.onConcede(state, ctx, trace);
      case 'RERACK':
        return this.onRerack(state, ctx, trace);
      case 'COMPLETE_FRAME':
        return this.onCompleteFrame(state, command, ctx, trace);
      default:
        return { state, events: [], trace: trace('非六球指令', 'IGNORED') };
    }
  }

  private onBreak(
    state: SixBallState,
    trace: (d: string, v: SixBallResult['trace']['validation']) => SixBallResult['trace'],
  ): SixBallResult {
    if (state.break.completed) {
      const t = trace('本局已开球，忽略重复开球', 'IGNORED');
      return { state, events: [], trace: t };
    }
    const t = trace('开球', 'LEGAL');
    t.events = ['BREAK_STARTED'];
    return {
      state: {
        ...state,
        break: { completed: true, shotTaken: false, playerIndex: state.activePlayerIndex },
      },
      events: [makeEvent('BREAK_STARTED', { playerIndex: state.activePlayerIndex })],
      trace: t,
    };
  }

  private onBallPotted(
    state: SixBallState,
    command: MatchCommand,
    ctx: EngineContext,
    rules: SixBallRules,
    trace: (d: string, v: SixBallResult['trace']['validation']) => SixBallResult['trace'],
  ): SixBallResult {
    const payload = (command.payload ?? {}) as {
      ball?: unknown;
      scratch?: unknown;
      firstContact?: unknown;
      points?: unknown;
    };
    const ball = Number(payload.ball);
    const seat = state.activePlayerIndex;

    if (!Number.isInteger(ball) || (ball !== CUE_BALL && !SIX_BALL_NUMBERS.includes(ball))) {
      const t = trace(`非法球号 ${String(payload.ball)}`, 'ILLEGAL');
      t.reasons.push('六球只有 1–6 号（母球为 0）');
      return { state, events: [], trace: t };
    }
    if (ball !== CUE_BALL && state.balls[ball] === 'POCKETED') {
      const t = trace(`${ball} 号球已不在台上`, 'ILLEGAL');
      return { state, events: [], trace: t };
    }

    const scratch = ball === CUE_BALL || payload.scratch === true;
    if (scratch) {
      return this.applyFoul(
        state,
        ctx,
        rules,
        foulOf('SCRATCH', ball),
        trace,
        { pottedBall: null },
      );
    }

    const firstContact =
      typeof payload.firstContact === 'number' ? payload.firstContact : undefined;
    const lowest = lowestBallOnTable(state);
    if (firstContact !== undefined && lowest !== null && firstContact !== lowest) {
      return this.applyFoul(
        state,
        ctx,
        rules,
        foulOf('WRONG_BALL_FIRST', ball, `先碰到 ${firstContact} 号，应先碰 ${lowest} 号`),
        trace,
        { pottedBall: ball },
      );
    }

    // --- 合法进球：记分 ---------------------------------------------------
    const gain =
      typeof payload.points === 'number' && Number.isFinite(payload.points)
        ? Math.max(0, payload.points)
        : rules.perBall;
    const points = { ...state.points, [seat]: (state.points[seat] ?? 0) + gain };
    const pottedRecord = {
      ball,
      playerIndex: seat,
      legal: true,
      turnNumber: state.turnNumber,
      points: gain,
    };

    const events: MatchEvent[] = [
      makeEvent('BALL_POTTED', {
        ball,
        playerIndex: seat,
        legal: true,
        turnNumber: state.turnNumber,
        points: gain,
        continues: true,
      }),
      makeEvent('SCORE_ADDED', { playerIndex: seat, points: gain, ball }),
    ];

    let frameStatus = state.frameStatus;
    let winReason: string | undefined;
    if ((points[seat] ?? 0) >= rules.targetPoints) {
      events.push(
        makeEvent('FRAME_WON', {
          frame: 0,
          winnerPlayerIndex: seat,
          winnerPlayerId: ctx.players[seat]?.playerId ?? null,
          reason: 'points-target',
          winReason: `先达到 ${rules.targetPoints} 分`,
        }),
      );
      frameStatus = 'WON';
      winReason = `先达到 ${rules.targetPoints} 分`;
    }

    const t = trace(
      frameStatus === 'WON' ? `本方得分 ${gain}，达到目标分，本局获胜` : `本方得分 ${gain}`,
      'LEGAL',
    );
    t.events = events.map((e) => e.type);
    return {
      state: {
        ...state,
        balls: { ...state.balls, [ball]: 'POCKETED' as const },
        points,
        potted: [...state.potted, pottedRecord],
        foul: NO_FOUL,
        runCount: state.runCount + 1,
        break: this.markBreakShotTaken(state),
        frameStatus,
        winnerPlayerIndex: frameStatus === 'WON' ? seat : state.winnerPlayerIndex,
        winReason: winReason ?? state.winReason,
      },
      events,
      trace: t,
    };
  }

  private onBallMissed(
    state: SixBallState,
    ctx: EngineContext,
    rules: SixBallRules,
    trace: (d: string, v: SixBallResult['trace']['validation']) => SixBallResult['trace'],
  ): SixBallResult {
    const seat = state.activePlayerIndex;
    const events: MatchEvent[] = [
      makeEvent('BALL_MISSED', { playerIndex: seat }),
      makeEvent('FOUL', { reason: 'NO_CONTACT', playerIndex: seat }),
    ];
    return this.applyFoul(state, ctx, rules, foulOf('NO_CONTACT'), trace, {}, events);
  }

  private onFoul(
    state: SixBallState,
    command: MatchCommand,
    ctx: EngineContext,
    rules: SixBallRules,
    trace: (d: string, v: SixBallResult['trace']['validation']) => SixBallResult['trace'],
  ): SixBallResult {
    const raw = String((command.payload ?? {}).reason ?? 'OTHER');
    const known: FoulReason[] = ['NO_CONTACT', 'SCRATCH', 'WRONG_BALL_FIRST', 'OTHER'];
    const reason = (known as string[]).includes(raw) ? (raw as FoulReason) : 'OTHER';
    return this.applyFoul(state, ctx, rules, foulOf(reason), trace, {});
  }

  /** 犯规处理：对手加分，并按 config 决定是否换手。 */
  private applyFoul(
    state: SixBallState,
    ctx: EngineContext,
    rules: SixBallRules,
    foul: FoulRecord,
    trace: (d: string, v: SixBallResult['trace']['validation']) => SixBallResult['trace'],
    opts: { pottedBall?: number | null },
    extraEvents: MatchEvent[] = [],
  ): SixBallResult {
    const seat = state.activePlayerIndex;
    const nextSeat = this.opponentSeat(state);
    const events: MatchEvent[] = [...extraEvents];
    if (!events.some((e) => e.type === 'FOUL')) {
      events.push(makeEvent('FOUL', { reason: foul.reason, playerIndex: seat }));
    }

    const pottedBall =
      opts.pottedBall !== undefined && opts.pottedBall !== null ? opts.pottedBall : null;
    let balls = state.balls;
    if (pottedBall !== null) {
      balls = { ...state.balls, [pottedBall]: 'POCKETED' as const };
      events.push(
        makeEvent('BALL_POTTED', {
          ball: pottedBall,
          playerIndex: seat,
          legal: false,
          turnNumber: state.turnNumber,
          continues: false,
        }),
      );
    }

    // 对手加分
    let points = state.points;
    let frameStatus = state.frameStatus;
    let winnerPlayerIndex = state.winnerPlayerIndex;
    let winReason = state.winReason;
    if (rules.foulPenalty > 0) {
      points = { ...state.points, [nextSeat]: (state.points[nextSeat] ?? 0) + rules.foulPenalty };
      events.push(
        makeEvent('SCORE_ADDED', {
          playerIndex: nextSeat,
          points: rules.foulPenalty,
          reason: 'foul',
        }),
      );
      if ((points[nextSeat] ?? 0) >= rules.targetPoints) {
        events.push(
          makeEvent('FRAME_WON', {
            frame: 0,
            winnerPlayerIndex: nextSeat,
            winnerPlayerId: ctx.players[nextSeat]?.playerId ?? null,
            reason: 'points-target',
            winReason: `对手犯规，先达到 ${rules.targetPoints} 分`,
          }),
        );
        frameStatus = 'WON';
        winnerPlayerIndex = nextSeat;
        winReason = `对手犯规，先达到 ${rules.targetPoints} 分`;
      }
    }

    const t = frameStatus === 'WON' ? trace(winReason ?? '本局结束', 'ILLEGAL') : trace(
      `犯规（${foul.reason}），对手 +${rules.foulPenalty}`,
      'ILLEGAL',
    );

    if (rules.foulSwitchesTurn && frameStatus === 'PLAYING') {
      events.push(
        makeEvent('TURN_ENDED', {
          from: seat,
          to: nextSeat,
          turnNumber: state.turnNumber + 1,
        }),
      );
    }

    t.events = events.map((e) => e.type);
    return {
      state: {
        ...state,
        balls,
        points,
        foul,
        runCount: 0,
        activePlayerIndex:
          rules.foulSwitchesTurn && frameStatus === 'PLAYING' ? nextSeat : seat,
        turnNumber: rules.foulSwitchesTurn && frameStatus === 'PLAYING' ? state.turnNumber + 1 : state.turnNumber,
        break: this.markBreakShotTaken(state),
        frameStatus,
        winnerPlayerIndex,
        winReason,
      },
      events,
      trace: t,
    };
  }

  private onEndTurn(
    state: SixBallState,
    trace: (d: string, v: SixBallResult['trace']['validation']) => SixBallResult['trace'],
  ): SixBallResult {
    const seat = state.activePlayerIndex;
    const nextSeat = this.opponentSeat(state);
    const t = trace('主动结束回合，换手', 'LEGAL');
    t.events = ['TURN_ENDED'];
    return {
      state: {
        ...state,
        activePlayerIndex: nextSeat,
        turnNumber: state.turnNumber + 1,
        runCount: 0,
        break: this.markBreakShotTaken(state),
      },
      events: [
        makeEvent('TURN_ENDED', { from: seat, to: nextSeat, turnNumber: state.turnNumber + 1 }),
      ],
      trace: t,
    };
  }

  private onConcede(
    state: SixBallState,
    ctx: EngineContext,
    trace: (d: string, v: SixBallResult['trace']['validation']) => SixBallResult['trace'],
  ): SixBallResult {
    const loser = state.activePlayerIndex;
    const winner = this.opponentSeat(state);
    const t = trace('认输，对手获胜', 'LEGAL');
    t.events = ['CONCEDE', 'FRAME_LOST'];
    return {
      state: {
        ...state,
        frameStatus: 'LOST',
        loserPlayerIndex: loser,
        winnerPlayerIndex: winner,
        winReason: '认输',
      },
      events: [
        makeEvent('CONCEDE', { playerIndex: loser }),
        makeEvent('FRAME_LOST', {
          loserPlayerIndex: loser,
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
    state: SixBallState,
    ctx: EngineContext,
    trace: (d: string, v: SixBallResult['trace']['validation']) => SixBallResult['trace'],
  ): SixBallResult {
    const t = trace('重新摆球', 'LEGAL');
    t.events = ['RERACK'];
    return {
      state: this.startFrame(state, state.activePlayerIndex, ctx),
      events: [makeEvent('RERACK', { reason: 'manual' })],
      trace: t,
    };
  }

  private onCompleteFrame(
    state: SixBallState,
    command: MatchCommand,
    ctx: EngineContext,
    trace: (d: string, v: SixBallResult['trace']['validation']) => SixBallResult['trace'],
  ): SixBallResult {
    const payload = (command.payload ?? {}) as { winnerPlayerIndex?: unknown };
    const declared = Number(payload.winnerPlayerIndex);
    const hasDeclared = Number.isInteger(declared) && declared >= 0;
    if (hasDeclared && declared >= ctx.players.length) {
      const t = trace(`无效的胜方席位 ${declared}`, 'ILLEGAL');
      return { state, events: [], trace: t };
    }
    const winner = hasDeclared ? declared : state.activePlayerIndex;
    const winReason = hasDeclared ? `裁判判定第 ${winner + 1} 位选手获胜` : '裁判判定当前击球方获胜';
    const t = trace(winReason, 'LEGAL');
    t.events = ['FRAME_WON'];
    return {
      state: { ...state, frameStatus: 'WON', winnerPlayerIndex: winner, winReason },
      events: [
        makeEvent('FRAME_WON', {
          frame: 0,
          winnerPlayerIndex: winner,
          winnerPlayerId: ctx.players[winner]?.playerId ?? null,
          reason: hasDeclared ? 'referee' : 'manual',
          winReason,
        }),
      ],
      trace: t,
    };
  }

  startFrame(_state: SixBallState, breakPlayerIndex: number, ctx: EngineContext): SixBallState {
    const seats = Math.max(2, ctx.players.length);
    const points: Record<number, number> = {};
    for (let i = 0; i < seats; i += 1) points[i] = 0;
    const breaker = breakPlayerIndex >= 0 && breakPlayerIndex < seats ? breakPlayerIndex : 0;
    return {
      balls: initialBalls(),
      activePlayerIndex: breaker,
      turnNumber: 1,
      points,
      break: { completed: false, shotTaken: false, playerIndex: breaker },
      foul: NO_FOUL,
      potted: [],
      runCount: 0,
      frameStatus: 'PLAYING',
      winnerPlayerIndex: undefined,
      loserPlayerIndex: undefined,
      winReason: undefined,
    };
  }

  getScoreSummary(state: SixBallState): ScoreSummary {
    const lowest = lowestBallOnTable(state);
    const lines = Object.keys(state.points)
      .sort()
      .map((k) => ({
        playerId: null,
        label: `P${Number(k) + 1} 得分`,
        value: state.points[Number(k)] ?? 0,
      }));
    return {
      lines,
      note: lowest === null ? '本局结束' : `当前目标球 ${lowest}`,
    };
  }

  isFrameComplete(state: SixBallState): boolean {
    return state.frameStatus !== 'PLAYING';
  }

  isMatchComplete(_state: SixBallState): boolean {
    return false;
  }

  getWinner(state: SixBallState): string | null {
    return state.winnerPlayerIndex === undefined ? null : String(state.winnerPlayerIndex);
  }

  getStatistics(state: SixBallState): unknown {
    return {
      points: state.points,
      potted: state.potted,
      turnNumber: state.turnNumber,
      runCount: state.runCount,
      lowestBall: lowestBallOnTable(state),
    };
  }

  /** 本局分数快照，供排名总览跨局累计。 */
  getFrameScores(state: SixBallState): Record<number, number> | null {
    const values = Object.values(state.points ?? {});
    return values.some((v) => v !== 0) ? state.points : null;
  }
}

/** EventLog 重放：把一条事实事件应用到状态上。 */
export function applySixBallEvent(state: SixBallState, event: MatchEvent): SixBallState {
  const p = event.payload as Record<string, unknown>;
  switch (event.type) {
    case 'BREAK_STARTED': {
      const playerIndex =
        typeof p.playerIndex === 'number' ? p.playerIndex : state.activePlayerIndex;
      return {
        ...state,
        break: { completed: true, shotTaken: false, playerIndex },
      };
    }
    case 'BALL_POTTED': {
      const ball = Number(p.ball);
      if (!Number.isInteger(ball)) return state;
      const legal = p.legal !== false;
      const playerIndex =
        typeof p.playerIndex === 'number' ? p.playerIndex : state.activePlayerIndex;
      return {
        ...state,
        balls: { ...state.balls, [ball]: 'POCKETED' as const },
        potted: [
          ...state.potted,
          {
            ball,
            playerIndex,
            legal,
            turnNumber: typeof p.turnNumber === 'number' ? p.turnNumber : state.turnNumber,
            points: typeof p.points === 'number' ? p.points : 0,
          },
        ],
        foul: legal ? NO_FOUL : state.foul,
        runCount: p.continues === true ? state.runCount + 1 : 0,
        break: state.break.completed ? { ...state.break, shotTaken: true } : state.break,
      };
    }
    case 'SCORE_ADDED': {
      const playerIndex =
        typeof p.playerIndex === 'number' ? p.playerIndex : state.activePlayerIndex;
      const points = typeof p.points === 'number' ? p.points : 0;
      return {
        ...state,
        points: { ...state.points, [playerIndex]: (state.points[playerIndex] ?? 0) + points },
      };
    }
    case 'BALL_MISSED':
      return state;
    case 'FOUL': {
      const raw = String(p.reason ?? 'OTHER') as FoulReason;
      return { ...state, foul: foulOf(raw) };
    }
    case 'TURN_ENDED': {
      const to = typeof p.to === 'number' ? p.to : state.activePlayerIndex;
      return {
        ...state,
        activePlayerIndex: to,
        turnNumber: typeof p.turnNumber === 'number' ? p.turnNumber : state.turnNumber + 1,
        runCount: 0,
        break: state.break.completed ? { ...state.break, shotTaken: true } : state.break,
      };
    }
    case 'RERACK':
      return {
        ...state,
        balls: initialBalls(),
        break: { completed: false, shotTaken: false, playerIndex: state.activePlayerIndex },
        foul: NO_FOUL,
        potted: [],
        runCount: 0,
        frameStatus: 'PLAYING',
        winnerPlayerIndex: undefined,
        loserPlayerIndex: undefined,
        winReason: undefined,
      };
    case 'FRAME_WON': {
      const winner =
        typeof p.winnerPlayerIndex === 'number' ? p.winnerPlayerIndex : state.activePlayerIndex;
      return {
        ...state,
        frameStatus: 'WON',
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
          : (loser + 1) % (Object.keys(state.points).length || 2);
      return {
        ...state,
        frameStatus: 'LOST',
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
      return state;
    default:
      return state;
  }
}

export function replaySixBallState(initial: SixBallState, events: MatchEvent[]): SixBallState {
  return events.reduce(applySixBallEvent, initial);
}
