import { useEffect, useMemo, useState } from 'react';
import { Page } from '@ui/components/Page';
import { Container } from '@ui/components/Container';
import { Card } from '@ui/components/Card';
import { Button } from '@ui/components/Button';
import { Input, EmptyState } from '@ui/components/Input';
import { cn } from '@ui/design/cn';
import { usePlayerStore } from '@app/stores/playerStore';

/**
 * Player CRUD (PHASE 2).
 *
 * Note on history integrity (Q6): editing a player's name here does NOT rewrite
 * past matches — each match stores a frozen `MatchPlayer.displayName` snapshot,
 * so a rename only affects future matches.
 */
export function PlayersPage() {
  const players = usePlayerStore((s) => s.players);
  const loading = usePlayerStore((s) => s.loading);
  const refresh = usePlayerStore((s) => s.refresh);
  const create = usePlayerStore((s) => s.create);
  const update = usePlayerStore((s) => s.update);
  const archive = usePlayerStore((s) => s.archive);

  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return players;
    return players.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.nickname ?? '').toLowerCase().includes(q),
    );
  }, [players, query]);

  const recent = useMemo(
    () => players.filter((p) => p.lastUsedAt !== undefined).slice(0, 5),
    [players],
  );

  const submitNew = async () => {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    try {
      await create({ name });
      setNewName('');
      setAdding(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const submitEdit = async () => {
    if (!editingId) return;
    const name = editName.trim();
    if (!name) return;
    setError(null);
    try {
      await update(editingId, { name });
      setEditingId(null);
      setEditName('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Page title="球员">
      <Container className="py-5">
        {/* Search + add */}
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索球员…"
            aria-label="搜索球员"
          />
          <Button
            className="shrink-0"
            onClick={() => {
              setAdding((v) => !v);
              setError(null);
            }}
          >
            {adding ? '取消' : '+ 新建'}
          </Button>
        </div>

        {/* Create form */}
        {adding && (
          <Card className="mt-3">
            <div className="text-sm font-semibold">新建球员</div>
            <div className="mt-2 flex gap-2">
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitNew();
                }}
                placeholder="球员姓名"
              />
              <Button className="shrink-0" onClick={() => void submitNew()}>
                保存
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted">
              球员用于长期统计；比赛里临时输入的选手不会自动建档。
            </p>
          </Card>
        )}

        {error && (
          <p className="mt-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {/* Recent */}
        {recent.length > 0 && !query && (
          <div className="mt-4">
            <div className="mb-2 text-xs font-semibold text-muted">最近使用</div>
            <div className="flex flex-wrap gap-2">
              {recent.map((p) => (
                <span
                  key={p.id}
                  className="rounded-full border border-border bg-surface-2 px-3 py-1 text-xs"
                >
                  {p.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* List */}
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted">
              全部球员（{filtered.length}）
            </span>
            {loading && <span className="text-[11px] text-muted">加载中…</span>}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title={query ? '没有匹配的球员' : '还没有球员'}
              hint={
                query
                  ? '换个关键词试试。'
                  : '创建球员后，可在新建比赛时直接选择。'
              }
            />
          ) : (
            <div className="grid gap-2">
              {filtered.map((p) => (
                <Card key={p.id} className="!py-3">
                  {editingId === p.id ? (
                    <div className="flex gap-2">
                      <Input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void submitEdit();
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                      />
                      <Button className="shrink-0" onClick={() => void submitEdit()}>
                        保存
                      </Button>
                      <Button
                        variant="ghost"
                        className="shrink-0"
                        onClick={() => setEditingId(null)}
                      >
                        取消
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{p.name}</span>
                          {p.isAnonymous && (
                            <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                              临时
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted">
                          {p.lastUsedAt
                            ? `最近使用 ${new Date(p.lastUsedAt).toLocaleDateString('zh-CN')}`
                            : '尚未使用'}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {confirmArchiveId === p.id ? (
                          <>
                            <button
                              className="min-h-touch rounded-lg bg-danger px-3 text-xs text-white"
                              onClick={() => {
                                void archive(p.id);
                                setConfirmArchiveId(null);
                              }}
                            >
                              确认归档
                            </button>
                            <button
                              className="min-h-touch px-2 text-xs text-muted"
                              onClick={() => setConfirmArchiveId(null)}
                            >
                              取消
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className={cn(
                                'min-h-touch min-w-touch rounded-lg px-2 text-xs text-muted',
                                'hover:text-text',
                              )}
                              onClick={() => {
                                setEditingId(p.id);
                                setEditName(p.name);
                              }}
                            >
                              编辑
                            </button>
                            <button
                              className="min-h-touch min-w-touch rounded-lg px-2 text-xs text-muted hover:text-danger"
                              onClick={() => setConfirmArchiveId(p.id)}
                            >
                              归档
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-muted">
          归档的球员会从选择列表隐藏，但历史比赛记录不受影响。
        </p>
      </Container>
    </Page>
  );
}
