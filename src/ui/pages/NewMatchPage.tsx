import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page } from '@ui/components/Page';
import { Container } from '@ui/components/Container';
import { Button } from '@ui/components/Button';
import { Card } from '@ui/components/Card';
import { Input } from '@ui/components/Input';
import { cn } from '@ui/design/cn';
import {
  GAME_TYPES,
  GAME_TYPE_META,
  COMING_SOON_LABEL,
  isGamePlayable,
  templatesForGame,
  type GameType,
  type MatchTemplate,
  type MatchPlayerInput,
} from '@core/types';
import { useMatchStore } from '@app/stores/matchStore';
import { usePlayerStore } from '@app/stores/playerStore';

type Step = 'game' | 'template' | 'players';

/** One seat in the new match: either an existing Player or a temporary name. */
interface SeatDraft {
  playerId: string | null;
  name: string;
}

const TARGET_PRESETS = [3, 5, 7, 9];
/** 自定义局数的允许范围。 */
const MIN_TARGET = 1;
const MAX_TARGET = 99;
/** 0 = 不限局数（不设比赛目标，由裁判手动结束）。 */
const UNLIMITED = 0;

export function NewMatchPage() {
  const navigate = useNavigate();
  const createMatch = useMatchStore((s) => s.create);
  const players = usePlayerStore((s) => s.players);
  const refreshPlayers = usePlayerStore((s) => s.refresh);

  const [step, setStep] = useState<Step>('game');
  const [game, setGame] = useState<GameType | null>(null);
  const [template, setTemplate] = useState<MatchTemplate | null>(null);
  const [seats, setSeats] = useState<SeatDraft[]>([
    { playerId: null, name: '' },
    { playerId: null, name: '' },
  ]);
  /** 0 表示不限局数。 */
  const [target, setTarget] = useState(7);
  const [customTarget, setCustomTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshPlayers();
  }, [refreshPlayers]);

  const recent = useMemo(
    () => players.filter((p) => p.lastUsedAt !== undefined).slice(0, 5),
    [players],
  );

  // ---------- Step 1: game type ----------
  if (step === 'game') {
    return (
      <Page title="选择玩法">
        <Container className="py-6">
          <div className="grid grid-cols-2 gap-3">
            {GAME_TYPES.map((g) => {
              const meta = GAME_TYPE_META[g];
              const playable = isGamePlayable(g);
              return (
                <button
                  key={g}
                  onClick={() => {
                    setGame(g);
                    setStep('template');
                  }}
                  className={cn(
                    'relative rounded-2xl border p-4 text-left transition-colors',
                    playable
                      ? 'border-border bg-surface hover:border-felt'
                      : 'border-border/60 bg-surface/50',
                  )}
                >
                  <div className={cn('text-2xl', !playable && 'opacity-40')}>
                    {meta.emoji}
                  </div>
                  <div className={cn('mt-2 font-semibold', !playable && 'text-muted')}>
                    {meta.label}
                  </div>
                  <div className="mt-1 text-xs text-muted">{meta.description}</div>
                  {!playable && (
                    <div className="mt-2 inline-block rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted">
                      {COMING_SOON_LABEL}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </Container>
      </Page>
    );
  }

  // ---------- Step 2: template ----------
  if (step === 'template' && game) {
    const playable = isGamePlayable(game);
    const templates = templatesForGame(game);
    /** 自定义规则入口复用该玩法的标准 RuleSet。 */
    const base = templates[0];

    return (
      <Page title={`${GAME_TYPE_META[game].label} · 模板`}>
        <Container className="py-6">
          {!playable && (
            <Card className="mb-4 border-gold/40 bg-gold/5">
              <div className="text-sm font-semibold text-gold">
                {GAME_TYPE_META[game].label} 引擎将在 PHASE 3 上线
              </div>
              <p className="mt-1 text-xs text-muted">
                当前阶段只能查看推荐模板，无法创建比赛。八球与九球已可完整使用。
              </p>
            </Card>
          )}

          <div className="grid gap-3">
            {templates.map((t) => (
              <Card
                key={t.id}
                className={cn(
                  !playable && 'opacity-60',
                  playable && 'cursor-pointer hover:border-felt',
                )}
                onClick={
                  playable
                    ? () => {
                        setTemplate(t);
                        setTarget(t.target);
                        setStep('players');
                      }
                    : undefined
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{t.name}</div>
                    <div className="mt-1 text-sm text-muted">{t.description}</div>
                    <div className="mt-2 text-xs text-muted">
                      {t.ruleSet.name} · v{t.ruleSet.version}
                    </div>
                  </div>
                  {playable ? (
                    <span className="shrink-0 text-sm text-felt-strong">选择 →</span>
                  ) : (
                    <span className="shrink-0 text-[10px] text-muted">
                      {COMING_SOON_LABEL}
                    </span>
                  )}
                </div>
              </Card>
            ))}

            {/* 自定义规则：标准 RuleSet + 自己定局数（含「不限局数」） */}
            {playable && base && (
              <Card
                className="cursor-pointer border-dashed hover:border-felt"
                onClick={() => {
                  setTemplate({
                    ...base,
                    id: `${base.gameType}.custom`,
                    name: '自定义规则',
                    description: `采用 ${base.ruleSet.name}，比赛目标（局数）在下一步设置。`,
                  });
                  setTarget(base.target);
                  setStep('players');
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">自定义规则</div>
                    <div className="mt-1 text-sm text-muted">
                      使用 CueScore Standard 规则，局数由你自己定（也可不限局数）。
                    </div>
                  </div>
                  <span className="shrink-0 text-sm text-felt-strong">选择 →</span>
                </div>
              </Card>
            )}

            <Button variant="ghost" block onClick={() => setStep('game')}>
              返回
            </Button>
          </div>
        </Container>
      </Page>
    );
  }

  // ---------- Step 3: players + target ----------
  const canStart =
    seats.length >= 2 && seats.every((s) => (s.playerId ?? s.name.trim()).length > 0);

  const start = async () => {
    if (!template || busy) return;
    setBusy(true);
    setError(null);
    try {
      const inputs: MatchPlayerInput[] = seats.map((s) => {
        if (s.playerId) {
          const p = players.find((x) => x.id === s.playerId);
          return {
            playerId: s.playerId,
            displayName: p?.name ?? s.name,
            isAnonymous: false,
          };
        }
        return { playerId: null, displayName: s.name.trim(), isAnonymous: true };
      });

      const match = await createMatch(template, inputs, { target });
      if (match) navigate(`/match/${match.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="选手与目标">
      <Container className="py-6">
        <Card>
          <div className="text-sm font-semibold">{template?.name}</div>
          <div className="mt-1 text-xs text-muted">{template?.description}</div>
        </Card>

        {/* Recent player quick-pick */}
        {recent.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-xs font-semibold text-muted">最近使用</div>
            <div className="flex flex-wrap gap-2">
              {recent.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSeats((prev) => {
                      const emptyIdx = prev.findIndex(
                        (s) => !s.playerId && !s.name.trim(),
                      );
                      const idx = emptyIdx === -1 ? prev.length : emptyIdx;
                      if (idx >= 4) return prev;
                      const next = [...prev];
                      next[idx] = { playerId: p.id, name: p.name };
                      return next;
                    });
                  }}
                  className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-sm hover:border-felt"
                >
                  + {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Seats */}
        <div className="mt-4 grid gap-3">
          {seats.map((seat, i) => (
            <Card key={i} className="!p-3">
              <div className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-center text-xs text-muted">
                  {i + 1}
                </span>
                {seat.playerId ? (
                  <div className="flex min-h-touch flex-1 items-center justify-between">
                    <span className="font-medium">{seat.name}</span>
                    <button
                      className="text-xs text-muted hover:text-danger"
                      onClick={() =>
                        setSeats((prev) => {
                          const next = [...prev];
                          next[i] = { playerId: null, name: '' };
                          return next;
                        })
                      }
                    >
                      清除
                    </button>
                  </div>
                ) : (
                  <Input
                    value={seat.name}
                    placeholder={`临时球员 ${i + 1}`}
                    onChange={(e) =>
                      setSeats((prev) => {
                        const next = [...prev];
                        next[i] = { playerId: null, name: e.target.value };
                        return next;
                      })
                    }
                  />
                )}
              </div>

              {/* Existing player picker */}
              {players.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-felt-strong">
                    从已有球员选择
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {players.slice(0, 12).map((p) => (
                      <button
                        key={p.id}
                        onClick={() =>
                          setSeats((prev) => {
                            const next = [...prev];
                            next[i] = { playerId: p.id, name: p.name };
                            return next;
                          })
                        }
                        className="rounded-full border border-border px-2.5 py-1 text-xs hover:border-felt"
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </Card>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <Button
            variant="secondary"
            block
            disabled={seats.length >= 4}
            onClick={() =>
              setSeats((prev) => [...prev, { playerId: null, name: '' }])
            }
          >
            + 添加球员
          </Button>
          {seats.length > 2 && (
            <Button
              variant="ghost"
              onClick={() => setSeats((prev) => prev.slice(0, -1))}
            >
              移除
            </Button>
          )}
        </div>

        {/* Target (Race To) — 预设 / 自定义 / 不限局数 */}
        <Card className="mt-4">
          <div className="text-sm font-semibold">比赛目标</div>
          <p className="mt-1 text-xs text-muted">
            Race To 局数，先达到者胜。也可以自定义局数，或不限局数一直打下去。
          </p>

          <div className="mt-3 grid grid-cols-5 gap-2">
            {TARGET_PRESETS.map((n) => (
              <button
                key={n}
                onClick={() => {
                  setTarget(n);
                  setCustomTarget('');
                }}
                className={cn(
                  'min-h-touch rounded-xl border text-sm font-semibold',
                  target === n
                    ? 'border-felt bg-felt/15 text-felt-strong'
                    : 'border-border bg-surface-2 text-muted',
                )}
              >
                {n}
              </button>
            ))}
            <button
              onClick={() => {
                setTarget(UNLIMITED);
                setCustomTarget('');
              }}
              className={cn(
                'min-h-touch rounded-xl border text-sm font-semibold',
                target === UNLIMITED
                  ? 'border-felt bg-felt/15 text-felt-strong'
                  : 'border-border bg-surface-2 text-muted',
              )}
            >
              不限
            </button>
          </div>

          {/* 自定义局数：即时生效，输入非法时保留上一次的有效值 */}
          <div className="mt-3 flex items-center gap-2">
            <Input
              value={customTarget}
              inputMode="numeric"
              placeholder="自定义局数"
              onChange={(e) => {
                const raw = e.target.value.replace(/[^\d]/g, '');
                setCustomTarget(raw);
                const n = Number(raw);
                if (raw !== '' && Number.isInteger(n) && n >= MIN_TARGET && n <= MAX_TARGET) {
                  setTarget(n);
                }
              }}
            />
            <span className="shrink-0 text-xs text-muted">
              {MIN_TARGET}–{MAX_TARGET}
            </span>
          </div>

          <p className="mt-2 text-xs text-muted">
            {target === UNLIMITED
              ? '不限局数：不会自动结束比赛，需要收场时用「更多 → 结束比赛」。'
              : `当前目标：先赢 ${target} 局者获胜。`}
          </p>
        </Card>

        {error && (
          <p className="mt-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-4 grid gap-2">
          <Button
            block
            className="min-h-[56px] text-base"
            disabled={!canStart || busy}
            onClick={() => void start()}
          >
            {busy ? '创建中…' : '创建并进入比赛'}
          </Button>
          <Button variant="ghost" block onClick={() => setStep('template')}>
            返回
          </Button>
        </div>
      </Container>
    </Page>
  );
}
