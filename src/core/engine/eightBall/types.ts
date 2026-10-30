/**
 * 中式八球 —— 领域类型。
 *
 * 设计原则（PHASE 3A）：
 *  - 这里描述的是「当前比赛事实」，不是 React/UI 状态。
 *  - 所有可变部分都必须是可 JSON 序列化的，因为要写进 Snapshot、也要能被
 *    EventLog 重放重建。
 *  - 规则里存在地区/赛事差异的细节一律走 RuleSet.config，不在这里写死。
 */

/** 球组：全色（1–7）/ 花色（9–15）。8 号球不属于任何一组。 */
export type BallGroup = 'SOLIDS' | 'STRIPES';

/** 球台阶段。 */
export type TableStatus =
  /** 还没人认组，任何非 8 号球都可以先打。 */
  | 'OPEN'
  /** 双方已各自认组。 */
  | 'GROUPS_ASSIGNED'
  /** 有人已清完自己的组，进入打 8 号球阶段。 */
  | 'EIGHT_BALL';

/** 单颗球的状态。 */
export type BallStatus = 'ON_TABLE' | 'POCKETED';

/** 本局结果。 */
export type FrameStatus = 'PLAYING' | 'WON' | 'LOST' | 'RERACK';

/**
 * 犯规原因。统一枚举，避免各处散落字符串。
 * 具体判定允许扩展（OTHER + detail）。
 */
export type FoulReason =
  /** 先碰到的不是本方目标球（含开球后第一次接触犯规）。 */
  | 'WRONG_BALL_FIRST'
  /** 空杆：母球没碰到任何球。 */
  | 'NO_CONTACT'
  /** 母球落袋（scratch）。 */
  | 'SCRATCH'
  /** 非法击打 8 号球（提前打 8 / 打 8 时母球落袋 / 8 号球飞出台面）。 */
  | 'ILLEGAL_EIGHT_BALL'
  /** 开球不合法（未达开球要求，比如没球进袋也没 4 颗球碰库）。 */
  | 'ILLEGAL_BREAK'
  /** 其他：由调用方在 detail 里说明。 */
  | 'OTHER';

/** 犯规记录（一条回合内的判定结果，不是历史 —— 历史在 EventLog）。 */
export interface FoulRecord {
  occurred: boolean;
  reason?: FoulReason;
  /** 人类可读补充说明，便于 RuleTrace / UI 提示。 */
  detail?: string;
  /** 犯规发生时被判罚的球号（如有）。 */
  ball?: number;
}

/** 一次进袋记录（用于本局统计与展示，不是得分）。 */
export interface PocketRecord {
  ball: number;
  /** 打进这颗球时是几号选手（seat index）。 */
  playerIndex: number;
  /** 是否是合法进球（非法进球仍可能发生，比如打进对方球）。 */
  legal: boolean;
  /** 进球时的回合号。 */
  turnNumber: number;
}

/**
 * 一局之内、由引擎独占维护的全部事实。
 *
 * 注意：这里没有任何字段是「比分」。八球的局内没有分数概念，只有
 * 球是否在台上、谁该打、谁赢。分数（局数）属于 Match 层，由 FRAME_WON
 * 事件驱动，绝不在这里累加。
 */
export interface EightBallState {
  /** 16 颗球（含母球 0）。值只有 ON_TABLE / POCKETED。 */
  balls: Record<number, BallStatus>;

  /** seat index → 球组。未分组时为 null。一旦认组不再改变。 */
  groups: Record<number, BallGroup | null>;

  tableStatus: TableStatus;

  activePlayerIndex: number;

  /** 从 1 开始的回合计数（每换手 +1）。 */
  turnNumber: number;

  /** 开球相关。 */
  break: {
    /** 是否已经开过球。 */
    completed: boolean;
    /**
     * 开球这一杆是否已经打完（进袋/空杆）。
     * 用来区分「开球这一杆」（不认组）和「开球之后的正常击球」（可认组）。
     */
    shotTaken: boolean;
    /** 开球是否合法。仅 completed 为 true 时有意义。 */
    legal: boolean;
    /** 开球方 seat index。 */
    playerIndex: number;
  };

  /** 最近一次 Call Shot 指定（可选规则，默认不启用）。 */
  calledBall?: number;
  calledPocket?: string;

  /** 最近一次击球的判定结果（用于 UI 反馈，会被下一次击球覆盖）。 */
  foul: FoulRecord;

  /** 本局内的进球流水（按发生顺序）。 */
  potted: PocketRecord[];

  /**
   * 连续进球计数（同一选手不间断进球的次数）。
   * 仅用于展示与 RuleTrace，不参与胜负判定。
   */
  runCount: number;

  /** 本局胜者 seat index（frameStatus 为 WON 时有效）。 */
  winnerPlayerIndex?: number;
  /** 本局负者 seat index（frameStatus 为 LOST 时有效，即对手胜）。 */
  loserPlayerIndex?: number;

  frameStatus: FrameStatus;

  /** 本局胜因，便于审计与 RuleTrace。 */
  winReason?: string;
}

/** 引擎内部使用的、已解析的规则配置（由 RuleSet.config 归一化而来）。 */
export interface EightBallRules {
  /** 开球必须有球进袋，或至少 N 颗球碰库 —— 地区差异，参数化。 */
  breakRequiresPocketOrRailCount: number;
  /** 开球进球后是否继续击球（多数地区：是）。 */
  breakPocketContinues: boolean;
  /** 开球时打进 8 号球怎么处理：'rerack' | 'win' | 'lose'。 */
  eightOnBreak: 'rerack' | 'win' | 'lose';
  /** 是否启用 Call Shot（指定球+袋）。默认关闭。 */
  callShot: boolean;
  /** 犯规后对手是否拿到自由球（ball in hand）。 */
  ballInHandOnFoul: boolean;
  /**
   * 8 号球进袋但本局不合法时（提前打 8、8 号球与母球同时落袋等），
   * 判定为直接输本局（true）还是仅犯规（false）。多数规则：直接输。
   */
  eightBallEarlyLosesFrame: boolean;
  /** 是否允许「同一杆打进本方球 + 对方球」仅判犯规不换手。 */
  opponentBallPocketedIsFoul: boolean;
}

export const DEFAULT_EIGHT_BALL_RULES: EightBallRules = {
  breakRequiresPocketOrRailCount: 4,
  breakPocketContinues: true,
  eightOnBreak: 'rerack',
  callShot: false,
  ballInHandOnFoul: true,
  eightBallEarlyLosesFrame: true,
  opponentBallPocketedIsFoul: false,
};

/** 母球编号，单独提出来避免散落的魔法数字。 */
export const CUE_BALL = 0;
export const EIGHT_BALL = 8;
export const LOW_BALL = 1;
export const HIGH_BALL = 15;

/** 全部目标球编号（不含母球）。 */
export const OBJECT_BALLS: readonly number[] = Array.from(
  { length: HIGH_BALL },
  (_, i) => i + LOW_BALL,
);

/** 全色球：1–7。 */
export const SOLIDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

/** 花色球：9–15。 */
export const STRIPES: readonly number[] = [9, 10, 11, 12, 13, 14, 15];
