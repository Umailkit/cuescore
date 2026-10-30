import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useMatchStore } from '@app/stores/matchStore';
import { GAME_TYPE_META } from '@core/types';

/**
 * Big-screen display mode (/display/:matchId) — a minimal read-only scoreboard
 * for a TV / projector / OBS. Full presentation lands in PHASE 8.
 */
export function DisplayPage() {
  const { id } = useParams();
  const current = useMatchStore((s) => s.current);
  const load = useMatchStore((s) => s.load);

  useEffect(() => {
    if (id) void load(id);
  }, [id, load]);

  const m = current;

  const wins = useMemo(() => {
    const out = m?.players.map(() => 0) ?? [];
    for (const f of m?.frames ?? []) {
      const cur = out[f.winnerPlayerIndex];
      if (cur !== undefined) out[f.winnerPlayerIndex] = cur + 1;
    }
    return out;
  }, [m]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg p-6 text-text">
      <div className="text-2xl font-bold tracking-[0.3em] text-muted">CUESCORE</div>

      {m ? (
        <div className="mt-12 w-full max-w-2xl">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <div className="text-center">
              <div className="truncate text-lg font-semibold">
                {m.players[0]?.displayName ?? '—'}
              </div>
              <div className="tnum mt-3 text-7xl font-bold">
                {wins[0] ?? 0}
              </div>
            </div>

            <div className="text-center text-sm text-muted">
              <div>VS</div>
              <div className="mt-2 text-[11px]">第 {m.currentFrame} 局</div>
              <div className="text-[11px]">Race To {m.target}</div>
            </div>

            <div className="text-center">
              <div className="truncate text-lg font-semibold">
                {m.players[1]?.displayName ?? '—'}
              </div>
              <div className="tnum mt-3 text-7xl font-bold">
                {wins[1] ?? 0}
              </div>
            </div>
          </div>

          <div className="mt-10 text-center text-xs text-muted">
            {GAME_TYPE_META[m.gameType].label} · {m.displayName} · 分享码{' '}
            <span className="font-mono font-semibold tracking-widest text-gold">
              {m.shareCode}
            </span>
          </div>
        </div>
      ) : (
        <div className="mt-12 text-muted">无比赛数据</div>
      )}
    </div>
  );
}
