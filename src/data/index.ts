import { openCueScoreDB } from './indexeddb/db';
import { IdbRepository } from './indexeddb/idbRepository';
import { IdbEventLog } from './indexeddb/idbEventLog';
import { IdbSnapshotStore } from './indexeddb/idbSnapshot';
import type { Repository } from './repository';
import type { EventLog } from './eventLog';
import type { SnapshotStore } from './snapshot';

export interface Repositories {
  repository: Repository;
  eventLog: EventLog;
  snapshot: SnapshotStore;
}

/**
 * Single composition root for persistence. Tests inject a fake-indexeddb-backed
 * DB by overriding the default openCueScoreDB via the constructors, but in the
 * app we just build the IndexedDB-backed trio here.
 */
export function createRepositories(): Repositories {
  const dbp = openCueScoreDB();
  return {
    repository: new IdbRepository(dbp),
    eventLog: new IdbEventLog(dbp),
    snapshot: new IdbSnapshotStore(dbp),
  };
}

export { reconstructMatchFromEvents } from './recovery';
export type { Repository } from './repository';
export type { EventLog } from './eventLog';
export type { SnapshotStore, SnapshotRecord } from './snapshot';
