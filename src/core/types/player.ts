/**
 * Player entity (persisted, long-lived) and its rolling statistics.
 *
 * Q6: anonymous/temporary players are ALLOWED into statistics. A later merge
 * into a real Player must NOT mutate historical matches — matches store a
 * `MatchPlayer` display-name snapshot (see match.ts), never a live reference.
 */
export interface PlayerStats {
  matches: number;
  wins: number;
  losses: number;
  framesWon: number;
  framesLost: number;
  highestBreak: number;
  longestStreak: number;
  totalPoints: number;
  lastMatchAt?: number;
}

export interface Player {
  id: string;
  name: string;
  avatar?: string;
  nickname?: string;
  createdAt: number;
  updatedAt: number;
  /** Q6: true for on-the-fly players created inside a match. */
  isAnonymous?: boolean;
  /** Soft-delete flag: archived players stay for history but hide from pickers. */
  archived?: boolean;
  /** Last time this player was used in / selected for a match (for "recent"). */
  lastUsedAt?: number;
  stats: PlayerStats;
}

export function emptyStats(): PlayerStats {
  return {
    matches: 0,
    wins: 0,
    losses: 0,
    framesWon: 0,
    framesLost: 0,
    highestBreak: 0,
    longestStreak: 0,
    totalPoints: 0,
  };
}
