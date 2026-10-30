import type { Match, Player, GameType } from '@core/types';

export interface MatchRepository {
  putMatch(match: Match): Promise<void>;
  getMatch(id: string): Promise<Match | null>;
  listMatches(filter?: { gameType?: GameType }): Promise<Match[]>;
  deleteMatch(id: string): Promise<void>;
}

export interface PlayerRepository {
  putPlayer(player: Player): Promise<void>;
  getPlayer(id: string): Promise<Player | null>;
  /**
   * List players. Archived players are hidden by default (they remain in the DB
   * so historical matches keep resolving); pass `includeArchived` to see them.
   */
  listPlayers(opts?: { includeArchived?: boolean }): Promise<Player[]>;
  /** Hard delete. Only used for players that were never referenced by a match. */
  deletePlayer(id: string): Promise<void>;
}

/**
 * Storage abstraction. The app depends ONLY on this interface, never on
 * IndexedDB directly — so a Supabase / Postgres repository can be swapped in
 * later (req: storage layer replaceable) without touching domain or UI.
 */
export interface Repository extends MatchRepository, PlayerRepository {}
