import type { EngineContext, EngineResult, GameEngine, ScoreSummary } from '../types';
import type { MatchCommand, MatchEvent } from '../../types';
import {
  CUE_BALL,
  NINE_BALL_FOUL_LABELS,
  NINE_BALL_NUMBERS,
  NINE_BALL_WIN,
  type BallStatus,
  type FoulReason,
  type FoulRecord,
  type NineBallRules,
  type NineBallState,
} from './types';
import { resolveNineBallRules } from './rules';
import { CHASE_RULES, chaseDeltas, chaseNet, type ChaseKind } from '../fourBall/chase';
import { createId } from '../../util/id';

export interface NineBallResult extends EngineResult<NineBallState> {
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
  for (const b of NINE_BALL_NUMBERS) out[b] = 'ON_TABLE';
  return out;
}

function makeEvent(
  type: MatchEvent['type'],
  payload: Record<string, unknown>,
): MatchEvent {
  return { id: createId('ev'), matchId: '', timestamp: 0, type, payload };
}

function foulOf(reason: FoulReason, ball?: number, detail?: string): FoulRecord {
  return {
    occurred: true,
    reason,
    ball,
    detail: detail ?? NINE_BALL_FOUL_LABELS[reason],
  };
}

/** 台面上最小号的球 —— 九球必须先碰它。 */
export function lowestBallOnTable(state: NineBallState): number | null {
  for (const b of NINE_BALL_NUMBERS) {
    if (state.balls[b] === 'ON_TABLE') return b;
  }
  return null;
}

/**
 * NineBallEngine —— 九球规则的唯一事实来源。
 *
 * 纯函数，与八球同一套契约。核心差别：
 *   - 没有「分组」概念，取而代之的是**必须按号序击打**（先碰台面最小号球）
 *   - 合法打进 9 号球即赢本局（开球打进 9 号也算，走 config.nineOnBreak）
 *   - 非法打进 9 号球要重新摆回台面，而不是判负
 *   - 犯规后对手获得自由球
 */
export class NineBallEngine implements GameEngine<NineBallState> {
  readonly gameType = 'nine-ball' as const;

  createInitialState(ctx: EngineContext): NineBallState {
    const seats = Math.max(1, ctx.players.length);
    const consecutiveFouls: Record<number, number> = {};
    const points: Record<number, number> = {};
    for (let i = 0; i < seats; i += 1) {
      consecutiveFouls[i] = 0;
      points[i] = 0;
    }
    return {
      balls: initialBalls(),
      activePlayerIndex: 0,
      turnNumber: 1,
      break: { completed: false, shotTaken: false, playerIndex: 0 },
      pushOut: { available: false, used: false },
      foul: NO_FOUL,
      points,
      consecutiveFouls,
      ballInHand: false,
      potted: [],
      runCount: 0,
      frameStatus: 'PLAYING',
    };
  }

  private rulesOf(ctx: EngineContext): NineBallRules {
    return resolveNineBallRules(ctx.ruleSet.config);
  }

  private opponentSeat(state: NineBallState): number {
    const seats = Object.keys(state.consecutiveFouls).length || 2;
    return (state.activePlayerIndex + 1) % Math.max(1, seats);
  }

  private markBreakShotTaken(state: NineBallState): NineBallState['break'] {
    return state.break.completed ? { ...state.break, shotTaken: true } : state.break;
  }

  reduce(state: NineBallState, command: MatchCommand, ctx: EngineContext): NineBallResult {
    const rules = this.rulesOf(ctx);
    const seat = state.activePlayerIndex;

    const trace = (
      decision: string,
      validation: NineBallResult['trace']['validation'],
    ): NineBallResult['trace'] => ({
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
        return this.onBallPotted(state, command, ctx, rules, trace);
      case 'BALL_MISSED':
        return this.onBallMissed(state, rules, trace);
      case 'FOUL':
        return this.onFoul(state, command, ctx, rules, trace);
      case 'ADJUST_SCORE':
        return this.onAdjustScore(state, command, ctx, rules, trace);
      case 'CHASE_SCORED':
        return this.onChase(state, command, ctx, trace);
      case 'END_TURN':
        return this.onEndTurn(state, trace);
      case 'PUSH_OUT':
        return this.onPushOut(state, rules, trace);
      case 'CONCEDE':
        return this.onConcede(state, ctx, trace);
      case 'RERACK':
        return this.onRerack(state, trace);
      case 'COMPLETE_FRAME':
        return this.onCompleteFrame(state, command, ctx, trace);
      default:
        return { state, events: [], trace: trace('非九球指令', 'IGNORED') };
    }
  }

  // ---------------------------------------------------------------- break ---
  private onBreak(
    state: NineBallState,
    trace: (d: string, v: NineBallResult['trace']['validation']) => NineBallResult['trace'],
  ): NineBallResult {
    if (state.break.completed) {
      const t = trace('本局已开球，忽略重复开球', 'IGNORED');
      t.reasons.push('break.completed=true');
      return { state, events: [], trace: t };
    }
    const t = trace('开球', 'LEGAL');
    t.events = ['BREAK_STARTED'];
    return {
      state: {
        ...state,
        break: {
          completed: true,
          shotTaken: false,
          playerIndex: state.activePlayerIndex,
        },
        // 开球之后的第一杆才可以使用 Push Out。
        pushOut: { available: true, used: false },
      },
      events: [
        makeEvent('BREAK_STARTED', { playerIndex: state.activePlayerIndex }),
      ],
      trace: t,
    };
  }

  // ---------------------------------------------------------------- score ---
  /**
   * 追分结算：按规则表在座位之间转移分值。
   *
   * 九球的追分与四球用的是同一张规则表（普胜 / 小金 / 大金 / 黄金九 / 黑金），
   * 因为台球厅里「追分」本身就是跨球种的玩法，分值不随球种变。
   * 规则表只维护一份，放在 `fourBall/chase.ts`。
   *
   * 关键点：
   *  - 结算恒为零和：本家赢多少，上家/下家就输多少
   *  - 一次结算可能改动三个座位，但只占一步撤销（同一条命令）
   *  - **不判胜负**：追分没有目标分，收场由用户点「结束比赛」决定
   */
  private onChase(
    state: NineBallState,
    command: MatchCommand,
    ctx: EngineContext,
    trace: (d: string, v: NineBallResult['trace']['validation']) => NineBallResult['trace'],
  ): NineBallResult {
    const raw = (command.payload ?? {}) as { kind?: unknown; playerIndex?: unknown };
    const kind = String(raw.kind ?? '') as ChaseKind;
    const rule = CHASE_RULES[kind];
    if (!rule) {
      const t = trace(`未知的得分类型 ${String(raw.kind)}`, 'ILLEGAL');
      t.reasons.push(`可选：${Object.keys(CHASE_RULES).join(' / ')}`);
      return { state, events: [], trace: t };
    }

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

    const deltas = chaseDeltas(kind, seat, seats);
    const points = { ...state.points };
    const events: MatchEvent[] = [];

    for (const key of Object.keys(deltas).sort((a, b) => Number(a) - Number(b))) {
      const s = Number(key);
      const delta = deltas[s] ?? 0;
      if (!delta) continue;
      points[s] = (points[s] ?? 0) + delta;
      events.push(
        makeEvent('SCORE_ADDED', {
          playerIndex: s,
          points: delta,
          reason: 'chase',
          chaseKind: kind,
          // 只有本家那一条算「一次得分」，否则重放会把一次结算数成三次
          ...(s === seat ? { continues: true } : {}),
        }),
      );
    }

    const net = chaseNet(kind);
    const t = trace(
      `${rule.label}（${rule.condition}）：本家 ${net > 0 ? '+' : ''}${net}`,
      'LEGAL',
    );
    t.events = events.map((e) => e.type);

    return {
      state: { ...state, points, runCount: state.runCount + 1 },
      events,
      trace: t,
    };
  }

  /**
   * 人工加减分（记分制）。
   *
   * 这是台球厅记分的核心动作：进一颗球点一次 +1，记错了点一次 -1 改回来。
   * 标准清台模式（scoringMode='sequence'）下没有分数概念，直接忽略 ——
   * 不能悄悄把两种语义混在一起。
   */
  private onAdjustScore(
    state: NineBallState,
    command: MatchCommand,
    ctx: EngineContext,
    rules: NineBallRules,
    trace: (d: string, v: NineBallResult['trace']['validation']) => NineBallResult['trace'],
  ): NineBallResult {
    if (rules.scoringMode !== 'points') {
      const t = trace('当前是「按号序清台」规则，没有分数可调', 'IGNORED');
      t.reasons.push('scoringMode=sequence');
      return { state, events: [], trace: t };
    }

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
    // 追分场面上负分是常态（黑金倒赔），所以只拦「从非负直接拉负」的误操作，
    // 不拦「已经很负了继续被扣」。
    if (nextScore < 0 && current >= 0) {
      const t = trace('扣分后比分不能为负', 'ILLEGAL');
      t.reasons.push(`当前 ${current} 分，尝试 ${delta}`);
      return { state, events: [], trace: t };
    }

    const events: MatchEvent[] = [
      makeEvent('SCORE_ADDED', { playerIndex: seat, points: delta, reason: 'manual' }),
    ];

    let frameStatus = state.frameStatus;
    let winReason = state.winReason;
    let winnerPlayerIndex = state.winnerPlayerIndex;
    if (rules.targetPoints > 0 && nextScore >= rules.targetPoints) {
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
        frameStatus,
        winnerPlayerIndex,
        winReason,
      },
      events,
      trace: t,
    };
  }

  // -------------------------------------------------------------- potting ---
  private onBallPotted(
    state: NineBallState,
    command: MatchCommand,
    ctx: EngineContext,
    rules: NineBallRules,
    trace: (d: string, v: NineBallResult['trace']['validation']) => NineBallResult['trace'],
  ): NineBallResult {
    const payload = (command.payload ?? {}) as {
      ball?: unknown;
      scratch?: unknown;
      firstContact?: unknown;
    };
    const ball = Number(payload.ball);
    const seat = state.activePlayerIndex;

    if (!Number.isInteger(ball) || (ball !== CUE_BALL && !NINE_BALL_NUMBERS.includes(ball))) {
      const t = trace(`非法球号 ${String(payload.ball)}`, 'ILLEGAL');
      t.reasons.push('九球只有 1–9 号（母球为 0）');
      return { state, events: [], trace: t };
    }
    if (ball !== CUE_BALL && state.balls[ball] === 'POCKETED') {
      const t = trace(`${ball} 号球已不在台上`, 'ILLEGAL');
      t.reasons.push('重复进球被拒绝');
      return { state, events: [], trace: t };
    }

    const scratch = ball === CUE_BALL || payload.scratch === true;
    const firstContact =
      typeof payload.firstContact === 'number' ? payload.firstContact : undefined;
    const lowest = lowestBallOnTable(state);

    // --- 先碰球校验：九球必须先碰台面最小号球 -----------------------------
    const wrongFirst = firstContact !== undefined && lowest !== null && firstContact !== lowest;

    // --- 母球落袋 ---------------------------------------------------------
    if (scratch) {
      return this.foulSwitch(state, ctx, rules, foulOf('SCRATCH', ball), trace, {
        pottedBall: null,
      });
    }

    if (wrongFirst) {
      const foul = foulOf(
        'WRONG_BALL_FIRST',
        ball,
        `先碰到 ${firstContact} 号，应先碰 ${lowest} 号`,
      );
      return this.foulSwitch(state, ctx, rules, foul, trace, { pottedBall: ball });
    }

    // --- 合法进球 ---------------------------------------------------------
    const balls = { ...state.balls, [ball]: 'POCKETED' as const };
    // 合法进球后继续击球；重放靠这个字段还原 runCount。
    const continues = true;
    const events: MatchEvent[] = [
      makeEvent('BALL_POTTED', {
        ball,
        playerIndex: seat,
        legal: true,
        turnNumber: state.turnNumber,
        continues,
      }),
    ];

    // 打进 9 号球 → 本局结束
    if (ball === NINE_BALL_WIN) {
      const onBreak = state.break.completed && !state.break.shotTaken;
      if (onBreak && !rules.nineOnBreak) {
        // 该规则集不认开球金：9 号球摆回，继续打
        const t = trace('开球打进 9 号，按规则集重新摆回', 'LEGAL');
        t.reasons.push('config.nineOnBreak = false');
        t.events = ['BALL_POTTED', 'RERACK'];
        return {
          state: {
            ...state,
            balls: initialBalls(),
            break: this.markBreakShotTaken(state),
            pushOut: { ...state.pushOut, available: false },
          },
          events: [...events, makeEvent('RERACK', { reason: 'nine-on-break' })],
          trace: t,
        };
      }
      const reason = onBreak ? 'nine-on-break' : 'nine-ball';
      const winReason = onBreak ? '开球打进 9 号球' : '合法打进 9 号球';
      const t = trace(winReason, 'LEGAL');
      t.events = ['BALL_POTTED', 'FRAME_WON'];
      return {
        state: {
          ...state,
          balls,
          potted: [
            ...state.potted,
            { ball, playerIndex: seat, legal: true, turnNumber: state.turnNumber },
          ],
          frameStatus: 'WON',
          winnerPlayerIndex: seat,
          winReason,
          foul: NO_FOUL,
          break: this.markBreakShotTaken(state),
        },
        events: [
          ...events,
          makeEvent('FRAME_WON', {
            frame: 0,
            winnerPlayerIndex: seat,
            winnerPlayerId: ctx.players[seat]?.playerId ?? null,
            reason,
            winReason,
          }),
        ],
        trace: t,
      };
    }

    // 普通合法进球 → 继续击球
    const t = trace('合法进球，继续击球', 'LEGAL');
    t.events = events.map((e) => e.type);
    return {
      state: {
        ...state,
        balls,
        potted: [
          ...state.potted,
          { ball, playerIndex: seat, legal: true, turnNumber: state.turnNumber },
        ],
        foul: NO_FOUL,
        consecutiveFouls: { ...state.consecutiveFouls, [seat]: 0 },
        ballInHand: false,
        runCount: state.runCount + 1,
        break: this.markBreakShotTaken(state),
        // Push Out 只在开球后第一杆可用；这一杆打完就不再有 Push Out。
        pushOut: { available: false, used: state.pushOut.used },
      },
      events,
      trace: t,
    };
  }

  // ---------------------------------------------------------------- foul ---
  private onBallMissed(
    state: NineBallState,
    rules: NineBallRules,
    trace: (d: string, v: NineBallResult['trace']['validation']) => NineBallResult['trace'],
  ): NineBallResult {
    const seat = state.activePlayerIndex;
    const events = [
      makeEvent('BALL_MISSED', { playerIndex: seat }),
      makeEvent('FOUL', { reason: 'NO_CONTACT', playerIndex: seat }),
    ];
    const nextSeat = this.opponentSeat(state);
    const consecutive = (state.consecutiveFouls[seat] ?? 0) + 1;
    const t = trace('空杆，判犯规并换手', 'ILLEGAL');
    t.reasons.push('母球未碰到任何球');
    t.events = ['BALL_MISSED', 'FOUL', 'TURN_ENDED'];
    return {
      state: {
        ...state,
        foul: foulOf('NO_CONTACT'),
        consecutiveFouls: { ...state.consecutiveFouls, [seat]: consecutive },
        ballInHand: rules.ballInHandOnFoul,
        activePlayerIndex: nextSeat,
        turnNumber: state.turnNumber + 1,
        runCount: 0,
        break: this.markBreakShotTaken(state),
        pushOut: { available: false, used: state.pushOut.used },
      },
      events: [
        ...events,
        makeEvent('TURN_ENDED', { from: seat, to: nextSeat, turnNumber: state.turnNumber + 1 }),
      ],
      trace: t,
    };
  }

  private onFoul(
    state: NineBallState,
    command: MatchCommand,
    ctx: EngineContext,
    rules: NineBallRules,
    trace: (d: string, v: NineBallResult['trace']['validation']) => NineBallResult['trace'],
  ): NineBallResult {
    const raw = String((command.payload ?? {}).reason ?? 'OTHER');
    const known: FoulReason[] = [
      'WRONG_BALL_FIRST',
      'NO_CONTACT',
      'SCRATCH',
      'NO_RAIL',
      'OTHER',
    ];
    const reason = (known as string[]).includes(raw) ? (raw as FoulReason) : 'OTHER';
    return this.foulSwitch(state, ctx, rules, foulOf(reason), trace, {});
  }

  /** 犯规 → 换手 → 连续犯规计数 → 可能判负本局。 */
  private foulSwitch(
    state: NineBallState,
    ctx: EngineContext,
    rules: NineBallRules,
    foul: FoulRecord,
    trace: (d: string, v: NineBallResult['trace']['validation']) => NineBallResult['trace'],
    opts: { pottedBall?: number | null },
  ): NineBallResult {
    const seat = state.activePlayerIndex;
    const nextSeat = this.opponentSeat(state);
    const consecutive = (state.consecutiveFouls[seat] ?? 0) + 1;

    const t = trace(`犯规（${foul.reason}）并换手`, 'ILLEGAL');
    t.reasons.push(foul.detail ?? foul.reason ?? '');

    const events: MatchEvent[] = [makeEvent('FOUL', { reason: foul.reason, playerIndex: seat })];

    const pottedBall =
      opts.pottedBall !== undefined && opts.pottedBall !== null ? opts.pottedBall : null;

    // 非法打进 9 号球 → 9 号球摆回台面（不是判负）
    let balls = state.balls;
    if (pottedBall === NINE_BALL_WIN) {
      balls = { ...state.balls, [NINE_BALL_WIN]: 'ON_TABLE' as const };
      events.push(makeEvent('RERACK', { reason: 'illegal-nine-ball' }));
      t.reasons.push('非法打进 9 号球，重新摆回台面');
    } else if (pottedBall !== null) {
      // 其余球进袋即留在袋中（九球不把对方球摆回）
      balls = { ...state.balls, [pottedBall]: 'POCKETED' as const };
      events.push(
        makeEvent('BALL_POTTED', {
          ball: pottedBall,
          playerIndex: seat,
          legal: false,
          turnNumber: state.turnNumber,
        }),
      );
    }

    events.push(
      makeEvent('TURN_ENDED', { from: seat, to: nextSeat, turnNumber: state.turnNumber + 1 }),
    );

    const base: NineBallState = {
      ...state,
      balls,
      foul,
      consecutiveFouls: { ...state.consecutiveFouls, [seat]: consecutive },
      ballInHand: rules.ballInHandOnFoul,
      activePlayerIndex: nextSeat,
      turnNumber: state.turnNumber + 1,
      runCount: 0,
      break: this.markBreakShotTaken(state),
      pushOut: { available: false, used: state.pushOut.used },
    };

    // 连续三次犯规 → 判负本局
    if (rules.threeFoulsLosesFrame && consecutive >= 3) {
      events.push(
        makeEvent('FRAME_LOST', {
          frame: 0,
          loserPlayerIndex: seat,
          winnerPlayerIndex: nextSeat,
          winnerPlayerId: ctx.players[nextSeat]?.playerId ?? null,
          reason: 'three-consecutive-fouls',
          winReason: '连续三次犯规',
        }),
      );
      t.events = events.map((e) => e.type);
      return {
        state: {
          ...base,
          frameStatus: 'LOST',
          loserPlayerIndex: seat,
          winnerPlayerIndex: nextSeat,
          winReason: '连续三次犯规',
        },
        events,
        trace: t,
      };
    }

    t.events = events.map((e) => e.type);
    return { state: base, events, trace: t };
  }

  // -------------------------------------------------------------- push out --
  private onPushOut(
    state: NineBallState,
    rules: NineBallRules,
    trace: (d: string, v: NineBallResult['trace']['validation']) => NineBallResult['trace'],
  ): NineBallResult {
    const seat = state.activePlayerIndex;
    if (!rules.pushOut) {
      const t = trace('本规则集未启用 Push Out，忽略', 'IGNORED');
      t.reasons.push('config.pushOut = false');
      return { state, events: [], trace: t };
    }
    if (!state.pushOut.available || state.pushOut.used) {
      const t = trace('Push Out 只在开球后第一杆可用一次', 'IGNORED');
      return { state, events: [], trace: t };
    }
    const nextSeat = this.opponentSeat(state);
    const t = trace('声明 Push Out，由对手决定是否接手', 'LEGAL');
    t.events = ['ENGINE_EVENT', 'TURN_ENDED'];
    return {
      state: {
        ...state,
        pushOut: { available: false, used: true },
        activePlayerIndex: nextSeat,
        turnNumber: state.turnNumber + 1,
        runCount: 0,
        break: this.markBreakShotTaken(state),
      },
      events: [
        makeEvent('ENGINE_EVENT', { action: 'push-out', playerIndex: seat }),
        makeEvent('TURN_ENDED', {
          from: seat,
          to: nextSeat,
          turnNumber: state.turnNumber + 1,
        }),
      ],
      trace: t,
    };
  }

  // ------------------------------------------------------------- turn/misc --
  private onEndTurn(
    state: NineBallState,
    trace: (d: string, v: NineBallResult['trace']['validation']) => NineBallResult['trace'],
  ): NineBallResult {
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
        pushOut: { available: false, used: state.pushOut.used },
      },
      events: [
        makeEvent('TURN_ENDED', { from: seat, to: nextSeat, turnNumber: state.turnNumber + 1 }),
      ],
      trace: t,
    };
  }

  private onConcede(
    state: NineBallState,
    ctx: EngineContext,
    trace: (d: string, v: NineBallResult['trace']['validation']) => NineBallResult['trace'],
  ): NineBallResult {
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
    state: NineBallState,
    trace: (d: string, v: NineBallResult['trace']['validation']) => NineBallResult['trace'],
  ): NineBallResult {
    const t = trace('重新摆球', 'LEGAL');
    t.events = ['RERACK'];
    return {
      state: this.startFrame(state, state.activePlayerIndex, {
        matchId: '',
        gameType: 'nine-ball',
        players: [],
        ruleSet: {} as never,
        target: 0,
        matchFormat: 'singles',
      }),
      events: [makeEvent('RERACK', { reason: 'manual' })],
      trace: t,
    };
  }

  private onCompleteFrame(
    state: NineBallState,
    command: MatchCommand,
    ctx: EngineContext,
    trace: (d: string, v: NineBallResult['trace']['validation']) => NineBallResult['trace'],
  ): NineBallResult {
    const payload = (command.payload ?? {}) as { winnerPlayerIndex?: unknown };
    const declared = Number(payload.winnerPlayerIndex);
    const hasDeclared = Number.isInteger(declared) && declared >= 0;
    if (hasDeclared && declared >= ctx.players.length) {
      const t = trace(`无效的胜方席位 ${declared}`, 'ILLEGAL');
      t.reasons.push(`本场只有 ${ctx.players.length} 位选手`);
      return { state, events: [], trace: t };
    }
    const winner = hasDeclared ? declared : state.activePlayerIndex;
    const winReason = hasDeclared ? `裁判判定第 ${winner + 1} 位选手获胜` : '裁判判定当前击球方获胜';
    const reason = hasDeclared ? 'referee' : 'manual';
    const t = trace(winReason, 'LEGAL');
    t.events = ['FRAME_WON'];
    return {
      state: { ...state, frameStatus: 'WON', winnerPlayerIndex: winner, winReason },
      events: [
        makeEvent('FRAME_WON', {
          frame: 0,
          winnerPlayerIndex: winner,
          winnerPlayerId: ctx.players[winner]?.playerId ?? null,
          reason,
          winReason,
        }),
      ],
      trace: t,
    };
  }

  // ------------------------------------------------------------- contract ---
  startFrame(_state: NineBallState, breakPlayerIndex: number, ctx: EngineContext): NineBallState {
    const seats = Math.max(2, ctx.players.length);
    const consecutiveFouls: Record<number, number> = {};
    const points: Record<number, number> = {};
    /**
     * 追分是整场累计：记分制 + 没有目标分（targetPoints=0）时，
     * 新局要接着上一局的分数走，否则每次「赢一局」都会把追分成绩清零。
     * 普通记分制（有目标分）仍然每局从 0 开始。
     */
    const rules = this.rulesOf(ctx);
    const carryOver = rules.scoringMode === 'points' && rules.targetPoints === 0;
    for (let i = 0; i < seats; i += 1) {
      consecutiveFouls[i] = 0;
      points[i] = carryOver ? (_state.points[i] ?? 0) : 0;
    }
    const breaker = breakPlayerIndex >= 0 && breakPlayerIndex < seats ? breakPlayerIndex : 0;
    return {
      balls: initialBalls(),
      activePlayerIndex: breaker,
      turnNumber: 1,
      break: { completed: false, shotTaken: false, playerIndex: breaker },
      pushOut: { available: false, used: false },
      foul: NO_FOUL,
      points,
      consecutiveFouls,
      ballInHand: false,
      potted: [],
      runCount: 0,
      frameStatus: 'PLAYING',
      winnerPlayerIndex: undefined,
      loserPlayerIndex: undefined,
      winReason: undefined,
    };
  }

  getScoreSummary(state: NineBallState): ScoreSummary {
    const lowest = lowestBallOnTable(state);
    const left = NINE_BALL_NUMBERS.filter((b) => state.balls[b] === 'ON_TABLE');
    return {
      lines: [
        { playerId: null, label: '当前目标球', value: lowest === null ? '—' : String(lowest) },
        { playerId: null, label: '台面剩余', value: left.length },
      ],
      note: state.ballInHand ? '自由球（Ball in hand）' : undefined,
    };
  }

  isFrameComplete(state: NineBallState): boolean {
    return state.frameStatus !== 'PLAYING';
  }

  /** 整场是否结束由 Match 层（Race To 局数）决定，引擎不重复聚合。 */
  isMatchComplete(_state: NineBallState): boolean {
    return false;
  }

  getWinner(state: NineBallState): string | null {
    return state.winnerPlayerIndex === undefined ? null : String(state.winnerPlayerIndex);
  }

  getStatistics(state: NineBallState): unknown {
    return {
      potted: state.potted,
      turnNumber: state.turnNumber,
      runCount: state.runCount,
      lowestBall: lowestBallOnTable(state),
      remaining: NINE_BALL_NUMBERS.filter((b) => state.balls[b] === 'ON_TABLE'),
      ballInHand: state.ballInHand,
      consecutiveFouls: state.consecutiveFouls,
    };
  }

  /** 记分制才有分数；清台模式恒 0 → 返回 null，避免排名里出现一堆 0 分。 */
  getFrameScores(state: NineBallState): Record<number, number> | null {
    const values = Object.values(state.points ?? {});
    return values.some((v) => v !== 0) ? state.points : null;
  }
}

/** 把一条事实事件应用到状态上，用于 EventLog 重放。 */
export function applyNineBallEvent(
  state: NineBallState,
  event: MatchEvent,
): NineBallState {
  const p = event.payload as Record<string, unknown>;
  switch (event.type) {
    case 'BREAK_STARTED': {
      const playerIndex =
        typeof p.playerIndex === 'number' ? p.playerIndex : state.activePlayerIndex;
      return {
        ...state,
        break: { completed: true, shotTaken: false, playerIndex },
        pushOut: { available: true, used: false },
      };
    }
    case 'BALL_POTTED': {
      const ball = Number(p.ball);
      if (!Number.isInteger(ball)) return state;
      const legal = p.legal !== false;
      const seat =
        typeof p.playerIndex === 'number' ? p.playerIndex : state.activePlayerIndex;
      const continues = p.continues === true;
      const next: NineBallState = {
        ...state,
        balls: { ...state.balls, [ball]: 'POCKETED' as const },
        potted: [
          ...state.potted,
          {
            ball,
            playerIndex: seat,
            legal,
            turnNumber: typeof p.turnNumber === 'number' ? p.turnNumber : state.turnNumber,
          },
        ],
        foul: legal ? NO_FOUL : state.foul,
        break: state.break.completed ? { ...state.break, shotTaken: true } : state.break,
        // 合法击球会清掉连续犯规计数（与 reduce 一致）
        consecutiveFouls: legal
          ? { ...state.consecutiveFouls, [seat]: 0 }
          : state.consecutiveFouls,
        runCount: continues ? state.runCount + 1 : state.runCount,
        // 任何一次击球之后都不再有 Push Out 机会
        pushOut: { available: false, used: state.pushOut.used },
      };
      return next;
    }
    case 'SCORE_ADDED': {
      const playerIndex =
        typeof p.playerIndex === 'number' ? p.playerIndex : state.activePlayerIndex;
      const delta = typeof p.points === 'number' ? p.points : 0;
      const next = (state.points[playerIndex] ?? 0) + delta;
      return {
        ...state,
        // 追分允许负分（黑金倒赔），不能再钳到 0，否则重放与实时不一致
        points: { ...state.points, [playerIndex]: next },
        // 追分本家那条带 continues，重放同样要算一次击球
        runCount: p.continues === true ? state.runCount + 1 : state.runCount,
      };
    }
    case 'BALL_MISSED':
      return state;
    case 'FOUL': {
      const seat = typeof p.playerIndex === 'number' ? p.playerIndex : state.activePlayerIndex;
      const raw = String(p.reason ?? 'OTHER') as FoulReason;
      return {
        ...state,
        foul: foulOf(raw),
        consecutiveFouls: {
          ...state.consecutiveFouls,
          [seat]: (state.consecutiveFouls[seat] ?? 0) + 1,
        },
      };
    }
    case 'TURN_ENDED': {
      const to = typeof p.to === 'number' ? p.to : state.activePlayerIndex;
      return {
        ...state,
        activePlayerIndex: to,
        turnNumber: typeof p.turnNumber === 'number' ? p.turnNumber : state.turnNumber + 1,
        runCount: 0,
        break: state.break.completed ? { ...state.break, shotTaken: true } : state.break,
        pushOut: { available: false, used: state.pushOut.used },
      };
    }
    case 'RERACK': {
      const reason = typeof p.reason === 'string' ? p.reason : '';
      if (reason === 'illegal-nine-ball') {
        // 只把 9 号球摆回台面
        return { ...state, balls: { ...state.balls, [NINE_BALL_WIN]: 'ON_TABLE' as const } };
      }
      return {
        ...state,
        balls: initialBalls(),
        break: {
          completed: false,
          shotTaken: false,
          playerIndex: state.activePlayerIndex,
        },
        pushOut: { available: false, used: false },
        foul: NO_FOUL,
        potted: [],
        runCount: 0,
        // 重摆本局 = 比分归零
        points: Object.fromEntries(Object.keys(state.points).map((k) => [k, 0])),
        frameStatus: 'PLAYING',
        winnerPlayerIndex: undefined,
        loserPlayerIndex: undefined,
        winReason: undefined,
      };
    }
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
          : (loser + 1) % (Object.keys(state.consecutiveFouls).length || 2);
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
    case 'ENGINE_EVENT': {
      if (String(p.action ?? '') === 'push-out') {
        return { ...state, pushOut: { available: false, used: true } };
      }
      return state;
    }
    case 'CONCEDE':
      return state;
    default:
      return state;
  }
}

export function replayNineBallState(
  initial: NineBallState,
  events: MatchEvent[],
): NineBallState {
  return events.reduce(applyNineBallEvent, initial);
}
