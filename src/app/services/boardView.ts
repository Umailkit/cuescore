import type { MatchCommandType } from '@core/types/command';
import type { GameType } from '@core/types/gameType';
import type { EightBallState } from '@core/engine/eightBall/types';
import {
  ballsOfGroup,
  getLegalTargetBalls,
  isEightBallOnTable,
  oppositeGroup,
  remainingInGroup,
} from '@core/engine/eightBall/balls';
import { EIGHT_BALL, SOLIDS, STRIPES } from '@core/engine/eightBall/types';
import { EIGHT_BALL_FOUL_LABELS } from '@core/engine/eightBall/engine';
import { NINE_BALL_NUMBERS, NINE_BALL_FOUL_LABELS, type NineBallState } from '@core/engine/nineBall/types';
import { resolveNineBallRules } from '@core/engine/nineBall/rules';
import { SIX_BALL_NUMBERS, SIX_BALL_FOUL_LABELS, type SixBallState } from '@core/engine/sixBall/types';
import { resolveSixBallRules } from '@core/engine/sixBall/rules';
import { FOUR_BALL_FOUL_LABELS, type FourBallState } from '@core/engine/fourBall/types';
import { CHASE_ORDER, CHASE_RULES, chaseNet } from '@core/engine/fourBall/chase';
import { resolveFourBallRules } from '@core/engine/fourBall/rules';
import {
  BALL_VALUES,
  COLOUR_ORDER,
  nextColour,
  type ColourName,
  type SnookerState,
} from '@core/engine/snooker/types';

/**
 * BoardView —— 引擎派生给 UI 的只读展示模型。
 *
 * 存在的唯一目的：把「哪些球可点、哪些已进、谁是目标」这个判断留在引擎侧，
 * 让 React 组件里 **一行规则判断都没有**（PHASE 3A 第十九条）。
 * 组件只负责渲染这个结果。
 *
 * 位置说明（PHASE 3A 第二十一条）：
 *   本文件位于 **app 层**，是 UI 与具体引擎之间唯一的转接面。
 *   `@ui` 只允许从 `@app/services/boardView` 取展示模型与文案，
 *   不得直接 import `@core/engine/*`。
 *
 * PHASE 3：五套引擎全部落地后，本门面从「八球专用」升级为「按 gameType 分派」。
 * UI 依旧只认 BoardView，新增一种玩法 = 在这里加一个分支，组件不动。
 */

/** 面板布局形态。决定 BallBoard 怎么排，不影响规则。 */
export type BoardKind = 'eight-ball' | 'numbered' | 'snooker';

export interface BoardBall {
  number: number;
  /** 'ON_TABLE' | 'POCKETED' */
  status: 'ON_TABLE' | 'POCKETED';
  /** SOLIDS / STRIPES / EIGHT / PLAIN（无分组的数字球） */
  kind: 'SOLIDS' | 'STRIPES' | 'EIGHT' | 'PLAIN';
  /** 是否是当前击球方的合法目标（决定可点击）。 */
  legalTarget: boolean;
  /** 是否属于当前击球方。 */
  belongsToActivePlayer: boolean;
  /** 球面上的字（默认显示 number；斯诺克显示球名/分值）。 */
  label?: string;
  /** 球色（CSS color）。不提供则用主题色。 */
  tint?: string;
  /**
   * 点这颗球要下发的命令 —— **由 app 层算好**。
   * UI 不需要知道斯诺克传 'red' 还是九球传球号，照发即可。
   */
  action: { type: MatchCommandType; payload?: Record<string, unknown> };
}

export interface BoardView {
  /** 布局形态。 */
  kind: BoardKind;
  balls: BoardBall[];
  /** 当前击球方 seat index。 */
  activePlayerIndex: number;
  /** 当前击球方的球组（八球才有，其余为 null）。 */
  activeGroup: 'SOLIDS' | 'STRIPES' | null;
  /** 八球台面状态；非八球为 'NA'。 */
  tableStatus: 'OPEN' | 'GROUPS_ASSIGNED' | 'EIGHT_BALL' | 'NA';
  /** 合法目标球号列表。 */
  legalTargets: number[];
  /** 本方剩余球数（未分组/无分组玩法为 0）。 */
  remainingOwn: number;
  /** 是否已进入黑八阶段。 */
  eightBallPhase: boolean;
  /** 能否继续击球（本局未结束）。 */
  canPot: boolean;
  /** 面板底部说明文案（图例）。 */
  note: string;
}

/** 外露给页面的最小比赛事实，页面不接触引擎内部类型。 */
export interface MatchFacts {
  foulOccurred: boolean;
  foulReasonLabel: string;
  foulDetail?: string;
  winReason?: string;
  /** seat index → 已认球组（仅八球有意义）。 */
  playerGroups: Record<number, 'SOLIDS' | 'STRIPES' | null>;
  /** 本局还没开球（决定是否显示「开球」按钮）。 */
  needsBreak: boolean;
  /** 斯诺克：当前单杆连续得分。 */
  currentBreak?: number;
  /** 计分制玩法（六球/四球/斯诺克）的局内分数。 */
  points?: Record<number, number>;
  /** 本局分数目标（六球/四球有；斯诺克按局数定胜负，没有分数目标）。 */
  frameGoal?: number;
  /** 一行状态补充（例如「台面还剩 43 分」）。 */
  note?: string;
}

function kindOf(ball: number): BoardBall['kind'] {
  if (ball === EIGHT_BALL) return 'EIGHT';
  return ball <= 7 ? 'SOLIDS' : 'STRIPES';
}

/**
 * 从任意 engineState 里安全地取出八球状态。
 * 非八球（或还没初始化）返回 null，页面据此回退到通用面板。
 */
export function asEightBallState(state: unknown): EightBallState | null {
  if (!state || typeof state !== 'object') return null;
  if (!('balls' in state) || !('groups' in state)) return null;
  return state as EightBallState;
}

function asNineBallState(state: unknown): NineBallState | null {
  if (!state || typeof state !== 'object') return null;
  if (!('balls' in state) || !('pushOut' in state)) return null;
  return state as NineBallState;
}

function asSixBallState(state: unknown): SixBallState | null {
  if (!state || typeof state !== 'object') return null;
  // 六球与九球都有 balls，靠 points + 6 颗球区分。
  if (!('balls' in state) || !('points' in state)) return null;
  return state as SixBallState;
}

function asSnookerState(state: unknown): SnookerState | null {
  if (!state || typeof state !== 'object') return null;
  if (!('redsRemaining' in state) || !('coloursOnTable' in state)) return null;
  return state as SnookerState;
}

function asFourBallState(state: unknown): FourBallState | null {
  if (!state || typeof state !== 'object') return null;
  if (!('scoreLog' in state) || !('points' in state)) return null;
  return state as FourBallState;
}

// ------------------------------------------------------------------ 八球 ---

function buildEightBoard(state: EightBallState): BoardView {
  const active = state.activePlayerIndex;
  const activeGroup = state.groups[active] ?? null;
  const legalTargets = getLegalTargetBalls(state, active);
  const canPot = state.frameStatus === 'PLAYING';

  const balls: BoardBall[] = [];
  for (const b of SOLIDS) balls.push(toEightBall(state, b, activeGroup, legalTargets, canPot));
  balls.push(toEightBall(state, EIGHT_BALL, activeGroup, legalTargets, canPot));
  for (const b of STRIPES) balls.push(toEightBall(state, b, activeGroup, legalTargets, canPot));

  return {
    kind: 'eight-ball',
    balls,
    activePlayerIndex: active,
    activeGroup,
    tableStatus: state.tableStatus,
    legalTargets,
    remainingOwn: activeGroup ? remainingInGroup(state, activeGroup) : 0,
    eightBallPhase: state.tableStatus === 'EIGHT_BALL' || isEightBallOnTable(state) === false,
    canPot,
    note:
      state.tableStatus === 'OPEN'
        ? '球台开放 · 任意非 8 号球'
        : state.tableStatus === 'EIGHT_BALL'
          ? '黑八阶段 · 只能打 8 号球'
          : '已分组 · 只能打本方球',
  };
}

function toEightBall(
  state: EightBallState,
  number: number,
  activeGroup: 'SOLIDS' | 'STRIPES' | null,
  legalTargets: number[],
  canPot: boolean,
): BoardBall {
  const status = state.balls[number] === 'POCKETED' ? 'POCKETED' : 'ON_TABLE';
  const kind = kindOf(number);
  const legalTarget = canPot && legalTargets.includes(number) && status === 'ON_TABLE';
  const belongsToActivePlayer =
    activeGroup !== null && kind !== 'EIGHT' ? kind === activeGroup : false;
  return {
    number,
    status,
    kind,
    legalTarget,
    belongsToActivePlayer,
    action: { type: 'BALL_POTTED', payload: { ball: number } },
  };
}

// -------------------------------------------------------- 九球 / 六球 ------

/** 按号序击打的数字球玩法：合法目标 = 台面最小号球。 */
function buildNumberedBoard(
  gameType: 'nine-ball' | 'six-ball',
  numbers: readonly number[],
  state: { balls: Record<number, string>; activePlayerIndex: number; frameStatus?: string },
): BoardView {
  const canPot = state.frameStatus !== 'WON' && state.frameStatus !== 'LOST';
  let lowest: number | null = null;
  for (const b of numbers) {
    if (state.balls[b] !== 'POCKETED') {
      lowest = b;
      break;
    }
  }

  const balls: BoardBall[] = numbers.map((n) => {
    const status = state.balls[n] === 'POCKETED' ? 'POCKETED' : 'ON_TABLE';
    return {
      number: n,
      status,
      kind: 'PLAIN' as const,
      legalTarget: canPot && status === 'ON_TABLE' && n === lowest,
      belongsToActivePlayer: false,
      action: { type: 'BALL_POTTED' as MatchCommandType, payload: { ball: n } },
    };
  });

  return {
    kind: 'numbered',
    balls,
    activePlayerIndex: state.activePlayerIndex,
    activeGroup: null,
    tableStatus: 'NA',
    legalTargets: lowest === null ? [] : [lowest],
    remainingOwn: numbers.filter((n) => state.balls[n] !== 'POCKETED').length,
    eightBallPhase: false,
    canPot,
    note:
      lowest === null
        ? '台面已清'
        : gameType === 'nine-ball'
          ? `按号序击打 · 当前目标 ${lowest} 号`
          : `按号序击打 · 当前目标 ${lowest} 号`,
  };
}

// ---------------------------------------------------------------- 斯诺克 ---

const SNOOKER_TINT: Record<ColourName | 'red', string> = {
  red: '#c0392b',
  yellow: '#e0b400',
  green: '#1e8e4e',
  brown: '#8a5a2b',
  blue: '#2563c9',
  pink: '#d94f9a',
  black: '#1a1a1a',
};

/** 斯诺克犯规面板：罚分取决于碰到哪颗球，所以选项按球给。 */
const SNOOKER_FOUL_LABEL: Record<'red' | ColourName, string> = {
  red: '碰到红球',
  yellow: '碰到黄球（2 分）',
  green: '碰到绿球（3 分）',
  brown: '碰到棕球（4 分）',
  blue: '碰到蓝球（5 分）',
  pink: '碰到粉球（6 分）',
  black: '碰到黑球（7 分）',
};

const SNOOKER_LABEL: Record<ColourName | 'red', string> = {
  red: '红',
  yellow: '2',
  green: '3',
  brown: '4',
  blue: '5',
  pink: '6',
  black: '7',
};

function buildSnookerBoard(state: SnookerState): BoardView {
  const canPot = !state.frameComplete;
  const targetColour = state.stage === 'colours' ? nextColour(state) : null;

  const balls: BoardBall[] = [];

  // 红球
  const redsOn = state.redsRemaining > 0;
  balls.push({
    number: BALL_VALUES.red,
    status: redsOn ? 'ON_TABLE' : 'POCKETED',
    kind: 'PLAIN',
    legalTarget: canPot && redsOn && state.stage === 'reds' && !state.expectingColour,
    belongsToActivePlayer: false,
    label: redsOn ? `红·${state.redsRemaining}` : '红',
    tint: SNOOKER_TINT.red,
    action: { type: 'SCORE', payload: { ball: 'red' } },
  });

  // 彩球：红球阶段打完红后可任选一颗；彩球阶段必须按分值由低到高
  for (const c of COLOUR_ORDER) {
    const on = state.coloursOnTable[c];
    const legal =
      canPot &&
      on &&
      (state.stage === 'colours' ? c === targetColour : state.expectingColour);
    balls.push({
      number: BALL_VALUES[c],
      status: on ? 'ON_TABLE' : 'POCKETED',
      kind: 'PLAIN',
      legalTarget: legal,
      belongsToActivePlayer: false,
      label: SNOOKER_LABEL[c],
      tint: SNOOKER_TINT[c],
      action: { type: 'SCORE', payload: { ball: c } },
    });
  }

  return {
    kind: 'snooker',
    balls,
    activePlayerIndex: state.activePlayerIndex,
    activeGroup: null,
    tableStatus: 'NA',
    legalTargets: balls.filter((b) => b.legalTarget).map((b) => b.number),
    remainingOwn: state.redsRemaining,
    eightBallPhase: state.stage === 'colours',
    canPot,
    note:
      state.stage === 'reds'
        ? state.expectingColour
          ? '已打进红球 · 选一颗彩球'
          : `红球阶段 · 台上 ${state.redsRemaining} 颗红球`
        : '彩球阶段 · 按黄绿棕蓝粉黑顺序',
  };
}

// ------------------------------------------------------------------ 分派 ---

/**
 * 按 gameType 构建展示模型。
 *
 * 四球是纯加分制（没有球台），返回 null —— 页面据此只显示加分按钮。
 */
export function buildBoardView(
  gameType: GameType,
  state: unknown,
  ruleSetConfig?: unknown,
): BoardView | null {
  switch (gameType) {
    case 'eight-ball': {
      const s = asEightBallState(state);
      return s ? buildEightBoard(s) : null;
    }
    case 'nine-ball': {
      const s = asNineBallState(state);
      if (!s) return null;
      // 记分制下没有「该打哪颗球」的概念，球台面板不出现 —— 分数靠加减分按钮。
      if (resolveNineBallRules(ruleSetConfig as Record<string, unknown> | null).scoringMode === 'points') {
        return null;
      }
      return buildNumberedBoard('nine-ball', NINE_BALL_NUMBERS, s);
    }
    case 'six-ball': {
      const s = asSixBallState(state);
      return s ? buildNumberedBoard('six-ball', SIX_BALL_NUMBERS, s) : null;
    }
    case 'snooker': {
      const s = asSnookerState(state);
      return s ? buildSnookerBoard(s) : null;
    }
    case 'four-ball':
      return null;
    default:
      return null;
  }
}

// ------------------------------------------------------------------ 事实 ---

/** 页面需要的少量比赛事实（犯规文案、胜负依据），由 app 层翻译好再给 UI。 */
export function readFacts(
  gameType: GameType,
  state: unknown,
  ruleSetConfig?: unknown,
): MatchFacts | null {
  switch (gameType) {
    case 'eight-ball': {
      const s = asEightBallState(state);
      if (!s) return null;
      const playerGroups: MatchFacts['playerGroups'] = {};
      for (const [seat, group] of Object.entries(s.groups)) {
        playerGroups[Number(seat)] = group;
      }
      return {
        foulOccurred: s.foul.occurred,
        foulReasonLabel: EIGHT_BALL_FOUL_LABELS[s.foul.reason ?? 'OTHER'],
        foulDetail: s.foul.detail,
        winReason: s.winReason,
        playerGroups,
        needsBreak: !s.break.completed,
      };
    }
    case 'nine-ball': {
      const s = asNineBallState(state);
      if (!s) return null;
      const rules = resolveNineBallRules(ruleSetConfig as Record<string, unknown> | null);
      const scoring = rules.scoringMode === 'points';
      return {
        foulOccurred: s.foul.occurred,
        foulReasonLabel: NINE_BALL_FOUL_LABELS[s.foul.reason ?? 'OTHER'],
        foulDetail: s.foul.detail,
        winReason: s.winReason,
        playerGroups: {},
        // 记分制没有「开球」这一步，不显示开球按钮
        needsBreak: scoring ? false : !s.break.completed,
        points: scoring ? s.points : undefined,
        frameGoal: scoring ? rules.targetPoints : undefined,
        note: scoring ? undefined : s.ballInHand ? '对手获得自由球' : undefined,
      };
    }
    case 'six-ball': {
      const s = asSixBallState(state);
      if (!s) return null;
      return {
        foulOccurred: s.foul.occurred,
        foulReasonLabel: SIX_BALL_FOUL_LABELS[s.foul.reason ?? 'OTHER'],
        foulDetail: s.foul.detail,
        winReason: s.winReason,
        playerGroups: {},
        needsBreak: !s.break.completed,
        points: s.points,
        frameGoal: resolveSixBallRules(ruleSetConfig as Record<string, unknown> | null).targetPoints,
      };
    }
    case 'four-ball': {
      const s = asFourBallState(state);
      if (!s) return null;
      return {
        foulOccurred: s.foul.occurred,
        foulReasonLabel: FOUR_BALL_FOUL_LABELS[s.foul.reason ?? 'OTHER'],
        foulDetail: s.foul.detail,
        winReason: s.winReason,
        playerGroups: {},
        needsBreak: false,
        points: s.points,
        frameGoal: resolveFourBallRules(ruleSetConfig as Record<string, unknown> | null).targetPoints,
      };
    }
    case 'snooker': {
      const s = asSnookerState(state);
      if (!s) return null;
      return {
        foulOccurred: false,
        foulReasonLabel: '',
        winReason: s.winReason,
        playerGroups: {},
        needsBreak: false,
        points: s.scores,
        currentBreak: s.breaks[s.activePlayerIndex] ?? 0,
        note: `单杆 ${s.breaks[s.activePlayerIndex] ?? 0}`,
      };
    }
    default:
      return null;
  }
}

/**
 * 犯规选项，文案来自各引擎统一的标签表。
 *
 * 斯诺克特殊：罚分 = max(最低罚分, 涉及球的分值)，
 * 所以这里给的是「犯规碰到哪颗球」，不是犯规类型。
 */
export function foulReasonOptions(
  gameType: GameType,
): { value: string; label: string; hint?: string; action: { type: MatchCommandType; payload?: Record<string, unknown> } }[] {
  if (gameType === 'snooker') {
    const out = [
      {
        value: 'none',
        label: '未碰到球 / 不清楚',
        hint: `罚 ${4} 分`,
        action: { type: 'FOUL' as MatchCommandType, payload: {} },
      },
    ];
    for (const c of ['red', ...COLOUR_ORDER]) {
      const key = c as keyof typeof SNOOKER_FOUL_LABEL;
      out.push({
        value: c,
        label: SNOOKER_FOUL_LABEL[key],
        hint: `罚 ${Math.max(4, BALL_VALUES[key])} 分`,
        action: { type: 'FOUL' as MatchCommandType, payload: { ball: c } },
      });
    }
    return out;
  }

  const table: Record<string, string> =
    gameType === 'eight-ball'
      ? EIGHT_BALL_FOUL_LABELS
      : gameType === 'nine-ball'
        ? NINE_BALL_FOUL_LABELS
        : gameType === 'six-ball'
          ? SIX_BALL_FOUL_LABELS
          : FOUR_BALL_FOUL_LABELS;
  return Object.keys(table).map((value) => ({
    value,
    label: table[value] ?? value,
    action: { type: 'FOUL' as MatchCommandType, payload: { reason: value } },
  }));
}

// -------------------------------------------------------------- 快捷操作 ---

export interface QuickAction {
  label: string;
  hint?: string;
  action: { type: MatchCommandType; payload?: Record<string, unknown> };
}

/**
 * 记分类玩法的快捷档位（台球厅常用：一、四、八、十）。
 *
 * 九球有目标分时（Race To N）仍按这套档位逐球记分，方便记分员
 * 「进一颗点 +1」；走追分（无目标分）时改用规则表五档。
 */
export const DEFAULT_QUICK_POINTS: readonly number[] = [1, 4, 8, 10];

function quickPointsOf(ruleSetConfig: unknown): readonly number[] {
  const raw = (ruleSetConfig as { quickPoints?: unknown } | null | undefined)?.quickPoints;
  if (Array.isArray(raw)) {
    const nums = raw.filter(
      (n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0,
    );
    if (nums.length > 0) return [...new Set(nums)];
  }
  return DEFAULT_QUICK_POINTS;
}

/** 加分档位：+N。 */
function addActions(values: readonly number[]): QuickAction[] {
  return values.map((points) => ({
    label: `+${points}`,
    action: {
      type: 'ADJUST_SCORE' as MatchCommandType,
      payload: { points },
    },
  }));
}

/** 扣分档位：-N。 */
function deductActions(values: readonly number[]): QuickAction[] {
  return values.map((points) => ({
    label: `-${points}`,
    action: {
      type: 'ADJUST_SCORE' as MatchCommandType,
      payload: { points: -points },
    },
  }));
}

/**
 * 这个玩法当前是不是「追分」口径。
 *
 * - 四球无条件走追分
 * - 九球只在「记分制 + 没有目标分」时才算追分；有目标分（Race To N）
 *   仍然是逐球记分那一套，标准清台制则没有分数概念。
 *
 * 判断放在这里而不是 UI 里，是为了让「按钮长什么样」和「引擎认什么命令」
 * 用同一个来源，避免两边各判一次。
 */
export function isChaseGame(gameType: GameType, ruleSetConfig: unknown): boolean {
  if (gameType === 'four-ball') return true;
  if (gameType === 'nine-ball') {
    const rules = resolveNineBallRules(ruleSetConfig as Record<string, unknown> | null);
    return rules.scoringMode === 'points' && rules.targetPoints === 0;
  }
  return false;
}

/**
 * 玩法专属的快捷操作（app 层按 gameType 派生，UI 照发）。
 *
 * 四球 / 记分制九球走追分：五个得分类型，分值由规则表算，不让记分员填。
 * 斯诺克要能「结束单杆」。
 */
export function quickActions(gameType: GameType, ruleSetConfig: unknown): QuickAction[] {
  if (isChaseGame(gameType, ruleSetConfig)) {
    return CHASE_ORDER.map((kind) => {
      const rule = CHASE_RULES[kind];
      const net = chaseNet(kind);
      return {
        label: rule.label,
        hint: `${net > 0 ? '+' : ''}${net}`,
        action: {
          type: 'CHASE_SCORED' as MatchCommandType,
          payload: { kind },
        },
      };
    });
  }
  if (gameType === 'nine-ball') {
    const rules = resolveNineBallRules(ruleSetConfig as Record<string, unknown> | null);
    if (rules.scoringMode === 'points') {
      const tiers = quickPointsOf(ruleSetConfig);
      return [...addActions(tiers), ...deductActions(tiers)];
    }
    return [
      {
        label: '推杆（Push Out）',
        hint: '开球后第一杆可用一次',
        action: { type: 'PUSH_OUT' as MatchCommandType },
      },
    ];
  }
  if (gameType === 'snooker') {
    return [
      {
        label: '结束单杆',
        hint: '换手，单杆归零',
        action: { type: 'END_BREAK' as MatchCommandType },
      },
    ];
  }
  return [];
}

/**
 * 对手分组，用于比分板显示。没有对手（>2 人）时返回 null。
 */
export function opponentGroup(
  state: EightBallState,
  activeIndex: number,
): 'SOLIDS' | 'STRIPES' | null {
  const own = state.groups[activeIndex] ?? null;
  if (!own) return null;
  const opp = oppositeGroup(own);
  const seats = Object.keys(state.groups).length;
  if (seats !== 2) return null;
  return opp;
}

/** 供引擎无关的 UI 读取：本方组里还剩几颗。 */
export function remainingOf(
  state: EightBallState,
  group: 'SOLIDS' | 'STRIPES',
): number {
  return remainingInGroup(state, group);
}

/** 已进袋的球号（按进袋顺序）。 */
export function pottedBalls(state: EightBallState): number[] {
  return state.potted.map((p) => p.ball);
}

/** 某组全部球号，供图例展示。 */
export function groupBalls(group: 'SOLIDS' | 'STRIPES'): readonly number[] {
  return ballsOfGroup(group);
}
