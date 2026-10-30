/**
 * 九球 —— 领域类型。
 *
 * 与八球一样：这里只描述「当前比赛事实」，全部可 JSON 序列化，
 * 因为要写进 Snapshot、也要能被 EventLog 重放重建。
 * 存在地区/赛事差异的细则一律走 RuleSet.config，不在这里写死。
 */

/** 九球台面上只有 1–9 号。 */
export const NINE_BALL_NUMBERS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
export const NINE_BALL_WIN = 9;
export const CUE_BALL = 0;

export type BallStatus = 'ON_TABLE' | 'POCKETED';

export type FrameStatus = 'PLAYING' | 'WON' | 'LOST';

export type FoulReason =
  /** 先碰到的不是台面最小号球。 */
  | 'WRONG_BALL_FIRST'
  /** 空杆：母球没碰到任何球。 */
  | 'NO_CONTACT'
  /** 母球落袋。 */
  | 'SCRATCH'
  /** 无球进袋且无球碰库（开球/普通杆的常见犯规）。 */
  | 'NO_RAIL'
  /** 其他：由 detail 说明。 */
  | 'OTHER';

export interface FoulRecord {
  occurred: boolean;
  reason?: FoulReason;
  detail?: string;
  ball?: number;
}

export interface PocketRecord {
  ball: number;
  playerIndex: number;
  legal: boolean;
  turnNumber: number;
}

export interface NineBallState {
  /** 1–9 号球状态。 */
  balls: Record<number, BallStatus>;
  activePlayerIndex: number;
  turnNumber: number;

  break: {
    completed: boolean;
    /** 开球这一杆是否已经打完。 */
    shotTaken: boolean;
    playerIndex: number;
  };

  /**
   * Push Out（推杆）。
   * `available` 仅在开球后的第一杆为真；使用后 `used` 置位。
   */
  pushOut: {
    available: boolean;
    used: boolean;
  };

  foul: FoulRecord;
  /**
   * seat -> 本局得分。
   *
   * 只在 `scoringMode = 'points'`（记分制）下使用；标准清台模式下恒为 0，
   * 保留字段是为了让两种模式共用同一个 state 形状（重放不用分支判断类型）。
   */
  points: Record<number, number>;
  /** 每位选手的连续犯规次数（合法击球时归零）。 */
  consecutiveFouls: Record<number, number>;
  /** 犯规后对手是否获得自由球（ball in hand）。 */
  ballInHand: boolean;

  potted: PocketRecord[];
  runCount: number;

  frameStatus: FrameStatus;
  winnerPlayerIndex?: number;
  loserPlayerIndex?: number;
  winReason?: string;
}

export interface NineBallRules {
  /**
   * 计分方式：
   *   - `'points'`   —— 记分制：记分员按「进一颗算几分」加减分，先到 targetPoints 赢局
   *   - `'sequence'` —— 标准清台制：按号序击打，合法打进 9 号球赢局
   *
   * 台球厅里九球多数是记分制，本产品的九球模板默认走 `'points'`。
   */
  scoringMode: 'points' | 'sequence';
  /** 记分制下的目标分（0 = 不按分数判胜，由裁判裁定）。 */
  targetPoints: number;
  /** 开球直接打进 9 号球是否算赢（多数规则：算）。 */
  nineOnBreak: boolean;
  /** 是否启用 Push Out。 */
  pushOut: boolean;
  /** 同一选手连续三次犯规是否判负本局。 */
  threeFoulsLosesFrame: boolean;
  /** 犯规后对手是否获得自由球。 */
  ballInHandOnFoul: boolean;
  /** 开球必须有球进袋或至少 N 颗球碰库。0 = 不校验。 */
  breakRequiresPocketOrRailCount: number;
}

export const DEFAULT_NINE_BALL_RULES: NineBallRules = {
  // 默认仍是标准清台制 —— 老比赛/老事件重放必须保持原语义。
  // 九球的**推荐模板**会显式覆盖成 'points'。
  scoringMode: 'sequence',
  targetPoints: 0,
  nineOnBreak: true,
  pushOut: true,
  threeFoulsLosesFrame: true,
  ballInHandOnFoul: true,
  breakRequiresPocketOrRailCount: 0,
};

export const NINE_BALL_FOUL_LABELS: Record<FoulReason, string> = {
  WRONG_BALL_FIRST: '先碰到的不是最小号球',
  NO_CONTACT: '空杆（母球未碰到任何球）',
  SCRATCH: '母球落袋',
  NO_RAIL: '无球进袋且无球碰库',
  OTHER: '犯规',
};
