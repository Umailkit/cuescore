/**
 * 六球 —— 领域类型。
 *
 * 说明：六球没有行业统一规则。本引擎实现的是 **CueScore Standard 口径**
 * （模板里已注明「本产品默认口径，非行业统一规则」）：
 *   - 台面 1–6 号球，每打进一颗得 `perBall` 分（默认 1）
 *   - 先达到 `targetPoints` 分者赢下本局
 *   - 犯规由对手获得 `foulPenalty` 分（默认 1）
 *
 * 所有差异项走 RuleSet.config，不在代码里写死。
 */

export const SIX_BALL_NUMBERS: readonly number[] = [1, 2, 3, 4, 5, 6];
export const CUE_BALL = 0;

export type BallStatus = 'ON_TABLE' | 'POCKETED';
export type FrameStatus = 'PLAYING' | 'WON' | 'LOST';

export type FoulReason =
  /** 空杆：母球没碰到任何球。 */
  | 'NO_CONTACT'
  /** 母球落袋。 */
  | 'SCRATCH'
  /** 先碰到的不是本方目标球。 */
  | 'WRONG_BALL_FIRST'
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
  /** 这一杆记了多少分。 */
  points: number;
}

export interface SixBallState {
  balls: Record<number, BallStatus>;
  activePlayerIndex: number;
  turnNumber: number;
  /** seat index → 本局累计得分。 */
  points: Record<number, number>;
  break: { completed: boolean; shotTaken: boolean; playerIndex: number };
  foul: FoulRecord;
  potted: PocketRecord[];
  runCount: number;
  frameStatus: FrameStatus;
  winnerPlayerIndex?: number;
  loserPlayerIndex?: number;
  winReason?: string;
}

export interface SixBallRules {
  /** 每颗球的分值。 */
  perBall: number;
  /** 达到多少分赢下本局。 */
  targetPoints: number;
  /** 犯规时对手加多少分。 */
  foulPenalty: number;
  /** 犯规后是否换手。 */
  foulSwitchesTurn: boolean;
}

export const DEFAULT_SIX_BALL_RULES: SixBallRules = {
  perBall: 1,
  targetPoints: 7,
  foulPenalty: 1,
  foulSwitchesTurn: true,
};

export const SIX_BALL_FOUL_LABELS: Record<FoulReason, string> = {
  NO_CONTACT: '空杆（母球未碰到任何球）',
  SCRATCH: '母球落袋',
  WRONG_BALL_FIRST: '先碰到的不是目标球',
  OTHER: '犯规',
};
