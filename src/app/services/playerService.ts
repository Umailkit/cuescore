import type { Player } from '@core/types';
import { emptyStats } from '@core/types';
import { createId } from '@core/util/id';
import type { Repositories } from '@data/index';
import { repos as defaultRepos } from '../repos';

export interface CreatePlayerInput {
  name: string;
  nickname?: string;
  avatar?: string;
  /** Q6: players created on the fly inside a match are flagged anonymous. */
  isAnonymous?: boolean;
}

export interface ListPlayersOptions {
  /** Include archived players (default false). */
  includeArchived?: boolean;
  /** Free-text match against name / nickname (case-insensitive). */
  query?: string;
  /** Only return the N most recently used. */
  limit?: number;
}

/**
 * Player domain service. Owns Player CRUD.
 *
 * IMPORTANT (Q6 / PHASE 0 decision): renaming a Player here must NEVER rewrite
 * history. Matches store a frozen `MatchPlayer.displayName` snapshot, so a
 * player renamed 张三 → 张三丰 still shows 张三 in past matches. This service
 * therefore never touches persisted matches.
 */
export class PlayerService {
  private repos: Repositories;

  constructor(repos: Repositories = defaultRepos) {
    this.repos = repos;
  }

  async create(input: CreatePlayerInput): Promise<Player> {
    const name = input.name.trim();
    if (!name) throw new Error('Player name is required');

    const now = Date.now();
    const player: Player = {
      id: createId('p'),
      name,
      createdAt: now,
      updatedAt: now,
      stats: emptyStats(),
    };
    if (input.nickname !== undefined) player.nickname = input.nickname.trim() || undefined;
    if (input.avatar !== undefined) player.avatar = input.avatar;
    if (input.isAnonymous) player.isAnonymous = true;

    await this.repos.repository.putPlayer(player);
    return player;
  }

  async update(
    id: string,
    patch: { name?: string; nickname?: string; avatar?: string },
  ): Promise<Player> {
    const existing = await this.repos.repository.getPlayer(id);
    if (!existing) throw new Error(`Player not found: ${id}`);

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new Error('Player name is required');
      existing.name = name;
    }
    if (patch.nickname !== undefined) existing.nickname = patch.nickname.trim() || undefined;
    if (patch.avatar !== undefined) existing.avatar = patch.avatar;

    existing.updatedAt = Date.now();
    await this.repos.repository.putPlayer(existing);
    return existing;
  }

  /** Soft delete: player stays in the DB (history intact) but hides from pickers. */
  async archive(id: string): Promise<Player> {
    return this.setArchived(id, true);
  }

  async unarchive(id: string): Promise<Player> {
    return this.setArchived(id, false);
  }

  private async setArchived(id: string, archived: boolean): Promise<Player> {
    const existing = await this.repos.repository.getPlayer(id);
    if (!existing) throw new Error(`Player not found: ${id}`);
    existing.archived = archived;
    existing.updatedAt = Date.now();
    await this.repos.repository.putPlayer(existing);
    return existing;
  }

  /** Hard delete — only safe for players never used in a match. */
  async remove(id: string): Promise<void> {
    await this.repos.repository.deletePlayer(id);
  }

  async get(id: string): Promise<Player | null> {
    return this.repos.repository.getPlayer(id);
  }

  async list(opts: ListPlayersOptions = {}): Promise<Player[]> {
    let players = await this.repos.repository.listPlayers({
      includeArchived: opts.includeArchived ?? false,
    });

    const q = opts.query?.trim().toLowerCase();
    if (q) {
      players = players.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.nickname ?? '').toLowerCase().includes(q),
      );
    }
    if (opts.limit !== undefined) players = players.slice(0, opts.limit);
    return players;
  }

  /** Players used in a match, most recent first (for the "最近使用" picker row). */
  async recent(limit = 6): Promise<Player[]> {
    const players = await this.repos.repository.listPlayers({ includeArchived: false });
    return players.filter((p) => p.lastUsedAt !== undefined).slice(0, limit);
  }

  /**
   * Stamp `lastUsedAt` on the players referenced by a newly created match.
   * Called by MatchService after a match is created — keeps recency ordering
   * accurate without touching the frozen MatchPlayer snapshots.
   */
  async touch(playerIds: string[]): Promise<void> {
    const now = Date.now();
    for (const id of playerIds) {
      const p = await this.repos.repository.getPlayer(id);
      if (!p) continue;
      p.lastUsedAt = now;
      p.updatedAt = now;
      await this.repos.repository.putPlayer(p);
    }
  }
}

export const playerService = new PlayerService();
