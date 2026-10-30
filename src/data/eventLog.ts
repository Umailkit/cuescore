import type { MatchEvent } from '@core/types';

/**
 * The append-only EventLog — the SOURCE OF TRUTH (req #1).
 * Events are never deleted or mutated. Undo/Redo append new audit events.
 */
export interface EventLog {
  append(matchId: string, event: MatchEvent): Promise<void>;
  appendMany(matchId: string, events: MatchEvent[]): Promise<void>;
  listEvents(matchId: string): Promise<MatchEvent[]>;
  clear(matchId: string): Promise<void>;
}
