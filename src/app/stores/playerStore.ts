import { create } from 'zustand';
import type { Player } from '@core/types';
import { PlayerService, type CreatePlayerInput } from '../services/playerService';

const service = new PlayerService();

interface PlayerStore {
  players: Player[];
  loading: boolean;
  error: string | null;

  refresh: () => Promise<void>;
  create: (input: CreatePlayerInput) => Promise<Player>;
  update: (
    id: string,
    patch: { name?: string; nickname?: string },
  ) => Promise<void>;
  archive: (id: string) => Promise<void>;
  unarchive: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/**
 * UI-facing player state. All mutations go through PlayerService → Repository;
 * the UI layer never touches IndexedDB directly.
 */
export const usePlayerStore = create<PlayerStore>((set, get) => ({
  players: [],
  loading: false,
  error: null,

  async refresh() {
    set({ loading: true, error: null });
    try {
      const players = await service.list();
      set({ players, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  async create(input) {
    const player = await service.create(input);
    set({ players: [player, ...get().players] });
    return player;
  },

  async update(id, patch) {
    const updated = await service.update(id, patch);
    set({
      players: get().players.map((p) => (p.id === id ? updated : p)),
    });
  },

  async archive(id) {
    await service.archive(id);
    set({ players: get().players.filter((p) => p.id !== id) });
  },

  async unarchive(id) {
    const player = await service.unarchive(id);
    set({ players: [player, ...get().players] });
  },

  async remove(id) {
    await service.remove(id);
    set({ players: get().players.filter((p) => p.id !== id) });
  },
}));
