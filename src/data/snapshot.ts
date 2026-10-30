import type { Match } from '@core/types';

export interface SnapshotRecord {
  matchId: string;
  /** Cached current state for FAST recovery. NOT the source of truth. */
  state: Match;
  updatedAt: number;
  /** Bumped on every save; enables optimistic-concurrency checks later. */
  version: number;
}

/**
 * Snapshot store — a fast recovery cache (req #1).
 * If this is missing or corrupt, the match must be reconstructable by replaying
 * the EventLog. Never treat a snapshot as authoritative.
 */
export interface SnapshotStore {
  save(matchId: string, state: Match): Promise<void>;
  load(matchId: string): Promise<Match | null>;
  delete(matchId: string): Promise<void>;
}
