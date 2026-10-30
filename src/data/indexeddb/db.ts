import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Match, Player, MatchEvent } from '@core/types';
import type { SnapshotRecord } from '../snapshot';

/**
 * CueScore IndexedDB schema (PHASE 1).
 *  - matches:   canonical match records (used for history listing)
 *  - players:   long-lived player entities + stats
 *  - events:    append-only EventLog, indexed by matchId
 *  - snapshots: fast-recovery cache of current match state
 */
export interface CueScoreDB extends DBSchema {
  matches: { key: string; value: Match };
  players: { key: string; value: Player };
  events: { key: string; value: MatchEvent; indexes: { 'by-match': string } };
  snapshots: { key: string; value: SnapshotRecord };
}

export const DB_NAME = 'cuescore';
export const DB_VERSION = 1;

export function openCueScoreDB(): Promise<IDBPDatabase<CueScoreDB>> {
  return openDB<CueScoreDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('matches')) {
        db.createObjectStore('matches', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('players')) {
        db.createObjectStore('players', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('events')) {
        const ev = db.createObjectStore('events', { keyPath: 'id' });
        ev.createIndex('by-match', 'matchId');
      }
      if (!db.objectStoreNames.contains('snapshots')) {
        db.createObjectStore('snapshots', { keyPath: 'matchId' });
      }
    },
  });
}
