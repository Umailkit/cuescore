import { useEffect, useState } from 'react';
import type { GameType, Match } from '@core/types';
import { repos } from '../repos';

/**
 * Lightweight read hook for the matches list (history / home recents).
 * Not subscribed to live updates in PHASE 1 — refetch by remounting or calling
 * the returned `refresh`.
 */
export function useMatches(opts?: { limit?: number; gameType?: GameType }) {
  const { limit, gameType } = opts ?? {};
  const [matches, setMatches] = useState<Match[]>([]);

  useEffect(() => {
    let active = true;
    repos.repository
      .listMatches(gameType ? { gameType } : undefined)
      .then((all) => {
        if (active) setMatches(limit ? all.slice(0, limit) : all);
      })
      .catch(() => {
        if (active) setMatches([]);
      });
    return () => {
      active = false;
    };
  }, [limit, gameType]);

  return matches;
}
