import type { BallGroup, EightBallState, TableStatus } from './types';
import {
  CUE_BALL,
  EIGHT_BALL,
  HIGH_BALL,
  LOW_BALL,
  SOLIDS,
  STRIPES,
} from './types';

/**
 * 球编号 → 球组。
 *
 * 刻意写成查表 + 区间判断，而不是一堆 if/else：
 *   0     → null（母球，不属于任何组）
 *   1–7   → SOLIDS
 *   8     → null（8 号球不属于任何组，是「黑八」）
 *   9–15  → STRIPES
 *   其它   → null（非法球号）
 */
export function getBallGroup(ballNumber: number): BallGroup | null {
  if (!Number.isInteger(ballNumber)) return null;
  if (ballNumber >= LOW_BALL && ballNumber <= 7) return 'SOLIDS';
  if (ballNumber >= 9 && ballNumber <= HIGH_BALL) return 'STRIPES';
  return null;
}

/** 是否是合法目标球编号（1–15）。 */
export function isObjectBall(ballNumber: number): boolean {
  return Number.isInteger(ballNumber) && ballNumber >= LOW_BALL && ballNumber <= HIGH_BALL;
}

/** 是否母球。 */
export function isCueBall(ballNumber: number): boolean {
  return ballNumber === CUE_BALL;
}

/** 是否是 8 号球。 */
export function isEightBall(ballNumber: number): boolean {
  return ballNumber === EIGHT_BALL;
}

/** 反查：某个组对应的球号列表。 */
export function ballsOfGroup(group: BallGroup): readonly number[] {
  return group === 'SOLIDS' ? SOLIDS : STRIPES;
}

/** 对手的组。 */
export function oppositeGroup(group: BallGroup): BallGroup {
  return group === 'SOLIDS' ? 'STRIPES' : 'SOLIDS';
}

/** 该组还剩多少颗在台上。 */
export function remainingInGroup(state: EightBallState, group: BallGroup): number {
  return ballsOfGroup(group).filter((b) => state.balls[b] === 'ON_TABLE').length;
}

/** 该选手自己的组还剩多少颗（未分组时返回 0）。 */
export function remainingForPlayer(state: EightBallState, playerIndex: number): number {
  const group = state.groups[playerIndex] ?? null;
  if (!group) return 0;
  return remainingInGroup(state, group);
}

/** 球台上还剩多少颗目标球（不含母球、不含 8 号球）。 */
export function remainingObjectBalls(state: EightBallState): number {
  return SOLIDS.concat(STRIPES).filter((b) => state.balls[b] === 'ON_TABLE').length;
}

/** 8 号球是否还在台上。 */
export function isEightBallOnTable(state: EightBallState): boolean {
  return state.balls[EIGHT_BALL] === 'ON_TABLE';
}

/**
 * 当前选手的合法目标球 —— 引擎算，UI 只展示。
 *
 * 规则：
 *  - 球台 OPEN：除 8 号球外的所有在台球都合法（先碰哪颗都不算「先碰错球」）。
 *  - 已分组：本方组里还在台上的球。
 *  - 本方组已清空（进入 EIGHT_BALL）：只剩 8 号球。
 *  - 已分胜负：无合法目标。
 */
export function getLegalTargetBalls(
  state: EightBallState,
  playerIndex: number,
): number[] {
  if (state.frameStatus !== 'PLAYING') return [];

  // 开球之前没有任何「合法目标」：本局还没有第一杆。
  // 这不只是 UI 的禁用态 —— 规则上开球前的任何击球都不成立，
  // 所以合法目标必须由引擎回答为空，UI 只负责照着禁用。
  if (!state.break.completed) return [];

  if (state.tableStatus === 'OPEN') {
    return SOLIDS.concat(STRIPES).filter((b) => state.balls[b] === 'ON_TABLE');
  }

  if (state.tableStatus === 'EIGHT_BALL') {
    return isEightBallOnTable(state) ? [EIGHT_BALL] : [];
  }

  // GROUPS_ASSIGNED
  const group = state.groups[playerIndex] ?? null;
  if (!group) {
    // 分组已成立但该位没组（数据异常），退回「所有在台目标球」保持可用。
    return SOLIDS.concat(STRIPES).filter((b) => state.balls[b] === 'ON_TABLE');
  }
  const own = ballsOfGroup(group).filter((b) => state.balls[b] === 'ON_TABLE');
  if (own.length > 0) return own;
  // 本方已清空 → 目标变成 8 号球（即便 tableStatus 还没翻，也视为合法）。
  return isEightBallOnTable(state) ? [EIGHT_BALL] : [];
}

/** 是否已进入打 8 号球阶段（按实际球况判断，不只看 tableStatus 字段）。 */
export function shouldEnterEightBallPhase(state: EightBallState): boolean {
  if (state.tableStatus === 'OPEN') return false;
  // 任意一方已清空自己的组，就进入 8 号球阶段。
  return Object.keys(state.groups).some((k) => {
    const idx = Number(k);
    const group = state.groups[idx] ?? null;
    return group !== null && remainingInGroup(state, group) === 0;
  });
}

/** 把 8 号球阶段同步进 tableStatus（幂等）。 */
export function syncTableStatus(state: EightBallState): TableStatus {
  // Groups may have just been assigned by this very shot, so decide from the
  // groups themselves rather than trusting the previous tableStatus flag.
  const anyAssigned = Object.values(state.groups).some((g) => g !== null);
  if (!anyAssigned) return 'OPEN';
  return shouldEnterEightBallPhase(state) ? 'EIGHT_BALL' : 'GROUPS_ASSIGNED';
}

/**
 * 分组判定：本次合法击球后，是否应当认组。
 *
 * 规则（CueScore Standard）：
 *  - 只有球台处于 OPEN 时才可能认组。
 *  - 开球这一杆不认组（开球进球不定组），这是多数地区的做法，因此参数里
 *    用 `isBreak` 区分。
 *  - 其余情况：同一杆里只进了某一组（且没有同时进对方组），就认这一组。
 *  - 同时进了两组 → 不认组（继续保持 OPEN）。
 */
export function resolveGroupAssignment(
  pottedBalls: number[],
  isBreak: boolean,
): { assign: boolean; group: BallGroup | null } {
  if (isBreak) return { assign: false, group: null };
  const groups = pottedBalls
    .map((b) => getBallGroup(b))
    .filter((g): g is BallGroup => g !== null);
  if (groups.length === 0) return { assign: false, group: null };
  const unique = [...new Set(groups)];
  if (unique.length !== 1) return { assign: false, group: null };
  return { assign: true, group: unique[0] ?? null };
}

/**
 * 给双方分配球组。调用方保证这是「首次认组」；一旦分组，不再允许修改。
 * 返回新对象，不修改入参（引擎是纯函数）。
 */
export function assignGroups(
  state: EightBallState,
  playerIndex: number,
  group: BallGroup,
): EightBallState {
  const next: Record<number, BallGroup | null> = { ...state.groups };
  next[playerIndex] = group;
  const opponent = 1 - playerIndex;
  // 两人对局时对手自动拿另一组。多于两人（未来扩展）时留空，由后续规则补。
  if (next[opponent] === undefined || next[opponent] === null) {
    if (Object.keys(next).length <= 2) next[opponent] = oppositeGroup(group);
  }
  return { ...state, groups: next };
}
