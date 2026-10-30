/**
 * 斯诺克 —— 领域类型。
 *
 * 唯一事实来源是 `docs/rules/snooker.md`，那里的每一条
 * 「规则说明 → 状态转换 → Event → Unit Test」都必须在引擎里有对应实现。
 *
 * 第一版只实现标准 15 红。`6-red` 仅预留 RuleSet（config.variant），不进入实现。
 */

/** 球名与分值。红球 1 分，彩球 2–7 分。 */
export const BALL_VALUES = {
  red: 1,
  yellow: 2,
  green: 3,
  brown: 4,
  blue: 5,
  pink: 6,
  black: 7,
} as const;

export type ColourName = 'yellow' | 'green' | 'brown' | 'blue' | 'pink' | 'black';
export type BallName = 'red' | ColourName;

/** 彩球阶段必须按分值由低到高打。 */
export const COLOUR_ORDER: readonly ColourName[] = [
  'yellow',
  'green',
  'brown',
  'blue',
  'pink',
  'black',
];

export const RED_COUNT = 15;

/** 单杆满分：15 红各配黑（15×8=120）+ 彩球 27 = 147。 */
export const MAX_BREAK = RED_COUNT * (BALL_VALUES.red + BALL_VALUES.black) + 27;

export type Stage = 'reds' | 'colours';

export interface SnookerState {
  /** 红球阶段 / 彩球阶段。 */
  stage: Stage;
  /** 台面剩余红球数 0..15。 */
  redsRemaining: number;
  /** 彩球是否还在台面上（彩球阶段被清掉后不再放回）。 */
  coloursOnTable: Record<ColourName, boolean>;

  /** seat index → 本局局分。 */
  scores: Record<number, number>;
  /** seat index → 当前单杆（连续得分）。 */
  breaks: Record<number, number>;
  /** seat index → 本场最高单杆。 */
  highestBreak: Record<number, number>;

  activePlayerIndex: number;
  turnNumber: number;

  /** 自由球标记。 */
  freeBall: boolean;
  /** 犯规后是否形成斯诺克（用于派生统计）。 */
  snookered: boolean;

  /**
   * 红球阶段：本杆是否已打进红球、正等着打彩球。
   *
   * 光靠 `lastColourOnBreak` 推不出来 —— `null` 既可能表示「刚打进红球」，
   * 也可能表示「本杆还没开始」。两者对下一杆的合法性要求正好相反。
   */
  expectingColour: boolean;
  /** 本杆已打彩球的分值（用于 End Break 校验与展示）。 */
  lastColourOnBreak: number | null;

  frameComplete: boolean;
  matchComplete: boolean;

  winnerPlayerIndex?: number;
  loserPlayerIndex?: number;
  winReason?: string;
}

export interface SnookerRules {
  /** '15-red' 已实现；'6-red' 仅预留。 */
  variant: '15-red' | '6-red';
  /** 犯规最低罚分（标准 4 分）。 */
  minFoulPenalty: number;
  /** 是否启用自由球。 */
  freeBall: boolean;
  /** 落后方是否需要做斯诺克才可能翻盘（用于派生统计）。 */
  snookersRequired: boolean;
}

export const DEFAULT_SNOOKER_RULES: SnookerRules = {
  variant: '15-red',
  minFoulPenalty: 4,
  freeBall: true,
  snookersRequired: true,
};

/** 台面剩余可得分数：红球阶段 = 红数×8 + 27；彩球阶段 = 剩余彩球之和。 */
export function pointsRemaining(state: SnookerState): number {
  if (state.stage === 'reds') {
    return state.redsRemaining * (BALL_VALUES.red + BALL_VALUES.black) + 27;
  }
  return COLOUR_ORDER.reduce(
    (sum, c) => sum + (state.coloursOnTable[c] ? BALL_VALUES[c] : 0),
    0,
  );
}

/** 彩球阶段当前应打的彩球（分值最低的在台彩球）。 */
export function nextColour(state: SnookerState): ColourName | null {
  for (const c of COLOUR_ORDER) {
    if (state.coloursOnTable[c]) return c;
  }
  return null;
}

/**
 * 所需斯诺克数。
 *
 * 每次做成斯诺克最少让对手罚 4 分、自己至少再得 1 分，净追回最少按 8 分算
 * 是常见口径；本引擎按文档给定的公式：
 *   snookersRequired = ceil((diff - pointsRemaining) / 2)
 * （文档 2.10 明确「每次斯诺克最少追回 2 分净差」）
 */
export function snookersRequired(state: SnookerState, playerIndex: number): number {
  const opponent = 1 - playerIndex;
  const diff = (state.scores[opponent] ?? 0) - (state.scores[playerIndex] ?? 0);
  if (diff <= 0) return 0;
  const gap = diff - pointsRemaining(state);
  if (gap <= 0) return 0;
  return Math.ceil(gap / 2);
}
