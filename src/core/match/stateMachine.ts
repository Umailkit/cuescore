import type { MatchStatus, Match } from '../types';
import type { MatchCommandType } from '../types';

/**
 * Match lifecycle transitions. The graph is intentionally explicit so illegal
 * jumps are caught early.
 *
 * PLAYING / PAUSED → MATCH_END 是允许的，但它只服务于**管理员动作**
 * `COMPLETE_MATCH`（裁判宣布收场，例如「不限局数」的比赛打到 time-up）。
 * 规则推断出来的整场胜负仍然必须走 FRAME_END → MATCH_END：
 * 那是 Race To 达标或引擎判负的结果，不是人拍脑袋决定的。
 */
const TRANSITIONS: Record<MatchStatus, MatchStatus[]> = {
  SETUP: ['READY', 'CANCELLED'],
  READY: ['PLAYING', 'CANCELLED'],
  PLAYING: ['PAUSED', 'FRAME_END', 'MATCH_END', 'CANCELLED'],
  PAUSED: ['PLAYING', 'MATCH_END', 'CANCELLED'],
  FRAME_END: ['PLAYING', 'MATCH_END', 'CANCELLED'],
  MATCH_END: [],
  CANCELLED: [],
};

export function canTransition(from: MatchStatus, to: MatchStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: MatchStatus, to: MatchStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal match status transition: ${from} → ${to}`);
  }
}

/**
 * For PHASE 1's generic lifecycle commands, returns the intended target status.
 * Returns null when the command does not move the lifecycle (e.g. switching the
 * active player, or an engine scoring command).
 */
export function statusForCommand(cmd: MatchCommandType): MatchStatus | null {
  switch (cmd) {
    case 'START_MATCH':
      return 'PLAYING';
    case 'PAUSE_MATCH':
      return 'PAUSED';
    case 'RESUME_MATCH':
      return 'PLAYING';
    case 'CANCEL_MATCH':
      return 'CANCELLED';
    case 'COMPLETE_FRAME':
      return 'FRAME_END';
    case 'COMPLETE_MATCH':
      return 'MATCH_END';
    default:
      return null;
  }
}

export function isTerminal(status: MatchStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/**
 * Statuses that mean "there is a match still in progress" — used by the home
 * screen's "继续上一场比赛" card. READY/PLAYING/PAUSED/FRAME_END all count;
 * MATCH_END and CANCELLED do not.
 */
export const UNFINISHED_STATUSES: readonly MatchStatus[] = [
  'READY',
  'PLAYING',
  'PAUSED',
  'FRAME_END',
];

export function isUnfinished(status: MatchStatus): boolean {
  return UNFINISHED_STATUSES.includes(status);
}

/** Validate that a match currently allows the given command. */
export function canApplyCommand(match: Match, cmd: MatchCommandType): boolean {
  const target = statusForCommand(cmd);
  if (target === null) return true; // engine commands never blocked by lifecycle
  return canTransition(match.status, target);
}
