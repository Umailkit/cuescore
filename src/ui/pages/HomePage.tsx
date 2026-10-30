import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page } from '@ui/components/Page';
import { Container } from '@ui/components/Container';
import { Button } from '@ui/components/Button';
import { Card } from '@ui/components/Card';
import { StatusBadge } from '@ui/components/StatusBadge';
import { useUnfinishedMatch } from '@app/hooks/useUnfinishedMatch';
import { useMatches } from '@app/hooks/useMatches';
import { GAME_TYPE_META } from '@core/types';

/** Frames won by each seat, derived from the match's frame results. */
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

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

export function HomePage() {
  const navigate = useNavigate();
  const { match: unfinished, refresh } = useUnfinishedMatch();
  const recents = useMatches({ limit: 4 });

  // Returning to home after a match should re-evaluate "继续比赛".
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Page title="CueScore" hideNav={false}>
      <Container className="py-8">
        {/* Hero — explains the product in one screen, no manual needed */}
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">CueScore</h1>
          <p className="mt-2 text-sm text-muted">
            台球比赛记录 · 实时计分 · 数据沉淀
          </p>
        </div>

        {/* Primary action */}
        <div className="mt-8">
          <Button
            block
            className="min-h-[64px] text-lg font-semibold"
            onClick={() => navigate('/new')}
          >
            开始比赛
          </Button>
        </div>

        {/* Continue unfinished match */}
        {unfinished && (
          <div className="mt-3">
            <button
              onClick={() => navigate(`/match/${unfinished.id}`)}
              className="w-full rounded-2xl border border-felt/40 bg-felt/10 p-4 text-left transition-colors hover:border-felt"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-felt-strong">
                  继续上一场比赛
                </span>
                <StatusBadge status={unfinished.status} />
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold">
                    {unfinished.players.map((p) => p.displayName).join(' vs ')}
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {GAME_TYPE_META[unfinished.gameType].label} · 第{' '}
                    {unfinished.currentFrame} 局 ·{' '}
                    {relativeTime(unfinished.updatedAt)}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {frameWins(unfinished).join(' : ')}
                </div>
              </div>
            </button>
          </div>
        )}

        {/* Secondary entries */}
        <div className="mt-6 grid grid-cols-4 gap-2">
          {[
            { label: '比赛历史', to: '/history', icon: '🕘' },
            { label: '球员', to: '/players', icon: '👤' },
            { label: '统计', to: '/stats', icon: '📊' },
            { label: '总分排名', to: '/leaderboard', icon: '🏅' },
          ].map((item) => (
            <button
              key={item.to}
              onClick={() => navigate(item.to)}
              className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl border border-border bg-surface text-xs text-muted transition-colors hover:border-felt hover:text-text"
            >
              <span className="text-lg leading-none">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        {/* Recent matches */}
        {recents.length > 0 && (
          <div className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted">最近比赛</h2>
              <button
                onClick={() => navigate('/history')}
                className="text-xs text-felt-strong"
              >
                查看全部
              </button>
            </div>
            <div className="grid gap-2">
              {recents.map((m) => (
                <Card
                  key={m.id}
                  className="flex items-center justify-between !py-3"
                  onClick={() => navigate(`/match/${m.id}`)}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{GAME_TYPE_META[m.gameType].emoji}</span>
                    <div>
                      <div className="text-sm font-medium">
                        {m.players.map((p) => p.displayName).join(' vs ')}
                      </div>
                      <div className="mt-0.5 text-xs text-muted">
                        {GAME_TYPE_META[m.gameType].label} ·{' '}
                        {relativeTime(m.updatedAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-sm font-semibold tnum">
                      {frameWins(m).join(' : ')}
                    </span>
                    <StatusBadge status={m.status} />
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {recents.length === 0 && !unfinished && (
          <p className="mt-10 text-center text-sm text-muted">
            还没有比赛记录。点击「开始比赛」创建第一场。
          </p>
        )}

        {/* 署名 */}
        <footer className="mt-12 text-center text-[11px] leading-relaxed text-muted">
          <div>CueScore 台球计分</div>
          <div className="mt-0.5">芜湖职业技术大学</div>
        </footer>
      </Container>
    </Page>
  );
}
