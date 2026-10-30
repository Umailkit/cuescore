/**
 * 四球 —— 领域类型。
 *
 * 说明：四球同样没有行业统一规则。本引擎实现 **CueScore Standard 口径**
 * （模板已注明「本产品默认口径，非行业统一规则」）：
 *   - 这是一个**纯加分制**游戏：记分员直接点 +1 / +2 / +3 / 自定义分值
 *   - 先达到 `targetPoints` 分者获胜
 *   - 犯规默认「对手 +1」（config.foul）
 *
 * 与六球的区别：六球靠「打进哪颗球」推导出分数；四球的分值由记分员直接给，
 * 引擎不推断球号含义 —— 这也是模板里写「+1 / +2 / +3 / 自定义加分」的原因。
 */

export type FrameStatus = 'PLAYING' | 'WON' | 'LOST';

export type FoulReason =
  | 'NO_CONTACT'
  | 'SCRATCH'
  | 'WRONG_BALL_FIRST'
  | 'OTHER';

export interface FoulRecord {
  occurred: boolean;
  reason?: FoulReason;
  detail?: string;
}

/** 一次加分记录（同时进 EventLog，保证可重放）。 */
export interface ScoreRecord {
  playerIndex: number;
  points: number;
  turnNumber: number;
  /** 加分来源：'pot' 进袋 / 'foul' 对手犯规 / 'manual' 手工。 */
  source: 'pot' | 'foul' | 'manual';
  /** 可选的球号（四球不解释它，只做留痕）。 */
  ball?: number;
}

export interface FourBallState {
  activePlayerIndex: number;
  turnNumber: number;
  /** seat index → 累计得分。 */
  points: Record<number, number>;
  /** 加分流水。 */
  scoreLog: ScoreRecord[];
  foul: FoulRecord;
  runCount: number;
  frameStatus: FrameStatus;
  winnerPlayerIndex?: number;
  loserPlayerIndex?: number;
  winReason?: string;
}

export interface FourBallRules {
  /** 快捷加分档位。 */
  scoring: { p1: number; p2: number; p3: number; custom: number };
  /** 犯规处理：'opponent_plus_1' | 'opponent_plus_n' | 'none'。 */
  foul: 'opponent_plus_1' | 'opponent_plus_n' | 'none';
  /** 'opponent_plus_n' 时对手加多少分。 */
  foulPenalty: number;
  /** 达到多少分赢下本局。 */
  targetPoints: number;
  /** 犯规后是否换手。 */
  foulSwitchesTurn: boolean;
}

export const DEFAULT_FOUR_BALL_RULES: FourBallRules = {
  scoring: { p1: 1, p2: 2, p3: 3, custom: 0 },
  foul: 'opponent_plus_1',
  foulPenalty: 1,
  targetPoints: 15,
  foulSwitchesTurn: true,
};

export const FOUR_BALL_FOUL_LABELS: Record<FoulReason, string> = {
  NO_CONTACT: '空杆（母球未碰到任何球）',
  SCRATCH: '母球落袋',
  WRONG_BALL_FIRST: '先碰到的不是目标球',
  OTHER: '犯规',
};
