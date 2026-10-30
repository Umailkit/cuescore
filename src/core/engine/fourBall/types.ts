/**
 * 四球 —— 领域类型。
 *
 * 四球在本产品里采用**追分口径**（见 `chase.ts`）：命中五种得分类型之一，
 * 由上家 / 下家按表赔付，本家拿净得分。整场累计，不分局重置。
 *
 * 仍然保留 `SCORE` / `ADJUST_SCORE` 两个通用入口：
 *   - `SCORE` 兼容老事件与「就加一分」的临时场景
 *   - `ADJUST_SCORE` 是记错了改账用（正加负减）
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
  /** 加分来源：'pot' 进袋 / 'foul' 对手犯规 / 'manual' 手工订正 / 'chase' 追分结算。 */
  source: 'pot' | 'foul' | 'manual' | 'chase';
  /** source='chase' 时记录得分类型（普胜/小金/大金/黄金九/黑金）。 */
  chaseKind?: string;
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
  /** 达到多少分结束本局；`0` = 不按目标分结束（追分整场累计）。 */
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
