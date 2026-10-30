import { useMemo, useState } from 'react';
import { Page } from '@ui/components/Page';
import { Container } from '@ui/components/Container';
import { Card } from '@ui/components/Card';
import { EmptyState } from '@ui/components/Input';
import { cn } from '@ui/design/cn';
import { GAME_TYPE_META, type GameType } from '@core/types';
import { useMatches } from '@app/hooks/useMatches';
import {
  SCORING_GAME_TYPES,
  buildRanking,
  hasScores,
} from '@app/services/ranking';

const RANK_STYLE = ['text-gold', 'text-text', 'text-muted'];

export function LeaderboardPage() {
  const all = useMatches();
  const [type, setType] = useState<GameType | 'all'>('all');

  /** 数据里真实出现过分值的玩法（没打过的玩法不占位）。 */
  const available = useMemo(
    () => SCORING_GAME_TYPES.filter((t) => all.some((m) => m.gameType === t && hasScores(m))),
    [all],
  );

  const scoped = useMemo(
    () => all.filter((m) => (type === 'all' ? true : m.gameType === type)),
    [all, type],
  );

  const rows = useMemo(() => buildRanking(scoped), [scoped]);
  const max = rows[0]?.total ?? 0;
  const matchCount = useMemo(() => scoped.filter(hasScores).length, [scoped]);

  return (
    <Page title="总分排名">
      <Container className="py-5">
        {available.length === 0 ? (
          <EmptyState
            title="还没有可排名的分值"
            hint="九球 / 六球 / 四球 / 斯诺克的比分在每局结束时累计，打完一局就会出现在这里。"
          />
        ) : (
          <>
            <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
              <FilterChip active={type === 'all'} onClick={() => setType('all')} label="全部" />
              {available.map((t) => (
                <FilterChip
                  key={t}
                  active={type === t}
                  onClick={() => setType(t)}
                  label={GAME_TYPE_META[t].label}
                />
              ))}
            </div>

            <Card className="mb-3 !py-3">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>
                  {rows.length} 位选手 · {matchCount} 场计分比赛
                </span>
                <span>按每局比分累计</span>
              </div>
            </Card>

            <div className="grid gap-2">
              {rows.map((row, i) => (
                <Card key={row.key} className="!py-3">
                  <div
                    className="flex items-center gap-3"
                    data-rank-row={row.key}
                    data-total={row.total}
                  >
                    <span
                      className={cn(
                        'tnum w-7 shrink-0 text-center text-base font-bold',
                        RANK_STYLE[i] ?? 'text-muted',
                      )}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium">{row.name}</span>
                        <span className="tnum shrink-0 text-lg font-bold leading-none">
                          {row.total}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full bg-felt"
                          style={{
                            width: `${
                              row.total > 0 && max > 0
                                ? Math.max(2, (row.total / max) * 100)
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                      <div className="mt-1 text-[11px] text-muted">
                        {row.matches} 场 · {row.frames} 局 · 单场最高 {row.best}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <p className="mt-6 text-center text-[11px] leading-relaxed text-muted">
              同一位选手的分数跨比赛累计；临时选手按名字归并。
              <br />
              八球按局定胜负，不计入分值排名。
            </p>
          </>
        )}
      </Container>
    </Page>
  );
}

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors',
        active ? 'border-felt bg-felt/15 text-felt-strong' : 'border-border text-muted',
      )}
    >
      {label}
    </button>
  );
}
