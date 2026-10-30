import type { IDBPDatabase } from 'idb';
import type { Match, Player, GameType } from '@core/types';
import type { Repository } from '../repository';
import { openCueScoreDB, type CueScoreDB } from './db';

export class IdbRepository implements Repository {
  private dbp: Promise<IDBPDatabase<CueScoreDB>>;

  constructor(dbp: Promise<IDBPDatabase<CueScoreDB>> = openCueScoreDB()) {
    this.dbp = dbp;
  }

  async putMatch(match: Match): Promise<void> {
    const db = await this.dbp;
    await db.put('matches', match);
  }

  async getMatch(id: string): Promise<Match | null> {
    const db = await this.dbp;
    return (await db.get('matches', id)) ?? null;
  }

  async listMatches(filter?: { gameType?: GameType }): Promise<Match[]> {
    const db = await this.dbp;
    const all = await db.getAll('matches');
    const sorted = all.sort((a, b) => b.updatedAt - a.updatedAt);
    return filter?.gameType ? sorted.filter((m) => m.gameType === filter.gameType) : sorted;
  }

  async deleteMatch(id: string): Promise<void> {
    const db = await this.dbp;
    await db.delete('matches', id);
    await db.delete('snapshots', id);
  }

  async putPlayer(player: Player): Promise<void> {
    const db = await this.dbp;
    await db.put('players', player);
  }

  async getPlayer(id: string): Promise<Player | null> {
    const db = await this.dbp;
    return (await db.get('players', id)) ?? null;
  }

  async listPlayers(opts?: { includeArchived?: boolean }): Promise<Player[]> {
    const db = await this.dbp;
    const all = await db.getAll('players');
    const visible = opts?.includeArchived ? all : all.filter((p) => !p.archived);
    return visible.sort((a, b) => {
      // most-recently-used first, then most-recently-updated
      const au = a.lastUsedAt ?? 0;
      const bu = b.lastUsedAt ?? 0;
      if (au !== bu) return bu - au;
      return b.updatedAt - a.updatedAt;
    });
  }

  async deletePlayer(id: string): Promise<void> {
    const db = await this.dbp;
    await db.delete('players', id);
  }
}
