import type { IDBPDatabase } from 'idb';
import type { Match } from '@core/types';
import type { SnapshotStore, SnapshotRecord } from '../snapshot';
import { openCueScoreDB, type CueScoreDB } from './db';

export class IdbSnapshotStore implements SnapshotStore {
  private dbp: Promise<IDBPDatabase<CueScoreDB>>;

  constructor(dbp: Promise<IDBPDatabase<CueScoreDB>> = openCueScoreDB()) {
    this.dbp = dbp;
  }

  async save(matchId: string, state: Match): Promise<void> {
    const db = await this.dbp;
    const existing = await db.get('snapshots', matchId);
    const record: SnapshotRecord = {
      matchId,
      state,
      updatedAt: Date.now(),
      version: (existing?.version ?? 0) + 1,
    };
    await db.put('snapshots', record);
  }

  async load(matchId: string): Promise<Match | null> {
    const db = await this.dbp;
    const rec = await db.get('snapshots', matchId);
    return rec ? rec.state : null;
  }

  async delete(matchId: string): Promise<void> {
    const db = await this.dbp;
    await db.delete('snapshots', matchId);
  }
}
