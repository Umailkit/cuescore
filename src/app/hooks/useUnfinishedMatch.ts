import { useCallback, useEffect, useState } from 'react';
import type { Match } from '@core/types';
import { isUnfinished } from '@core/match/stateMachine';
import { repos } from '../repos';

/**
 * Finds the most recently touched unfinished match (READY / PLAYING / PAUSED /
 * FRAME_END) so the home screen can offer "继续上一场比赛".
 *
 * Reads through the Repository abstraction only — the UI never touches
 * IndexedDB directly (architecture boundary).
 */
export function useUnfinishedMatch() {
  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const all = await repos.repository.listMatches();
      const unfinished = all.filter((m) => isUnfinished(m.status));
      setMatch(unfinished[0] ?? null);
    } catch {
      setMatch(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { match, loading, refresh };
}
