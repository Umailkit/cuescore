import type { IDBPDatabase } from 'idb';
import type { MatchEvent } from '@core/types';
import type { EventLog } from '../eventLog';
import { openCueScoreDB, type CueScoreDB } from './db';

export class IdbEventLog implements EventLog {
  private dbp: Promise<IDBPDatabase<CueScoreDB>>;

  constructor(dbp: Promise<IDBPDatabase<CueScoreDB>> = openCueScoreDB()) {
    this.dbp = dbp;
  }

  async append(matchId: string, event: MatchEvent): Promise<void> {
    const db = await this.dbp;
    await db.put('events', { ...event, matchId });
  }

  async appendMany(matchId: string, events: MatchEvent[]): Promise<void> {
    const db = await this.dbp;
    const tx = db.transaction('events', 'readwrite');
    for (const e of events) {
      await tx.store.put({ ...e, matchId });
    }
    await tx.done;
  }

  async listEvents(matchId: string): Promise<MatchEvent[]> {
    const db = await this.dbp;
    const all = await db.getAllFromIndex('events', 'by-match', matchId);
    // Deterministic order: `seq` is authoritative (several events may share a
    // millisecond, and sorting only by timestamp is not stable). Events written
    // before `seq` existed fall back to timestamp and keep their index order.
    return all
      .map((e, i) => ({ e, i }))
      .sort((a, b) => {
        const sa = typeof a.e.seq === 'number' ? a.e.seq : Number.POSITIVE_INFINITY;
        const sb = typeof b.e.seq === 'number' ? b.e.seq : Number.POSITIVE_INFINITY;
        if (sa !== sb) return sa - sb;
        if (a.e.timestamp !== b.e.timestamp) return a.e.timestamp - b.e.timestamp;
        return a.i - b.i;
      })
      .map((x) => x.e);
  }

  async clear(matchId: string): Promise<void> {
    const db = await this.dbp;
    const all = await db.getAllFromIndex('events', 'by-match', matchId);
    const tx = db.transaction('events', 'readwrite');
    for (const e of all) await tx.store.delete(e.id);
    await tx.done;
  }
}
