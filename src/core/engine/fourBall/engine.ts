import type { EngineContext, EngineResult, GameEngine, ScoreSummary } from '../types';
import type { MatchCommand, MatchEvent } from '../../types';
import {
  FOUR_BALL_FOUL_LABELS,
  type FoulReason,
  type FoulRecord,
  type FourBallRules,
  type FourBallState,
  type ScoreRecord,
} from './types';
import { resolveFourBallRules } from './rules';
import { createId } from '../../util/id';

export interface FourBallResult extends EngineResult<FourBallState> {
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

function makeEvent(type: MatchEvent['type'], payload: Record<string, unknown>): MatchEvent {
  return { id: createId('ev'), matchId: '', timestamp: 0, type, payload };
}

function foulOf(reason: FoulReason, detail?: string): FoulRecord {
  return { occurred: true, reason, detail: detail ?? FOUR_BALL_FOUL_LABELS[reason] };
}

/**
 * FourBallEngine —— CueScore Standard 四球（纯加分制）。
 *
 * 引擎不做任何「这颗球值几分」的推断：分值由记分员通过 `SCORE` 命令给出
 * （payload.points），或使用配置里的快捷档位（+1 / +2 / +3）。
 * 这正是模板描述「+1 / +2 / +3 / 自定义加分」的含义。
 */
export class FourBallEngine implements GameEngine<FourBallState> {
  readonly gameType = 'four-ball' as const;

  createInitialState(ctx: EngineContext): FourBallState {
    const seats = Math.max(1, ctx.players.length);
    const points: Record<number, number> = {};
    for (let i = 0; i < seats; i += 1) points[i] = 0;
    return {
      activePlayerIndex: 0,
      turnNumber: 1,
      points,
      scoreLog: [],
      foul: NO_FOUL,
      runCount: 0,
      frameStatus: 'PLAYING',
    };
  }

  private rulesOf(ctx: EngineContext): FourBallRules {
    return resolveFourBallRules(ctx.ruleSet.config);
  }

  private opponentSeat(state: FourBallState): number {
    const seats = Object.keys(state.points).length || 2;
    return (state.activePlayerIndex + 1) % Math.max(1, seats);
  }

  reduce(state: FourBallState, command: MatchCommand, ctx: EngineContext): FourBallResult {
    const rules = this.rulesOf(ctx);
    const seat = state.activePlayerIndex;
    const trace = (
      decision: string,
      validation: FourBallResult['trace']['validation'],
    ): FourBallResult['trace'] => ({
      command: command.type,
      playerIndex: seat,
      validation,
      decision,
      reasons: [],
      events: [],
    });

    if (state.frameStatus !== 'PLAYING') {
      const t = trace('本局已结束，忽略指令', 'IGNORED');
      t.reasons.push(`frameStatus=${state.frameStatus}`);
      return { state, events: [], trace: t };
    }

    switch (command.type) {
      case 'SCORE':
        return this.onScore(state, command, ctx, rules, trace);
      case 'BALL_POTTED':
        // 兼容：把「打进一颗球」当作一次默认档位加分（+1）
        return this.onScore(state, command, ctx, rules, trace);
      case 'ADJUST_SCORE':
        return this.onAdjustScore(state, command, ctx, rules, trace);
      case 'BALL_MISSED':
        return this.onFoul(state, { type: 'FOUL', payload: { reason: 'NO_CONTACT' } }, ctx, rules, trace);
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
        return { state, events: [], trace: trace('非四球指令', 'IGNORED') };
    }
  }

  /**
   * 人工加减分：正数加分、负数扣分。
   *
   * 与 `SCORE` 的分工：`SCORE` 是「这一杆进球了，按档位加分」，
   * 只接受正数；记错要改、或者裁判罚分，走这里。
   */
  private onAdjustScore(
    state: FourBallState,
    command: MatchCommand,
    ctx: EngineContext,
    rules: FourBallRules,
    trace: (d: string, v: FourBallResult['trace']['validation']) => FourBallResult['trace'],
  ): FourBallResult {
    const raw = (command.payload ?? {}) as { points?: unknown; playerIndex?: unknown };
    const delta = Number(raw.points);
    if (!Number.isInteger(delta) || delta === 0) {
      const t = trace(`无效分值 ${String(raw.points)}`, 'ILLEGAL');
      t.reasons.push('分值必须是非零整数（正数加分、负数扣分）');
      return { state, events: [], trace: t };
    }

    // 记分员可以先选定「给谁记」，不传则记给当前击球方。
    const seats = Math.max(1, Object.keys(state.points).length || ctx.players.length);
    let seat = state.activePlayerIndex;
    if (raw.playerIndex !== undefined && raw.playerIndex !== null) {
      const idx = Number(raw.playerIndex);
      if (!Number.isInteger(idx) || idx < 0 || idx >= seats) {
        const t = trace(`无效的球员席位 ${String(raw.playerIndex)}`, 'ILLEGAL');
        t.reasons.push(`本场只有 ${seats} 位选手`);
        return { state, events: [], trace: t };
      }
      seat = idx;
    }

    const current = state.points[seat] ?? 0;
    const nextScore = current + delta;
    if (nextScore < 0) {
      const t = trace('扣分后比分不能为负', 'ILLEGAL');
      t.reasons.push(`当前 ${current} 分，尝试 ${delta}`);
      return { state, events: [], trace: t };
    }

    const events: MatchEvent[] = [
      makeEvent('SCORE_ADDED', {
        playerIndex: seat,
        points: delta,
        reason: 'manual',
        continues: true,
      }),
    ];

    let frameStatus = state.frameStatus;
    let winReason = state.winReason;
    let winnerPlayerIndex = state.winnerPlayerIndex;
    if (nextScore >= rules.targetPoints) {
      winReason = `先达到 ${rules.targetPoints} 分`;
      frameStatus = 'WON';
      winnerPlayerIndex = seat;
      events.push(
        makeEvent('FRAME_WON', {
          frame: 0,
          winnerPlayerIndex: seat,
          winnerPlayerId: ctx.players[seat]?.playerId ?? null,
          reason: 'points-target',
          winReason,
        }),
      );
    }

    const signed = delta > 0 ? `+${delta}` : String(delta);
    const t = trace(
      frameStatus === 'WON' ? `${signed}，达到目标分，本局获胜` : `${signed}，当前 ${nextScore} 分`,
      'LEGAL',
    );
    t.events = events.map((e) => e.type);

    return {
      state: {
        ...state,
        points: { ...state.points, [seat]: nextScore },
        scoreLog: [
          ...state.scoreLog,
          {
            playerIndex: seat,
            points: delta,
            turnNumber: state.turnNumber,
            source: 'manual',
          },
        ],
        // 与 SCORE 一致：一次得分动作算一次连续得分（重放按 continues 还原）
        runCount: state.runCount + 1,
        frameStatus,
        winnerPlayerIndex,
        winReason,
      },
      events,
      trace: t,
    };
  }

  private onScore(
    state: FourBallState,
    command: MatchCommand,
    ctx: EngineContext,
    rules: FourBallRules,
    trace: (d: string, v: FourBallResult['trace']['validation']) => FourBallResult['trace'],
  ): FourBallResult {
    const payload = (command.payload ?? {}) as { points?: unknown; ball?: unknown };
    const seat = state.activePlayerIndex;

    let gain: number;
    if (typeof payload.points === 'number' && Number.isFinite(payload.points)) {
      gain = payload.points;
    } else {
      // 没给分值就用快捷档位 +1
      gain = rules.scoring.p1;
    }
    if (gain <= 0) {
      const t = trace(`无效分值 ${gain}`, 'ILLEGAL');
      t.reasons.push('四球加分必须为正数；未指定分值时使用 config.scoring.p1');
      return { state, events: [], trace: t };
    }

    const ball = typeof payload.ball === 'number' ? payload.ball : undefined;
    const record: ScoreRecord = {
      playerIndex: seat,
      points: gain,
      turnNumber: state.turnNumber,
      source: 'pot',
      ...(ball !== undefined ? { ball } : {}),
    };
    const points = { ...state.points, [seat]: (state.points[seat] ?? 0) + gain };
    const events: MatchEvent[] = [
      makeEvent('SCORE_ADDED', {
        playerIndex: seat,
        points: gain,
        continues: true,
        ...(ball !== undefined ? { ball } : {}),
      }),
    ];

    let frameStatus = state.frameStatus;
    let winReason: string | undefined;
    if ((points[seat] ?? 0) >= rules.targetPoints) {
      frameStatus = 'WON';
      winReason = `先达到 ${rules.targetPoints} 分`;
      events.push(
        makeEvent('FRAME_WON', {
          frame: 0,
          winnerPlayerIndex: seat,
          winnerPlayerId: ctx.players[seat]?.playerId ?? null,
          reason: 'points-target',
          winReason,
        }),
      );
    }

    const t = trace(
      frameStatus === 'WON' ? `本方 +${gain}，达到目标分，本局获胜` : `本方 +${gain}`,
      'LEGAL',
    );
    t.events = events.map((e) => e.type);
    return {
      state: {
        ...state,
        points,
        scoreLog: [...state.scoreLog, record],
        foul: NO_FOUL,
        runCount: state.runCount + 1,
        frameStatus,
        winnerPlayerIndex: frameStatus === 'WON' ? seat : state.winnerPlayerIndex,
        winReason: winReason ?? state.winReason,
      },
      events,
      trace: t,
    };
  }

  private onFoul(
    state: FourBallState,
    command: MatchCommand,
    ctx: EngineContext,
    rules: FourBallRules,
    trace: (d: string, v: FourBallResult['trace']['validation']) => FourBallResult['trace'],
  ): FourBallResult {
    const raw = String((command.payload ?? {}).reason ?? 'OTHER');
    const known: FoulReason[] = ['NO_CONTACT', 'SCRATCH', 'WRONG_BALL_FIRST', 'OTHER'];
    const reason = (known as string[]).includes(raw) ? (raw as FoulReason) : 'OTHER';

    const seat = state.activePlayerIndex;
    const nextSeat = this.opponentSeat(state);
    const events: MatchEvent[] = [makeEvent('FOUL', { reason, playerIndex: seat })];

    const penalty =
      rules.foul === 'none' ? 0 : rules.foul === 'opponent_plus_n' ? rules.foulPenalty : 1;

    let points = state.points;
    let scoreLog = state.scoreLog;
    let frameStatus = state.frameStatus;
    let winnerPlayerIndex = state.winnerPlayerIndex;
    let winReason = state.winReason;

    if (penalty > 0) {
      points = { ...points, [nextSeat]: (points[nextSeat] ?? 0) + penalty };
      scoreLog = [
        ...scoreLog,
        { playerIndex: nextSeat, points: penalty, turnNumber: state.turnNumber, source: 'foul' },
      ];
      events.push(
        makeEvent('SCORE_ADDED', { playerIndex: nextSeat, points: penalty, reason: 'foul' }),
      );
      if ((points[nextSeat] ?? 0) >= rules.targetPoints) {
        frameStatus = 'WON';
        winnerPlayerIndex = nextSeat;
        winReason = `对手犯规，先达到 ${rules.targetPoints} 分`;
        events.push(
          makeEvent('FRAME_WON', {
            frame: 0,
            winnerPlayerIndex: nextSeat,
            winnerPlayerId: ctx.players[nextSeat]?.playerId ?? null,
            reason: 'points-target',
            winReason,
          }),
        );
      }
    }

    if (rules.foulSwitchesTurn && frameStatus === 'PLAYING') {
      events.push(
        makeEvent('TURN_ENDED', {
          from: seat,
          to: nextSeat,
          turnNumber: state.turnNumber + 1,
        }),
      );
    }

    const t = trace(
      frameStatus === 'WON'
        ? (winReason ?? '本局结束')
        : `犯规（${reason}），对手 +${penalty}`,
      'ILLEGAL',
    );
    t.events = events.map((e) => e.type);
    return {
      state: {
        ...state,
        points,
        scoreLog,
        foul: foulOf(reason),
        runCount: 0,
        activePlayerIndex:
          rules.foulSwitchesTurn && frameStatus === 'PLAYING' ? nextSeat : seat,
        turnNumber:
          rules.foulSwitchesTurn && frameStatus === 'PLAYING' ? state.turnNumber + 1 : state.turnNumber,
        frameStatus,
        winnerPlayerIndex,
        winReason,
      },
      events,
      trace: t,
    };
  }

  private onEndTurn(
    state: FourBallState,
    trace: (d: string, v: FourBallResult['trace']['validation']) => FourBallResult['trace'],
  ): FourBallResult {
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
      },
      events: [
        makeEvent('TURN_ENDED', { from: seat, to: nextSeat, turnNumber: state.turnNumber + 1 }),
      ],
      trace: t,
    };
  }

  private onConcede(
    state: FourBallState,
    ctx: EngineContext,
    trace: (d: string, v: FourBallResult['trace']['validation']) => FourBallResult['trace'],
  ): FourBallResult {
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
    state: FourBallState,
    ctx: EngineContext,
    trace: (d: string, v: FourBallResult['trace']['validation']) => FourBallResult['trace'],
  ): FourBallResult {
    const t = trace('重新计分', 'LEGAL');
    t.events = ['RERACK'];
    return {
      state: this.startFrame(state, state.activePlayerIndex, ctx),
      events: [makeEvent('RERACK', { reason: 'manual' })],
      trace: t,
    };
  }

  private onCompleteFrame(
    state: FourBallState,
    command: MatchCommand,
    ctx: EngineContext,
    trace: (d: string, v: FourBallResult['trace']['validation']) => FourBallResult['trace'],
  ): FourBallResult {
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

  startFrame(_state: FourBallState, breakPlayerIndex: number, ctx: EngineContext): FourBallState {
    const seats = Math.max(2, ctx.players.length);
    const points: Record<number, number> = {};
    for (let i = 0; i < seats; i += 1) points[i] = 0;
    const breaker = breakPlayerIndex >= 0 && breakPlayerIndex < seats ? breakPlayerIndex : 0;
    return {
      activePlayerIndex: breaker,
      turnNumber: 1,
      points,
      scoreLog: [],
      foul: NO_FOUL,
      runCount: 0,
      frameStatus: 'PLAYING',
      winnerPlayerIndex: undefined,
      loserPlayerIndex: undefined,
      winReason: undefined,
    };
  }

  getScoreSummary(state: FourBallState): ScoreSummary {
    return {
      lines: Object.keys(state.points)
        .sort()
        .map((k) => ({
          playerId: null,
          label: `P${Number(k) + 1} 得分`,
          value: state.points[Number(k)] ?? 0,
        })),
    };
  }

  isFrameComplete(state: FourBallState): boolean {
    return state.frameStatus !== 'PLAYING';
  }

  isMatchComplete(_state: FourBallState): boolean {
    return false;
  }

  getWinner(state: FourBallState): string | null {
    return state.winnerPlayerIndex === undefined ? null : String(state.winnerPlayerIndex);
  }

  getStatistics(state: FourBallState): unknown {
    return {
      points: state.points,
      scoreLog: state.scoreLog,
      turnNumber: state.turnNumber,
      runCount: state.runCount,
    };
  }

  /** 本局分数快照，供排名总览跨局累计。 */
  getFrameScores(state: FourBallState): Record<number, number> | null {
    const values = Object.values(state.points ?? {});
    return values.some((v) => v !== 0) ? state.points : null;
  }
}

/** EventLog 重放。 */
export function applyFourBallEvent(state: FourBallState, event: MatchEvent): FourBallState {
  const p = event.payload as Record<string, unknown>;
  switch (event.type) {
    case 'SCORE_ADDED': {
      const playerIndex =
        typeof p.playerIndex === 'number' ? p.playerIndex : state.activePlayerIndex;
      const points = typeof p.points === 'number' ? p.points : 0;
      const source: ScoreRecord['source'] =
        p.reason === 'foul' ? 'foul' : p.reason === 'manual' ? 'manual' : 'pot';
      return {
        ...state,
        points: { ...state.points, [playerIndex]: (state.points[playerIndex] ?? 0) + points },
        runCount: p.continues === true ? state.runCount + 1 : 0,
        scoreLog: [
          ...state.scoreLog,
          {
            playerIndex,
            points,
            turnNumber: state.turnNumber,
            source,
            ...(typeof p.ball === 'number' ? { ball: p.ball } : {}),
          },
        ],
      };
    }
    case 'BALL_POTTED':
      return state;
    case 'BALL_MISSED':
      return state;
    case 'FOUL': {
      const raw = String(p.reason ?? 'OTHER') as FoulReason;
      return { ...state, foul: foulOf(raw), runCount: 0 };
    }
    case 'TURN_ENDED': {
      const to = typeof p.to === 'number' ? p.to : state.activePlayerIndex;
      return {
        ...state,
        activePlayerIndex: to,
        turnNumber: typeof p.turnNumber === 'number' ? p.turnNumber : state.turnNumber + 1,
        runCount: 0,
      };
    }
    case 'RERACK':
      return { ...state, points: Object.fromEntries(Object.keys(state.points).map((k) => [k, 0])), scoreLog: [], foul: NO_FOUL, runCount: 0, frameStatus: 'PLAYING', winnerPlayerIndex: undefined, loserPlayerIndex: undefined, winReason: undefined };
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

export function replayFourBallState(initial: FourBallState, events: MatchEvent[]): FourBallState {
  return events.reduce(applyFourBallEvent, initial);
}
