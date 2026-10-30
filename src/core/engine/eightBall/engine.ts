import type { EngineContext, EngineResult, GameEngine, ScoreSummary } from '../types';
import type { MatchCommand, MatchEvent, MatchPlayer } from '../../types';
import type {
  BallGroup,
  EightBallRules,
  EightBallState,
  FoulReason,
  FoulRecord,
} from './types';
import { CUE_BALL, EIGHT_BALL, OBJECT_BALLS, SOLIDS, STRIPES } from './types';
import {
  ballsOfGroup,
  getBallGroup,
  getLegalTargetBalls,
  isEightBall,
  isObjectBall,
  oppositeGroup,
  remainingInGroup,
  syncTableStatus,
} from './balls';
import { resolveEightBallRules } from './rules';
import type { RuleTrace } from './trace';
import { createId } from '../../util/id';

/** EngineResult + the explainability record (never persisted into state). */
export interface EightBallResult extends EngineResult<EightBallState> {
  trace: RuleTrace;
}

function initialBalls(): Record<number, 'ON_TABLE' | 'POCKETED'> {
  const out: Record<number, 'ON_TABLE' | 'POCKETED'> = { [CUE_BALL]: 'ON_TABLE' };
  for (const b of OBJECT_BALLS) out[b] = 'ON_TABLE';
  return out;
}

function makeEvent(
  type: MatchEvent['type'],
  payload: Record<string, unknown>,
  eventId: string,
): MatchEvent {
  // matchId/timestamp are filled in by the service layer, which owns the match.
  return { id: eventId, matchId: '', timestamp: 0, type, payload };
}

const FOUL_LABELS: Record<FoulReason, string> = {
  WRONG_BALL_FIRST: '先碰到非本方目标球',
  NO_CONTACT: '空杆（母球未碰到任何球）',
  SCRATCH: '母球落袋',
  ILLEGAL_EIGHT_BALL: '非法击打 8 号球',
  ILLEGAL_BREAK: '开球不合法',
  OTHER: '犯规',
};

function foulOf(reason: FoulReason, ball?: number, detail?: string): FoulRecord {
  return { occurred: true, reason, ball, detail: detail ?? FOUL_LABELS[reason] };
}

const NO_FOUL: FoulRecord = { occurred: false };

/**
 * EightBallEngine —— 中式八球规则的唯一事实来源。
 *
 * 纯函数：`reduce(state, command, ctx)` 返回新状态 + 事件 + 判定轨迹。
 * 不碰存储、不碰 DOM、不碰 React，因此浏览器、测试、将来的服务端都能跑同一份规则。
 *
 * 关键设计（PHASE 3A 第六条）：
 *   打进一颗球 **不是** score++。
 *   BALL_POTTED 会经过：当前球员 → 是否 OPEN → 是否已分组 → 是否合法目标
 *   → 是不是 8 号 → 是否犯规 → 是否继续击球 → 是否换手 → 是否产生胜负。
 *   局内没有"分数"这一概念，分数（局数）由 FRAME_WON 在 Match 层累加。
 */
export class EightBallEngine implements GameEngine<EightBallState> {
  readonly gameType = 'eight-ball' as const;

  createInitialState(ctx: EngineContext): EightBallState {
    const seats = Math.max(1, ctx.players.length);
    const groups: Record<number, BallGroup | null> = {};
    for (let i = 0; i < seats; i += 1) groups[i] = null;

    return {
      balls: initialBalls(),
      groups,
      tableStatus: 'OPEN',
      activePlayerIndex: 0,
      turnNumber: 1,
      break: { completed: false, shotTaken: false, legal: false, playerIndex: 0 },
      foul: NO_FOUL,
      potted: [],
      runCount: 0,
      frameStatus: 'PLAYING',
    };
  }

  private rulesOf(ctx: EngineContext): EightBallRules {
    return resolveEightBallRules(ctx.ruleSet.config);
  }

  reduce(
    state: EightBallState,
    command: MatchCommand,
    ctx: EngineContext,
  ): EightBallResult {
    const rules = this.rulesOf(ctx);
    const before = state.tableStatus;
    const seat = state.activePlayerIndex;

    const baseTrace = (decision: string, validation: RuleTrace['validation']): RuleTrace => ({
      command: command.type,
      playerIndex: seat,
      tableStatusBefore: before,
      tableStatusAfter: state.tableStatus,
      validation,
      decision,
      reasons: [],
      events: [],
    });

    // A decided frame accepts no further play commands; only a new frame resets it.
    if (state.frameStatus !== 'PLAYING') {
      const t = baseTrace('本局已结束，忽略击球指令', 'IGNORED');
      t.reasons.push(`frameStatus=${state.frameStatus}`);
      return { state, events: [], trace: t };
    }

    switch (command.type) {
      case 'BREAK_STARTED':
        return this.onBreak(state, ctx, rules, baseTrace);
      case 'BALL_POTTED':
        return this.onBallPotted(state, command, ctx, rules, baseTrace);
      case 'BALL_MISSED':
        return this.onBallMissed(state, command, ctx, baseTrace);
      case 'FOUL':
        return this.onFoul(state, command, ctx, baseTrace);
      case 'END_TURN':
        return this.onEndTurn(state, ctx, baseTrace);
      case 'CALL_SHOT':
        return this.onCallShot(state, command, rules, baseTrace);
      case 'CONCEDE':
        return this.onConcede(state, ctx, baseTrace);
      case 'RERACK':
        return this.onRerack(state, ctx, baseTrace);
      case 'COMPLETE_FRAME': {
        /*
         * 裁判声明本局结束。
         *
         * 这里要区分两类事实，不能混：
         *   1. 规则推导 —— 合法打进 8 号球 → 引擎自己产出 FRAME_WON/FRAME_LOST
         *   2. 裁判声明 —— 记分员看着这局打完了，直接记「谁赢」
         *
         * 第 2 类是外部事实，必须由调用方给出 winner；不给就退回「当前击球方」，
         * 但那是兜底，不是主路径。无论哪种，胜负事件仍然由引擎产出，
         * Service 与 UI 都不自己造 FRAME_WON。
         */
        const payload = (command.payload ?? {}) as { winnerPlayerIndex?: unknown };
        const declared = Number(payload.winnerPlayerIndex);
        const hasDeclared = Number.isInteger(declared) && declared >= 0;

        if (hasDeclared && declared >= ctx.players.length) {
          const t = baseTrace(`无效的胜方席位 ${declared}`, 'ILLEGAL');
          t.reasons.push(`本场只有 ${ctx.players.length} 位选手`);
          return { state, events: [], trace: t };
        }

        const winner = hasDeclared ? declared : state.activePlayerIndex;
        const reason = hasDeclared ? 'referee' : 'manual';
        const winReason = hasDeclared
          ? `裁判判定第 ${winner + 1} 位选手获胜`
          : '裁判判定当前击球方获胜';
        const trace = baseTrace(winReason, 'LEGAL');
        trace.reasons.push(
          hasDeclared ? 'COMPLETE_FRAME 携带裁判指定的胜方' : 'COMPLETE_FRAME 未指定胜方，退回当前击球方',
        );
        const events = [
          makeEvent(
          'FRAME_WON',
          {
            frame: 0,
            winnerPlayerIndex: winner,
            winnerPlayerId: ctx.players[winner]?.playerId ?? null,
            reason,
            winReason,
          },
          createId('ev'),
        ),
      ];
      trace.events = ['FRAME_WON'];
      return {
        state: { ...state, frameStatus: 'WON', winnerPlayerIndex: winner, winReason },
        events,
        trace,
      };
      }
      default:
        return { state, events: [], trace: baseTrace('非引擎指令', 'IGNORED') };
    }
  }

  // ---------------------------------------------------------------- break ---

  private onBreak(
    state: EightBallState,
    _ctx: EngineContext,
    rules: EightBallRules,
    baseTrace: (d: string, v: RuleTrace['validation']) => RuleTrace,
  ): EightBallResult {
    if (state.break.completed) {
      const t = baseTrace('本局已开球，忽略重复开球', 'IGNORED');
      t.reasons.push('break.completed=true');
      return { state, events: [], trace: t };
    }
    const trace = baseTrace('开球', 'LEGAL');
    trace.reasons.push(
      `开球要求：进球或 ≥${rules.breakRequiresPocketOrRailCount} 颗球碰库`,
    );
    const events = [
      makeEvent('BREAK_STARTED', { playerIndex: state.activePlayerIndex }, createId('ev')),
    ];
    trace.events = ['BREAK_STARTED'];
    return {
      state: {
        ...state,
        break: {
          completed: true,
          shotTaken: false,
          legal: true,
          playerIndex: state.activePlayerIndex,
        },
      },
      events,
      trace,
    };
  }

  // ------------------------------------------------------------- potting ---

  private onBallPotted(
    state: EightBallState,
    command: MatchCommand,
    ctx: EngineContext,
    rules: EightBallRules,
    baseTrace: (d: string, v: RuleTrace['validation']) => RuleTrace,
  ): EightBallResult {
    const payload = (command.payload ?? {}) as {
      ball?: unknown;
      scratch?: unknown;
      firstContact?: unknown;
      pocket?: unknown;
    };
    const ball = Number(payload.ball);
    const seat = state.activePlayerIndex;

    // --- structural validation (never mutate on garbage input) -------------
    if (!Number.isInteger(ball) || (ball !== CUE_BALL && !isObjectBall(ball))) {
      const t = baseTrace(`非法球号 ${String(payload.ball)}`, 'ILLEGAL');
      t.reasons.push('球号必须是 0（母球）或 1–15');
      return { state, events: [], trace: t };
    }
    if (ball !== CUE_BALL && state.balls[ball] === 'POCKETED') {
      const t = baseTrace(`${ball} 号球已不在台上`, 'ILLEGAL');
      t.reasons.push('重复进球被拒绝（球已 POCKETED）');
      return { state, events: [], trace: t };
    }

    const scratch = ball === CUE_BALL || payload.scratch === true;
    const firstContact =
      typeof payload.firstContact === 'number' ? payload.firstContact : undefined;

    // --- 8 号球：本阶段最重要的状态转换之一 --------------------------------
    if (isEightBall(ball)) {
      return this.onEightBallPotted(state, ctx, rules, scratch, baseTrace);
    }

    // --- 母球落袋：犯规，母球回到台面 --------------------------------------
    if (scratch) {
      const trace = baseTrace('母球落袋，判犯规并换手', 'ILLEGAL');
      trace.reasons.push('SCRATCH');
      const foul = foulOf('SCRATCH', ball);
      const nextSeat = this.opponentSeat(state);
      const events = [
        makeEvent('FOUL', { reason: 'SCRATCH', ball, playerIndex: seat }, createId('ev')),
        makeEvent(
          'TURN_ENDED',
          { from: seat, to: nextSeat, turnNumber: state.turnNumber + 1 },
          createId('ev'),
        ),
      ];
      trace.events = ['FOUL', 'TURN_ENDED'];
      return {
        state: {
          ...state,
          foul,
          break: this.markBreakShotTaken(state),
          activePlayerIndex: nextSeat,
          turnNumber: state.turnNumber + 1,
          runCount: 0,
        },
        events,
        trace,
      };
    }

    // --- 普通目标球 --------------------------------------------------------
    const group = getBallGroup(ball);
    const ownGroup = state.groups[seat] ?? null;
    const legalTargetsBefore = getLegalTargetBalls(state, seat);
    const reasonList: string[] = [];

    // 先碰球校验（如果调用方提供了 firsthand 信息）
    let wrongFirstContact = false;
    if (firstContact !== undefined && legalTargetsBefore.length > 0) {
      wrongFirstContact = !legalTargetsBefore.includes(firstContact);
      if (wrongFirstContact) {
        reasonList.push(`先碰到 ${firstContact} 号，不在合法目标内`);
      }
    }

    const isOpen = state.tableStatus === 'OPEN';
    const isOpponentGroup = ownGroup !== null && group === oppositeGroup(ownGroup);

    // 打进对方球：默认不是犯规，但本回合不继续、换手（地区差异走 config）
    const opponentBallFoul = isOpponentGroup && rules.opponentBallPocketedIsFoul;

    const fouled = wrongFirstContact || opponentBallFoul;
    const foul = fouled
      ? wrongFirstContact
        ? foulOf('WRONG_BALL_FIRST', ball)
        : foulOf('OTHER', ball, '打进对方球')
      : NO_FOUL;

    // 是否继续击球：合法进球 → 继续；犯规/打进对方球 → 换手。
    // 提前算出来，因为 BALL_POTTED 事件 payload 要带上它供重放还原 runCount。
    const continues = !fouled && !opponentBallFoul;

    // --- 结算球台 ---------------------------------------------------------
    const balls = { ...state.balls, [ball]: 'POCKETED' as const };
    const pottedRecord = {
      ball,
      playerIndex: seat,
      legal: !fouled,
      turnNumber: state.turnNumber,
    };

    let nextGroups = state.groups;
    const events: MatchEvent[] = [];

    events.push(
      makeEvent(
        'BALL_POTTED',
        {
          ball,
          playerIndex: seat,
          legal: !fouled,
          turnNumber: state.turnNumber,
          // 是否继续击球：重放要靠它还原 runCount（见 applyEightBallEvent）。
          continues,
          pocket: typeof payload.pocket === 'string' ? payload.pocket : undefined,
        },
        createId('ev'),
      ),
    );

    // 认组：仅 OPEN、且不是开球这一杆。
    // 开球进球不定组（多数地区做法），所以用 break.shotTaken 区分：
    //   break.completed=true 且 shotTaken=false → 开球这一杆
    const isBreakShot = state.break.completed && !state.break.shotTaken;
    if (isOpen && !isBreakShot) {
      const assigned = this.resolveAssignment(ball, seat, state);
      if (assigned) {
        nextGroups = { ...state.groups, [seat]: assigned.group };
        const other = this.opponentSeat(state);
        if (nextGroups[other] === null || nextGroups[other] === undefined) {
          nextGroups[other] = oppositeGroup(assigned.group);
        }
        events.push(
          makeEvent(
            'GROUPS_ASSIGNED',
            { playerIndex: seat, group: assigned.group },
            createId('ev'),
          ),
        );
        reasonList.push(`认组 ${assigned.group}`);
      }
    }

    const afterGroups = nextGroups;
    const intermediate: EightBallState = {
      ...state,
      balls,
      groups: afterGroups,
      potted: [...state.potted, pottedRecord],
      foul,
    };

    const nextTableStatus = syncTableStatus(intermediate);
    const enteredEightBall =
      nextTableStatus === 'EIGHT_BALL' && state.tableStatus !== 'EIGHT_BALL';
    if (enteredEightBall) {
      events.push(
        makeEvent('EIGHT_BALL_PHASE', { playerIndex: seat }, createId('ev')),
      );
      reasonList.push('本方目标球已清空，进入 8 号球阶段');
    }

    // 是否继续击球：合法进球 → 继续；犯规/打进对方球 → 换手
    const nextSeat = continues ? seat : this.opponentSeat(state);

    if (fouled) {
      events.push(
        makeEvent(
          'FOUL',
          { reason: foul.reason, ball, playerIndex: seat },
          createId('ev'),
        ),
      );
    }
    if (!continues) {
      events.push(
        makeEvent(
          'TURN_ENDED',
          { from: seat, to: nextSeat, turnNumber: state.turnNumber + 1 },
          createId('ev'),
        ),
      );
    }

    const trace = baseTrace(
      fouled
        ? `犯规（${foul.reason}）并换手`
        : continues
          ? '合法进球，继续击球'
          : '进球但换手',
      fouled ? 'ILLEGAL' : 'LEGAL',
    );
    trace.ball = ball;
    trace.reasons = reasonList;
    trace.tableStatusAfter = nextTableStatus;
    trace.events = events.map((e) => e.type);

    return {
      state: {
        ...intermediate,
        tableStatus: nextTableStatus,
        // 这一杆打完之后，即便它是开球杆，也不再算「开球杆」。
        break: state.break.completed
          ? { ...state.break, shotTaken: true }
          : state.break,
        activePlayerIndex: continues ? seat : nextSeat,
        turnNumber: continues ? state.turnNumber : state.turnNumber + 1,
        runCount: continues ? state.runCount + 1 : 0,
      },
      events,
      trace,
    };
  }

  /**
   * 认组判定：一杆只进同一组的一颗或多颗球才认组。
   * 本命令一次只进一颗，因此这里直接按这颗球的组判定；兼容性保留函数形态。
   */
  private resolveAssignment(
    ball: number,
    seat: number,
    state: EightBallState,
  ): { group: BallGroup } | null {
    const group = getBallGroup(ball);
    if (!group) return null;
    // 该选手已经有组 → 不再改（分组不可重复改变）
    if (state.groups[seat] !== null && state.groups[seat] !== undefined) return null;
    return { group };
  }

  // ---------------------------------------------------------- 8 号球判定 ---

  private onEightBallPotted(
    state: EightBallState,
    ctx: EngineContext,
    rules: EightBallRules,
    scratch: boolean,
    baseTrace: (d: string, v: RuleTrace['validation']) => RuleTrace,
  ): EightBallResult {
    const seat = state.activePlayerIndex;
    const other = this.opponentSeat(state);
    // Only the actual break shot counts as "eight on the break". A match where
    // nobody has broken yet (break.completed === false) is NOT a break shot.
    const isBreakShot = state.break.completed && !state.break.shotTaken;

    // 开球打进 8 号：按 RuleSet.config.eightOnBreak 处理
    if (isBreakShot) {
      if (rules.eightOnBreak === 'rerack') {
        const trace = baseTrace('开球打进 8 号球，重新摆球', 'LEGAL');
        trace.ball = EIGHT_BALL;
        trace.reasons.push('RuleSet.config.eightOnBreak = rerack');
        trace.events = ['BALL_POTTED', 'RERACK'];
        return {
          state: { ...this.resetBalls(state), frameStatus: 'RERACK' },
          events: [
            makeEvent('BALL_POTTED', { ball: EIGHT_BALL, playerIndex: seat, legal: true }, createId('ev')),
            makeEvent('RERACK', { frame: 0, reason: 'eight-on-break' }, createId('ev')),
          ],
          trace,
        };
      }
      const winner = rules.eightOnBreak === 'win' ? seat : other;
      return this.declareFrame(state, ctx, winner, 'eight-on-break', baseTrace);
    }

    // 合法与否：本方目标球必须已清空，且这一杆没有母球落袋
    const legalTargets = getLegalTargetBalls(state, seat);
    const eightIsLegalTarget = legalTargets.includes(EIGHT_BALL);
    const legal = eightIsLegalTarget && !scratch;

    if (legal) {
      const trace = baseTrace('合法打进 8 号球，本局获胜', 'LEGAL');
      trace.ball = EIGHT_BALL;
      trace.reasons.push('本方目标球已清空', '8 号球为目标球', '母球未落袋');
      const events = [
        makeEvent(
          'BALL_POTTED',
          { ball: EIGHT_BALL, playerIndex: seat, legal: true },
          createId('ev'),
        ),
        makeEvent(
          'FRAME_WON',
          {
            frame: 0,
            winnerPlayerIndex: seat,
            winnerPlayerId: ctx.players[seat]?.playerId ?? null,
            reason: 'eight-ball',
            // winReason 与事件的 reason 是两个东西：reason 是机器判因，
            // winReason 是直接给人看的文字。两个都写进 payload，
            // 重放才能还原出一模一样的 state。
            winReason: '合法打进 8 号球',
          },
          createId('ev'),
        ),
      ];
      trace.events = events.map((e) => e.type);
      return {
        state: {
          ...state,
          balls: { ...state.balls, [EIGHT_BALL]: 'POCKETED' },
          // 8 号球也是一次进袋，必须记进本局进球流水 ——
          // 否则现场统计（getStatistics）比重放出来的少一颗。
          potted: [
            ...state.potted,
            {
              ball: EIGHT_BALL,
              playerIndex: seat,
              legal: true,
              turnNumber: state.turnNumber,
            },
          ],
          frameStatus: 'WON',
          winnerPlayerIndex: seat,
          winReason: '合法打进 8 号球',
          foul: NO_FOUL,
        },
        events,
        trace,
      };
    }

    // 非法黑八：提前打 8 / 打 8 时母球落袋
    const reasons: string[] = [];
    if (!eightIsLegalTarget) reasons.push('本方目标球尚未清空');
    if (scratch) reasons.push('打 8 号球时母球落袋');

    if (rules.eightBallEarlyLosesFrame) {
      const trace = baseTrace('非法打进 8 号球，本局判负', 'ILLEGAL');
      trace.ball = EIGHT_BALL;
      trace.reasons = reasons;
      const events = [
        makeEvent(
          'BALL_POTTED',
          { ball: EIGHT_BALL, playerIndex: seat, legal: false },
          createId('ev'),
        ),
        // 非法黑八本身就是一次犯规，state 里已经置了 foul —— 事件流必须同样
        // 记一条 FOUL，否则重放出来的 state 会缺掉这个犯规标记。
        makeEvent(
          'FOUL',
          { reason: 'ILLEGAL_EIGHT_BALL', ball: EIGHT_BALL, playerIndex: seat },
          createId('ev'),
        ),
        makeEvent(
          'FRAME_LOST',
          {
            frame: 0,
            loserPlayerIndex: seat,
            winnerPlayerIndex: other,
            winnerPlayerId: ctx.players[other]?.playerId ?? null,
            reason: 'illegal-eight-ball',
            winReason: `非法黑八：${reasons.join('；')}`,
          },
          createId('ev'),
        ),
      ];
      trace.events = events.map((e) => e.type);
      return {
        state: {
          ...state,
          balls: { ...state.balls, [EIGHT_BALL]: 'POCKETED' },
          // 同上：非法打进 8 号球也要进流水，只是 legal=false。
          potted: [
            ...state.potted,
            {
              ball: EIGHT_BALL,
              playerIndex: seat,
              legal: false,
              turnNumber: state.turnNumber,
            },
          ],
          frameStatus: 'LOST',
          loserPlayerIndex: seat,
          winnerPlayerIndex: other,
          winReason: `非法黑八：${reasons.join('；')}`,
          foul: foulOf('ILLEGAL_EIGHT_BALL', EIGHT_BALL),
        },
        events,
        trace,
      };
    }

    // 宽松规则：只判犯规，8 号球放回台面，换手
    const trace = baseTrace('非法打进 8 号球，判犯规并放回', 'ILLEGAL');
    trace.ball = EIGHT_BALL;
    trace.reasons = reasons;
    const nextSeat = other;
    const events = [
      makeEvent(
        'FOUL',
        { reason: 'ILLEGAL_EIGHT_BALL', ball: EIGHT_BALL, playerIndex: seat },
        createId('ev'),
      ),
      makeEvent(
        'TURN_ENDED',
        { from: seat, to: nextSeat, turnNumber: state.turnNumber + 1 },
        createId('ev'),
      ),
    ];
    trace.events = ['FOUL', 'TURN_ENDED'];
    return {
      state: {
        ...state,
        foul: foulOf('ILLEGAL_EIGHT_BALL', EIGHT_BALL),
        break: this.markBreakShotTaken(state),
        activePlayerIndex: nextSeat,
        turnNumber: state.turnNumber + 1,
        runCount: 0,
      },
      events,
      trace,
    };
  }

  // ------------------------------------------------------------- fouls ---

  private onBallMissed(
    state: EightBallState,
    _command: MatchCommand,
    _ctx: EngineContext,
    baseTrace: (d: string, v: RuleTrace['validation']) => RuleTrace,
  ): EightBallResult {
    const seat = state.activePlayerIndex;
    const nextSeat = this.opponentSeat(state);
    const trace = baseTrace('空杆，判犯规并换手', 'ILLEGAL');
    trace.reasons.push('母球未碰到任何球（NO_CONTACT）');
    const events = [
      makeEvent('BALL_MISSED', { playerIndex: seat }, createId('ev')),
      makeEvent(
        'FOUL',
        { reason: 'NO_CONTACT', playerIndex: seat },
        createId('ev'),
      ),
      makeEvent(
        'TURN_ENDED',
        { from: seat, to: nextSeat, turnNumber: state.turnNumber + 1 },
        createId('ev'),
      ),
    ];
    trace.events = events.map((e) => e.type);
    return {
      state: {
        ...state,
        foul: foulOf('NO_CONTACT'),
        break: this.markBreakShotTaken(state),
        activePlayerIndex: nextSeat,
        turnNumber: state.turnNumber + 1,
        runCount: 0,
      },
      events,
      trace,
    };
  }

  private onFoul(
    state: EightBallState,
    command: MatchCommand,
    _ctx: EngineContext,
    baseTrace: (d: string, v: RuleTrace['validation']) => RuleTrace,
  ): EightBallResult {
    const raw = String((command.payload ?? {}).reason ?? 'OTHER');
    const known: FoulReason[] = [
      'WRONG_BALL_FIRST',
      'NO_CONTACT',
      'SCRATCH',
      'ILLEGAL_EIGHT_BALL',
      'ILLEGAL_BREAK',
      'OTHER',
    ];
    const reason = (known as string[]).includes(raw) ? (raw as FoulReason) : 'OTHER';
    const seat = state.activePlayerIndex;
    const nextSeat = this.opponentSeat(state);
    const trace = baseTrace(`记录犯规：${FOUL_LABELS[reason]}，换手`, 'ILLEGAL');
    trace.reasons.push(FOUL_LABELS[reason]);
    const events = [
      makeEvent('FOUL', { reason, playerIndex: seat }, createId('ev')),
      makeEvent(
        'TURN_ENDED',
        { from: seat, to: nextSeat, turnNumber: state.turnNumber + 1 },
        createId('ev'),
      ),
    ];
    trace.events = events.map((e) => e.type);
    return {
      state: {
        ...state,
        foul: foulOf(reason),
        break: this.markBreakShotTaken(state),
        activePlayerIndex: nextSeat,
        turnNumber: state.turnNumber + 1,
        runCount: 0,
      },
      events,
      trace,
    };
  }

  // --------------------------------------------------------- turn / misc ---

  private onEndTurn(
    state: EightBallState,
    _ctx: EngineContext,
    baseTrace: (d: string, v: RuleTrace['validation']) => RuleTrace,
  ): EightBallResult {
    const seat = state.activePlayerIndex;
    const nextSeat = this.opponentSeat(state);
    const trace = baseTrace('主动结束回合，换手', 'LEGAL');
    const events = [
      makeEvent(
        'TURN_ENDED',
        { from: seat, to: nextSeat, turnNumber: state.turnNumber + 1 },
        createId('ev'),
      ),
    ];
    trace.events = ['TURN_ENDED'];
    return {
      state: {
        ...state,
        break: this.markBreakShotTaken(state),
        activePlayerIndex: nextSeat,
        turnNumber: state.turnNumber + 1,
        runCount: 0,
      },
      events,
      trace,
    };
  }

  private onCallShot(
    state: EightBallState,
    command: MatchCommand,
    rules: EightBallRules,
    baseTrace: (d: string, v: RuleTrace['validation']) => RuleTrace,
  ): EightBallResult {
    const payload = (command.payload ?? {}) as { ball?: unknown; pocket?: unknown };
    const ball = Number(payload.ball);
    if (!rules.callShot) {
      const t = baseTrace('本规则集未启用 Call Shot，忽略', 'IGNORED');
      t.reasons.push('RuleSet.config.callShot = false');
      return { state, events: [], trace: t };
    }
    if (!isObjectBall(ball)) {
      const t = baseTrace('CALL_SHOT 球号非法', 'ILLEGAL');
      return { state, events: [], trace: t };
    }
    const pocket = typeof payload.pocket === 'string' ? payload.pocket : undefined;
    const trace = baseTrace(`指定 ${ball} 号球${pocket ? ` → ${pocket}` : ''}`, 'LEGAL');
    trace.ball = ball;
    trace.events = ['CALL_SHOT'];
    return {
      state: { ...state, calledBall: ball, calledPocket: pocket },
      events: [makeEvent('CALL_SHOT', { ball, pocket }, createId('ev'))],
      trace,
    };
  }

  private onConcede(
    state: EightBallState,
    ctx: EngineContext,
    baseTrace: (d: string, v: RuleTrace['validation']) => RuleTrace,
  ): EightBallResult {
    const loser = state.activePlayerIndex;
    const winner = this.opponentSeat(state);
    const trace = baseTrace('认输，对手获胜', 'LEGAL');
    trace.reasons.push('CONCEDE');
    const events = [
      makeEvent('CONCEDE', { playerIndex: loser }, createId('ev')),
      makeEvent(
          'FRAME_LOST',
          {
            loserPlayerIndex: loser,
            winnerPlayerIndex: winner,
            winnerPlayerId: ctx.players[winner]?.playerId ?? null,
            reason: 'concede',
            winReason: '认输',
          },
        createId('ev'),
      ),
    ];
    trace.events = events.map((e) => e.type);
    return {
      state: {
        ...state,
        frameStatus: 'LOST',
        loserPlayerIndex: loser,
        winnerPlayerIndex: winner,
        winReason: '认输',
      },
      events,
      trace,
    };
  }

  private onRerack(
    state: EightBallState,
    _ctx: EngineContext,
    baseTrace: (d: string, v: RuleTrace['validation']) => RuleTrace,
  ): EightBallResult {
    const trace = baseTrace('重新摆球', 'LEGAL');
    trace.events = ['RERACK'];
    return {
      state: { ...this.resetBalls(state), frameStatus: 'RERACK' },
      events: [makeEvent('RERACK', { reason: 'manual' }, createId('ev'))],
      trace,
    };
  }

  private declareFrame(
    state: EightBallState,
    ctx: EngineContext,
    winner: number,
    reason: string,
    baseTrace: (d: string, v: RuleTrace['validation']) => RuleTrace,
  ): EightBallResult {
    const trace = baseTrace(`本局由 P${winner + 1} 获胜（${reason}）`, 'LEGAL');
    trace.reasons.push(reason);
    trace.events = ['FRAME_WON'];
    return {
      state: { ...state, frameStatus: 'WON', winnerPlayerIndex: winner, winReason: reason },
      events: [
        makeEvent(
          'FRAME_WON',
          {
            frame: 0,
            winnerPlayerIndex: winner,
            winnerPlayerId: ctx.players[winner]?.playerId ?? null,
            reason,
            winReason: reason,
          },
          createId('ev'),
        ),
      ],
      trace,
    };
  }

  private resetBalls(state: EightBallState): EightBallState {
    return {
      ...state,
      balls: initialBalls(),
      tableStatus: 'OPEN',
      groups: Object.fromEntries(Object.keys(state.groups).map((k) => [k, null])),
      break: { completed: false, shotTaken: false, legal: false, playerIndex: state.activePlayerIndex },
      foul: NO_FOUL,
      potted: [],
      runCount: 0,
      frameStatus: 'PLAYING',
      winnerPlayerIndex: undefined,
      loserPlayerIndex: undefined,
      winReason: undefined,
      calledBall: undefined,
      calledPocket: undefined,
    };
  }

  private opponentSeat(state: EightBallState): number {
    const seats = Object.keys(state.groups).length || 2;
    return (state.activePlayerIndex + 1) % Math.max(1, seats);
  }

  /**
   * 一杆结束后，开球杆的「尚未打完」标记要消除 —— 否则开球后第一杆仍然
   * 会被当成开球杆而永远不认组。
   */
  private markBreakShotTaken(state: EightBallState): EightBallState['break'] {
    return state.break.completed ? { ...state.break, shotTaken: true } : state.break;
  }

  /**
   * Start a fresh frame: re-rack, re-open the table, clear groups, put the
   * requested player on strike. Groups are per-frame in 8-ball, so they are
   * intentionally cleared here.
   */
  startFrame(
    state: EightBallState,
    breakPlayerIndex: number,
    ctx: EngineContext,
  ): EightBallState {
    const seats = Math.max(2, ctx.players.length);
    const groups: Record<number, BallGroup | null> = {};
    for (let i = 0; i < seats; i += 1) groups[i] = null;
    const breaker = breakPlayerIndex >= 0 && breakPlayerIndex < seats ? breakPlayerIndex : 0;
    return {
      ...state,
      balls: initialBalls(),
      groups,
      tableStatus: 'OPEN',
      activePlayerIndex: breaker,
      turnNumber: 1,
      break: { completed: false, shotTaken: false, legal: false, playerIndex: breaker },
      foul: NO_FOUL,
      potted: [],
      runCount: 0,
      frameStatus: 'PLAYING',
      winnerPlayerIndex: undefined,
      loserPlayerIndex: undefined,
      winReason: undefined,
      calledBall: undefined,
      calledPocket: undefined,
    };
  }

  // ------------------------------------------------------------ contract ---

  getScoreSummary(state: EightBallState): ScoreSummary {
    const seats = Object.keys(state.groups).length || 2;
    const lines = [];
    for (let i = 0; i < seats; i += 1) {
      const group = state.groups[i] ?? null;
      const left =
        group === null
          ? ''
          : group === 'SOLIDS'
            ? `剩 ${remainingInGroup(state, 'SOLIDS')}`
            : `剩 ${remainingInGroup(state, 'STRIPES')}`;
      lines.push({ playerId: null, label: group ?? '未分组', value: left });
    }
    const note =
      state.tableStatus === 'EIGHT_BALL' ? '打 8 号球阶段' : state.tableStatus;
    return { lines, note };
  }

  isFrameComplete(state: EightBallState): boolean {
    return state.frameStatus !== 'PLAYING';
  }

  isMatchComplete(_state: EightBallState): boolean {
    // Match completion is a Match-layer concern (Race To): the engine only
    // decides a frame. Never duplicate the aggregation rule here.
    return false;
  }

  getWinner(state: EightBallState): string | null {
    return state.winnerPlayerIndex === undefined
      ? null
      : String(state.winnerPlayerIndex);
  }

  getStatistics(state: EightBallState): unknown {
    return {
      potted: state.potted,
      turnNumber: state.turnNumber,
      runCount: state.runCount,
      remaining: {
        SOLIDS: remainingInGroup(state, 'SOLIDS'),
        STRIPES: remainingInGroup(state, 'STRIPES'),
      },
    };
  }
}

/**
 * applyEvent —— 把一条事实事件应用到状态上，用于 EventLog 重放。
 *
 * 这是「EventLog 是事实源」的技术保证：删掉 Snapshot 只留事件流，
 * 也能把 EightBallState 重建到与现场一致。
 */
export function applyEightBallEvent(
  state: EightBallState,
  event: MatchEvent,
): EightBallState {
  const p = event.payload as Record<string, unknown>;

  switch (event.type) {
    case 'BREAK_STARTED': {
      const playerIndex =
        typeof p.playerIndex === 'number' ? p.playerIndex : state.activePlayerIndex;
      return {
        ...state,
        // BREAK_STARTED 只表示「开球了」，开球这一杆本身还没打完。
        // shotTaken 由随后的事实事件（进袋/空杆/犯规/换手）置位，与 reduce 一致。
        break: { completed: true, shotTaken: false, legal: p.legal !== false, playerIndex },
      };
    }

    case 'BALL_POTTED': {
      const ball = Number(p.ball);
      if (!Number.isInteger(ball)) return state;
      const playerIndex =
        typeof p.playerIndex === 'number' ? p.playerIndex : state.activePlayerIndex;
      const legal = p.legal !== false;
      const balls =
        ball === CUE_BALL ? state.balls : { ...state.balls, [ball]: 'POCKETED' as const };
      const potted =
        ball === CUE_BALL
          ? state.potted
          : [
              ...state.potted,
              {
                ball,
                playerIndex,
                legal,
                turnNumber:
                  typeof p.turnNumber === 'number' ? p.turnNumber : state.turnNumber,
              },
            ];
      /*
       * 合法进球会清掉上一次的犯规标记 —— 必须与 reduce 一致。
       * 不这么做的话，重放出来的 state 会保留一个已经过期的「犯规」，
       * 界面上就会显示「犯规 · 母球落袋」，而现场其实早就换手打完了。
       */
      const foul = legal ? NO_FOUL : state.foul;
      /*
       * runCount 由 reduce 在「是否继续击球」时决定，光看 legal 推不出来
       * （打进对方球是 legal，但本回合结束、runCount 归零）。
       * 所以 reduce 把结论写进 payload，重放直接读，保证两边一致。
       * 8 号球的进袋事件不带这个字段 —— 那时本局已结束，runCount 不动。
       */
      const runCount =
        typeof p.continues === 'boolean'
          ? p.continues
            ? state.runCount + 1
            : 0
          : state.runCount;
      const next = {
        ...state,
        balls,
        potted,
        foul,
        runCount,
        // 任何一次进袋都意味着「开球这一杆」已经打完（与 reduce 的置位保持一致）。
        break: state.break.completed
          ? { ...state.break, shotTaken: true }
          : state.break,
      };
      // Keep the table phase derived from the balls, exactly like reduce does.
      return { ...next, tableStatus: syncTableStatus(next) };
    }

    case 'BALL_MISSED':
      return state;

    case 'FOUL': {
      const raw = String(p.reason ?? 'OTHER') as FoulReason;
      return { ...state, foul: foulOf(raw, typeof p.ball === 'number' ? p.ball : undefined) };
    }

    case 'TURN_ENDED': {
      const to = typeof p.to === 'number' ? p.to : state.activePlayerIndex;
      const turnNumber =
        typeof p.turnNumber === 'number' ? p.turnNumber : state.turnNumber + 1;
      return {
        ...state,
        activePlayerIndex: to,
        turnNumber,
        runCount: 0,
        break: state.break.completed
          ? { ...state.break, shotTaken: true }
          : state.break,
      };
    }

    case 'GROUPS_ASSIGNED': {
      const idx = typeof p.playerIndex === 'number' ? p.playerIndex : state.activePlayerIndex;
      const group = p.group === 'SOLIDS' || p.group === 'STRIPES' ? p.group : null;
      if (!group) return state;
      const groups: Record<number, BallGroup | null> = { ...state.groups, [idx]: group };
      const other = (idx + 1) % (Object.keys(state.groups).length || 2);
      if (groups[other] === null || groups[other] === undefined) {
        groups[other] = oppositeGroup(group);
      }
      // Recompute from the balls themselves so replay matches reduce exactly
      // (a GROUPS_ASSIGNED event can arrive after the group was already cleared).
      const next = { ...state, groups };
      return { ...next, tableStatus: syncTableStatus(next) };
    }

    case 'EIGHT_BALL_PHASE':
      return { ...state, tableStatus: 'EIGHT_BALL' };

    case 'FRAME_WON': {
      const winner =
        typeof p.winnerPlayerIndex === 'number'
          ? p.winnerPlayerIndex
          : state.activePlayerIndex;
      return {
        ...state,
        frameStatus: 'WON',
        winnerPlayerIndex: winner,
        // winReason 是直接给人看的文字，由引擎写进 payload；
        // 老事件没有这个字段时才退回机器判因 reason。
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
        typeof p.loserPlayerIndex === 'number'
          ? p.loserPlayerIndex
          : state.activePlayerIndex;
      const winner =
        typeof p.winnerPlayerIndex === 'number'
          ? p.winnerPlayerIndex
          : (loser + 1) % (Object.keys(state.groups).length || 2);
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

    case 'RERACK':
      return {
        ...state,
        balls: initialBalls(),
        tableStatus: 'OPEN',
        groups: Object.fromEntries(Object.keys(state.groups).map((k) => [k, null])),
        break: { completed: false, shotTaken: false, legal: false, playerIndex: state.activePlayerIndex },
        foul: NO_FOUL,
        potted: [],
        runCount: 0,
        frameStatus: 'PLAYING',
        winnerPlayerIndex: undefined,
        loserPlayerIndex: undefined,
        winReason: undefined,
      };

    case 'CALL_SHOT':
      return {
        ...state,
        calledBall: typeof p.ball === 'number' ? p.ball : state.calledBall,
        calledPocket: typeof p.pocket === 'string' ? p.pocket : state.calledPocket,
      };

    case 'FRAME_STARTED':
      // A new frame resets the table but keeps the assigned groups? No — a new
      // frame re-racks and re-opens the table (groups are per-frame in 8-ball).
      return {
        ...state,
        balls: initialBalls(),
        tableStatus: 'OPEN',
        groups: Object.fromEntries(Object.keys(state.groups).map((k) => [k, null])),
        break: { completed: false, shotTaken: false, legal: false, playerIndex: state.activePlayerIndex },
        foul: NO_FOUL,
        potted: [],
        runCount: 0,
        frameStatus: 'PLAYING',
        winnerPlayerIndex: undefined,
        loserPlayerIndex: undefined,
        winReason: undefined,
        calledBall: undefined,
        calledPocket: undefined,
      };

    default:
      return state;
  }
}

/** Convenience: replay a whole event list into engine state. */
export function replayEightBallState(
  initial: EightBallState,
  events: MatchEvent[],
): EightBallState {
  return events.reduce(applyEightBallEvent, initial);
}

/** Exported for tests / RuleTrace display. */
export const EIGHT_BALL_FOUL_LABELS = FOUL_LABELS;
export const EIGHT_BALL_ALL_BALLS = [...SOLIDS, EIGHT_BALL, ...STRIPES];
export { getLegalTargetBalls, getBallGroup, ballsOfGroup };
export type { MatchPlayer };
