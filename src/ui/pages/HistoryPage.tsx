import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page } from '@ui/components/Page';
import { Container } from '@ui/components/Container';
import { Card } from '@ui/components/Card';
import { StatusBadge } from '@ui/components/StatusBadge';
import { EmptyState } from '@ui/components/Input';
import { cn } from '@ui/design/cn';
import { GAME_TYPE_META, type MatchStatus } from '@core/types';
import { isUnfinished } from '@core/match/stateMachine';
import { useMatches } from '@app/hooks/useMatches';

type StatusFilter = 'all' | 'active' | 'finished' | 'cancelled';

const FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '进行中' },
  { key: 'finished', label: '已完成' },
  { key: 'cancelled', label: '已取消' },
];

function matchesFilter(status: MatchStatus, filter: StatusFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'active':
      return isUnfinished(status);
    case 'finished':
      return status === 'MATCH_END';
    case 'cancelled':
      return status === 'CANCELLED';
  }
}

function frameWins(match: {
  players: unknown[];
  frames: { winnerPlayerIndex: number }[];
}): number[] {
  const wins = match.players.map(() => 0);
  for (const f of match.frames) {
    const cur = wins[f.winnerPlayerIndex];
    if (cur !== undefined) wins[f.winnerPlayerIndex] = cur + 1;
  }
  return wins;
}

export function HistoryPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const all = useMatches();
  const matches = useMemo(
    () => all.filter((m) => matchesFilter(m.status, filter)),
    [all, filter],
  );

  const counts = useMemo(
    () => ({
      all: all.length,
      active: all.filter((m) => isUnfinished(m.status)).length,
      finished: all.filter((m) => m.status === 'MATCH_END').length,
      cancelled: all.filter((m) => m.status === 'CANCELLED').length,
    }),
    [all],
  );

  return (
    <Page title="比赛历史">
      <Container className="py-5">
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors',
                filter === f.key
                  ? 'border-felt bg-felt/15 text-felt-strong'
                  : 'border-border text-muted',
              )}
            >
              {f.label}
              <span className="ml-1.5 text-[11px] opacity-70">{counts[f.key]}</span>
            </button>
          ))}
        </div>

        {matches.length === 0 ? (
          <EmptyState
            title="暂无比赛记录"
            hint={
              filter === 'all'
                ? '去首页开始第一场比赛。'
                : '该分类下还没有比赛。'
            }
          />
        ) : (
          <div className="grid gap-2">
            {matches.map((m) => {
              const wins = frameWins(m);
              return (
                <Card
                  key={m.id}
                  className="!py-3"
                  onClick={() => navigate(`/match/${m.id}`)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span>{GAME_TYPE_META[m.gameType].emoji}</span>
                        <span className="truncate text-sm font-medium">
                          {m.players.map((p) => p.displayName).join(' vs ')}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-muted">
                        {GAME_TYPE_META[m.gameType].label} · Race To {m.target} ·
                        第 {m.currentFrame} 局
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted">
                        {new Date(m.createdAt).toLocaleString('zh-CN')}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="tnum text-lg font-bold leading-none">
                        {wins.join(' : ')}
                      </span>
                      <StatusBadge status={m.status} />
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Container>
    </Page>
  );
}
