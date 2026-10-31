import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Container } from '@ui/components/Container';
import { Card } from '@ui/components/Card';
import { StatusBadge } from '@ui/components/StatusBadge';
import { ActionBar, ActionButton } from '@ui/components/ActionBar';
import { BallBoard } from '@ui/board/BallBoard';
import { Input } from '@ui/components/Input';
import {
  buildBoardView,
  foulReasonOptions,
  isChaseGame,
  quickActions,
  readFacts,
} from '@app/services/boardView';
import { cn } from '@ui/design/cn';
import { useMatchStore } from '@app/stores/matchStore';
import {
  GAME_TYPE_META,
  type MatchCommandType,
  type MatchEventType,
  type MatchStatus,
} from '@core/types';

/**
 * 比赛工作台 —— 主界面是「记分牌」，不是「球台」。
 *
 * 设计原则（按记分器的真实用法重排）：
 *   1. 一屏之内看得到：谁领先、第几局、还差几局
 *   2. 主操作只有一个问题：「本局谁赢了？」两个大按钮
 *   3. 点完自动开下一局，不用再点一次「下一局」
 *   4. 精确记录（进球、犯规、裁定）收进折叠层 —— 需要时才展开
 *
 * 规则判定仍然全部在引擎里：页面只发命令，不判断合法性。
 */

const EVENT_LABELS: Record<MatchEventType, string> = {
  MATCH_CREATED: '创建比赛',
  MATCH_STARTED: '开始比赛',
  MATCH_PAUSED: '暂停',
  MATCH_RESUMED: '继续',
  MATCH_CANCELLED: '取消',
  FRAME_STARTED: '开始本局',
  FRAME_WON: '本局结束',
  MATCH_WON: '比赛结束',
  PLAYER_SWITCHED: '切换选手',
  SCORE_ADDED: '得分',
  FOUL: '犯规',
  ENGINE_EVENT: '引擎事件',
  UNDO: '撤销',
  REDO: '重做',
  BREAK_STARTED: '开球',
  BALL_POTTED: '进球',
  BALL_MISSED: '空杆',
  TURN_ENDED: '换手',
  GROUPS_ASSIGNED: '确定球组',
  EIGHT_BALL_PHASE: '进入黑八',
  FRAME_LOST: '本局判负',
  MATCH_LOST: '比赛判负',
  RERACK: '重新摆球',
  CALL_SHOT: '指定球',
  CONCEDE: '认输',
};

const GROUP_LABEL: Record<'SOLIDS' | 'STRIPES', string> = {
  SOLIDS: '全色 1–7',
  STRIPES: '花色 9–15',
};

function availableCommands(status: MatchStatus) {
  return {
    canStart: status === 'READY' || status === 'FRAME_END',
    canPause: status === 'PLAYING',
    canResume: status === 'PAUSED',
    canEndMatch: status === 'FRAME_END',
    canCancel: status === 'READY' || status === 'PLAYING' || status === 'PAUSED',
    canSwitch: status === 'PLAYING',
  };
}

/** 精细记录折叠层的副标题：八球看台面状态，其余看 BoardView 的说明。 */
function detailSubtitle(
  gameType: string,
  board: ReturnType<typeof buildBoardView>,
): string {
  if (gameType === 'eight-ball') {
    if (board?.tableStatus === 'OPEN') return '球台未分组';
    if (board?.tableStatus === 'EIGHT_BALL') return '黑八阶段';
    return '已分组';
  }
  if (!board) {
    // 四球、以及改成记分制的九球：没有球台，只有加/扣分
    return gameType === 'four-ball' || gameType === 'nine-ball' ? '记分制' : '按当前玩法记录';
  }
  return board.note;
}

export function MatchPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const current = useMatchStore((s) => s.current);
  const load = useMatchStore((s) => s.load);
  const dispatch = useMatchStore((s) => s.dispatch);
  const dispatchBatch = useMatchStore((s) => s.dispatchBatch);
  const undo = useMatchStore((s) => s.undo);
  const redo = useMatchStore((s) => s.redo);
  const log = useMatchStore((s) => s.log);
  const undoable = useMatchStore((s) => s.canUndo());
  const redoable = useMatchStore((s) => s.canRedo());
  const lastError = useMatchStore((s) => s.lastError);
  const clearError = useMatchStore((s) => s.clearError);

  const [showDetail, setShowDetail] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showFoul, setShowFoul] = useState(false);
  const [showReferee, setShowReferee] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  /** 自定义分值输入（记分制玩法）。 */
  const [customPoints, setCustomPoints] = useState('');
  /**
   * 记分对象（seat index）。
   *
   * null = 跟随当前击球方。记分员可以先点「给谁记分」再点 +N，
   * 这样同一杆里给对手记犯规分、或者补记上一杆都顺手。
   */
  const [targetSeat, setTargetSeat] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    if (current?.id === id) return;
    setLoading(true);
    void load(id).finally(() => setLoading(false));
  }, [id, current?.id, load]);

  useEffect(() => {
    if (!lastError) return;
    const t = setTimeout(() => clearError(), 2600);
    return () => clearTimeout(t);
  }, [lastError, clearError]);

  /** 每位选手已赢的局数。 */
  const wins = useMemo(() => {
    const out = current?.players.map(() => 0) ?? [];
    for (const f of current?.frames ?? []) {
      const cur = out[f.winnerPlayerIndex];
      if (cur !== undefined) out[f.winnerPlayerIndex] = cur + 1;
    }
    return out;
  }, [current]);

  const board = useMemo(() => {
    if (!current) return null;
    return buildBoardView(
      current.gameType,
      current.engineState,
      current.ruleSetSnapshot?.config,
    );
  }, [current]);

  if (!current || (id && current.id !== id)) {
    return (
      <div className="flex min-h-full flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          {loading ? (
            <p className="text-muted">正在恢复比赛…</p>
          ) : (
            <>
              <p className="text-muted">找不到这场比赛。</p>
              <button
                className="rounded-xl bg-felt px-4 py-3 text-white"
                onClick={() => navigate('/new')}
              >
                开始一场比赛
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  const m = current;
  const cmd = availableCommands(m.status);
  const ended = m.status === 'MATCH_END' || m.status === 'CANCELLED';
  const facts = readFacts(m.gameType, m.engineState, m.ruleSetSnapshot?.config);
  const playing = m.status === 'PLAYING';
  // 五套引擎全部落地：只要能读出比赛事实，就给精细记录。
  // 四球没有球台（board 为 null），但加分按钮照常可用。
  const hasEngine = facts !== null;
  /**
   * 追分口径：四球，以及**记分制**的九球（标准清台制没有分数概念）。
   * 整场累计，没有「本局」也没有「谁赢了这一局」。
   * 记分员点的是「发生了什么」（普胜/大金…），分值由规则表算。
   */
  const isChase = isChaseGame(m.gameType, m.ruleSetSnapshot?.config);
  const compact = m.players.length > 2;
  const foulReasons = foulReasonOptions(m.gameType);
  // 这里不能用 useMemo：本组件在 current 为 null 时会提前 return，
  // 放在 return 之后的 hook 会让两次渲染的 hook 数量不一致（React #310）。
  // quickActions 只是读 config 拼几个按钮，直接算即可。
  const quicks = quickActions(m.gameType, m.ruleSetSnapshot?.config);
  /** 这个玩法是否支持「人工加减分」（四球 / 记分制九球）。 */
  const adjustable = quicks.some((q) => q.action.type === 'ADJUST_SCORE');
  const lastFrame = m.frames[m.frames.length - 1];
  const leader = wins.indexOf(Math.max(...wins));
  const tied = wins.every((w) => w === wins[0]);
  /**
   * 进度点画什么：计分制玩法且目标分 ≤9 时画分数进度，
   * 否则（含斯诺克——它按局数定胜负）画局数进度。
   */
  const scoreGoal =
    facts?.frameGoal !== undefined && facts.frameGoal <= 9 ? facts.frameGoal : undefined;

  /**
   * 本场总分排名。
   *
   * 累计口径 = 已结束各局的分数快照 + 当前局的实时分数。
   * 注意 FRAME_END/MATCH_END 时本局分数已经在 frames 里了，不能再加一次，
   * 否则结果页会翻倍。
   */
  const scoreRows = (() => {
    const totals = m.players.map(() => 0);
    let hasAny = false;
    for (const f of m.frames) {
      for (const [seat, v] of Object.entries(f.scores ?? {})) {
        const i = Number(seat);
        if (totals[i] !== undefined) {
          totals[i] += v;
          hasAny = true;
        }
      }
    }
    const live = m.status === 'PLAYING' || m.status === 'PAUSED';
    if (live && facts?.points) {
      for (const [seat, v] of Object.entries(facts.points)) {
        const i = Number(seat);
        if (totals[i] !== undefined) {
          totals[i] += v;
          hasAny = true;
        }
      }
    }
    if (!hasAny) return [];
    return m.players
      .map((p, i) => ({ seat: i, name: p.displayName, score: totals[i] ?? 0 }))
      .sort((a, b) => b.score - a.score || a.seat - b.seat);
  })();

  /**
   * 页头显示的局号。
   *
   * `currentFrame` 是「下一局」的序号 —— 本局一结束，Service 就会把它 +1。
   * 但 FRAME_END / MATCH_END 时界面展示的是刚打完的那一局的结果，
   * 若直接显示 currentFrame，会出现「第 2 局」标题配「第 1 局结束」卡片的矛盾。
   */
  const displayFrame =
    (m.status === 'FRAME_END' || m.status === 'MATCH_END') && lastFrame
      ? lastFrame.index
      : m.currentFrame;
  const frameLabel =
    m.status === 'MATCH_END'
      ? `共 ${m.frames.length} 局`
      : `第 ${displayFrame} 局 · ${m.target > 0 ? `Race To ${m.target}` : '不限局数'}`;

  const run = (type: MatchCommandType, payload?: Record<string, unknown>) => {
    void dispatch({ type, payload });
  };

  /** 记分真正落到哪个座位：选了人就用选的，否则跟随当前击球方。 */
  const scoringSeat = targetSeat ?? m.activePlayerIndex;

  /** 自定义分值：sign=1 加分，sign=-1 扣分。 */
  const adjustScore = (sign: 1 | -1) => {
    const n = Number(customPoints);
    if (!Number.isInteger(n) || n <= 0) return;
    run('ADJUST_SCORE', { points: sign * n, playerIndex: scoringSeat });
    setCustomPoints('');
  };

  /** 快捷档位：计分命令把「给谁记」一起带上。 */
  const runQuick = (action: { type: MatchCommandType; payload?: Record<string, unknown> }) => {
    if (action.type === 'ADJUST_SCORE' || action.type === 'CHASE_SCORED') {
      run(action.type, { ...action.payload, playerIndex: scoringSeat });
      return;
    }
    run(action.type, action.payload);
  };

  /**
   * 开始一局。
   *
   * 开球对记分员来说是隐式事实 —— 没人会为了记分专门点「开球」。
   * 所以 START_MATCH 之后紧接着把开球标记完成，让球台立刻可以记录进球。
   * 规则本身没变：引擎仍然区分「开球这一杆」与之后的击球（开球进球不认组）。
   */
  const startMatch = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await dispatchBatch([{ type: 'START_MATCH' }, { type: 'BREAK_STARTED' }]);
    } finally {
      setBusy(false);
    }
  };

  /**
   * 记一局胜负，然后自动开下一局。
   *
   * 这是主操作：记分员只关心「谁赢了」，不该再被要求点第二次「下一局」。
   * 未到 Race To 目标时自动续局；到了就由 MatchService 自动收场。
   */
  const awardFrame = async (winnerIndex: number) => {
    if (busy) return;
    setBusy(true);
    try {
      const batch: { type: MatchCommandType; payload?: Record<string, unknown> }[] = [];

      // 比赛还没在「打」的状态时，先把它推进到 PLAYING。
      // 没有这一步，FRAME_END 下再记一局会被状态机拒绝
      //（COMPLETE_FRAME 的目标状态就是 FRAME_END，而 FRAME_END 只能转 PLAYING）。
      if (m.status === 'READY' || m.status === 'FRAME_END') {
        batch.push({ type: 'START_MATCH' }, { type: 'BREAK_STARTED' });
      } else if (m.status === 'PAUSED') {
        batch.push({ type: 'RESUME_MATCH' });
      }
      batch.push({ type: 'COMPLETE_FRAME', payload: { winnerPlayerIndex: winnerIndex } });

      await dispatchBatch(batch);

      // 未到 Race To 目标就自动续局 —— 记分员不该再点一次「下一局」。
      // 续局属于「记这一局」的同一步操作，所以不新增撤销层级。
      const after = useMatchStore.getState().current;
      if (after?.status === 'FRAME_END') {
        await dispatchBatch(
          [{ type: 'START_MATCH' }, { type: 'BREAK_STARTED' }],
          { mergeWithPrevious: true },
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      {/* ---------- Top bar ---------- */}
      <header className="sticky top-0 z-10 border-b border-border bg-bg/95 backdrop-blur">
        <Container className="flex h-14 items-center justify-between gap-2" wide>
          <button
            onClick={() => navigate('/')}
            className="min-h-touch min-w-touch text-left text-sm text-muted"
          >
            ‹ 返回
          </button>
          <div className="min-w-0 flex-1 text-center">
            <div className="truncate text-sm font-semibold">
              {GAME_TYPE_META[m.gameType].label}
            </div>
            <div className="truncate text-[11px] text-muted">{frameLabel}</div>
          </div>
          <button
            onClick={() => setShowMore((v) => !v)}
            className="min-h-touch min-w-touch text-right text-sm text-muted"
          >
            {showMore ? '收起' : '更多'}
          </button>
        </Container>
      </header>

      <main className="flex flex-1 flex-col">
        <Container className="flex flex-1 flex-col py-4">
          {/* ---------- Scoreboard: the hero ----------
              撑满剩余高度：记分牌是主角，不该缩在顶部留一片空黑。 */}
          <div
            className={cn(
              'flex flex-col overflow-hidden rounded-3xl border border-border bg-surface',
              // 两人：记分牌撑满剩余高度，站着也能读；
              // 三/四人：同样吃掉多余空间，但允许压缩到内容高度，
              // 保证操作区不被挤到屏幕外（一屏内完成记分）。
              compact ? 'min-h-0 flex-1' : 'min-h-[280px] flex-1',
            )}
          >
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-2">
              <StatusBadge status={m.status} />
              <span className="text-[11px] text-muted">
                {ended
                  ? `共 ${m.frames.length} 局`
                  : isChase && facts?.points
                    ? // 追分没有「本局」，看到的就是整场总分
                      `总分 ${m.players.map((_, i) => facts.points?.[i] ?? 0).join(' : ')}`
                    : facts?.points
                    ? // 计分制玩法：局内分数是主角，局数退到次要位置
                      `本局 ${m.players.map((_, i) => facts.points?.[i] ?? 0).join(' : ')} · 局数 ${wins.join(' : ')}`
                    : tied
                      ? `比分 ${wins.join(' : ')}`
                      : `比分 ${wins.join(' : ')} · ${m.players[leader]?.displayName ?? '—'} 领先`}
              </span>
            </div>

            <div
              className={cn(
                'grid flex-1 grid-cols-2 divide-x divide-border/60',
                // 多行时让每行均分高度，格子不会全挤在顶部
                compact && 'auto-rows-fr',
              )}
            >
              {m.players.map((p, i) => {
                const isActive = i === m.activePlayerIndex && playing;
                const group = facts?.playerGroups[i] ?? null;
                const isWinner = ended && m.winnerPlayerId === p.playerId && p.playerId;
                const score = facts?.points ? (facts.points[i] ?? 0) : (wins[i] ?? 0);
                // 负号也占一个字符位，所以用 String(score) 而不是 Math.abs
                const digits = String(score).length;
                // 字号按位数收：追分很容易到两位数甚至三位数，
                // 固定 22vh 会让「20」被格子裁掉。
                const scoreSize = compact
                  ? digits >= 4
                    ? 'text-[clamp(1.25rem,5vh,2.5rem)]'
                    : digits === 3
                      ? 'text-[clamp(1.75rem,7vh,3.5rem)]'
                      : 'text-[clamp(2.5rem,11vh,6rem)]'
                  : digits >= 4
                    ? 'text-[clamp(2rem,7vh,4.5rem)]'
                    : digits === 3
                      ? 'text-[clamp(2.5rem,10vh,6rem)]'
                      : digits === 2
                        ? 'text-[clamp(3rem,15vh,8rem)]'
                        : 'text-[clamp(4.5rem,22vh,13rem)]';
                return (
                  <div
                    key={i}
                    className={cn(
                      'relative flex flex-col items-center justify-center text-center transition-colors',
                      compact ? 'px-2 py-3' : 'px-3 py-4',
                      // 四人格里补一条横线，否则上下两排糊在一起
                      compact && i >= 2 && 'border-t border-border/60',
                      isActive && 'bg-felt/10',
                    )}
                  >
                    {isActive && (
                      <span className="absolute inset-x-0 top-0 h-0.5 bg-felt-strong" />
                    )}
                    <div className="flex items-center justify-center gap-1.5">
                      <span
                        className={cn('truncate font-semibold', compact ? 'text-xs' : 'text-sm')}
                      >
                        {p.displayName}
                      </span>
                      {p.isAnonymous && (
                        <span className="shrink-0 rounded bg-surface-2 px-1 text-[9px] text-muted">
                          临时
                        </span>
                      )}
                      {isWinner && <span className="text-xs">🏆</span>}
                    </div>

                    {/* 主数字随视口高度放大：站着看也读得清。
                        计分制玩法显示得分，其余显示已赢局数。 */}
                    <div
                      className={cn(
                        'tnum my-1 max-w-full font-bold leading-[0.85] tracking-tight',
                        scoreSize,
                        isActive ? 'text-felt-strong' : 'text-text',
                      )}
                    >
                      {score}
                    </div>

                    {/* 进度点：计分制且目标 ≤9 时表示分数进度，否则表示局数进度。
                        追分是整场累计，没有进度可画。 */}
                    <div
                      className={cn(
                        'mt-1 flex items-center justify-center gap-1',
                        isChase && 'hidden',
                      )}
                    >
                      {Array.from({
                        // 不限局数（target=0）时不画进度点
                        length: Math.max(0, Math.min(scoreGoal ?? m.target, 9)),
                      }).map((_, k) => (
                        <span
                          key={k}
                          className={cn(
                            'h-1.5 w-1.5 rounded-full transition-colors',
                            k < (scoreGoal ? (facts?.points?.[i] ?? 0) : (wins[i] ?? 0))
                              ? isActive
                                ? 'bg-felt-strong'
                                : 'bg-text/60'
                              : 'bg-border',
                          )}
                        />
                      ))}
                    </div>

                    <div
                      className={cn('text-muted', compact ? 'mt-1 text-[10px]' : 'mt-2 h-4 text-[11px]')}
                    >
                      {facts?.points
                        ? `${isChase ? '总分' : '本局得分'}${
                            !isChase && scoreGoal ? ` · 目标 ${scoreGoal} 分` : ''
                          }${
                            isActive && facts.currentBreak
                              ? ` · 单杆 ${facts.currentBreak}`
                              : ''
                          }`
                        : group
                          ? GROUP_LABEL[group]
                          : isActive
                            ? '当前击球'
                            : playing
                              ? '等待'
                              : ''}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 本局状态提示 */}
            {playing && facts?.needsBreak && (
              <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-surface-2/50 px-4 py-2">
                <span className="text-[11px] text-muted">本局还没开球</span>
                <button
                  onClick={() => run('BREAK_STARTED')}
                  className="rounded-lg bg-felt px-3 py-1 text-[11px] font-semibold text-white"
                >
                  开球
                </button>
              </div>
            )}
            {playing && facts?.foulOccurred && (
              <div className="border-t border-gold/30 bg-gold/5 px-4 py-2 text-center text-[11px] text-gold">
                犯规 · {facts.foulReasonLabel} · 已换手
              </div>
            )}
            {playing && board?.tableStatus === 'EIGHT_BALL' && (
              <div className="border-t border-gold/30 bg-gold/5 px-4 py-2 text-center text-[11px] font-semibold text-gold">
                黑八阶段 · 打进 8 号球即分胜负
              </div>
            )}
          </div>

          {/* ---------- 总分排名总览（追分不显示：记分牌上就是总分） ---------- */}
          {scoreRows.length > 0 && !isChase && (
            <Card className="mt-3 !py-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold">总分排名</span>
                <span className="text-[10px] text-muted">本场累计</span>
              </div>
              <ol className="space-y-1">
                {scoreRows.map((row, idx) => (
                  <li key={row.seat} className="flex items-center gap-2 text-sm">
                    <span
                      className={cn(
                        'w-5 shrink-0 text-center text-xs font-semibold tnum',
                        idx === 0 ? 'text-gold' : 'text-muted',
                      )}
                    >
                      {idx + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{row.name}</span>
                    <span
                      className={cn(
                        'tnum font-semibold',
                        idx === 0 && row.score > 0 ? 'text-felt-strong' : 'text-text',
                      )}
                    >
                      {row.score}
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {/* ---------- 本局结果（FRAME_END / MATCH_END） ---------- */}
          {m.status === 'FRAME_END' && lastFrame && (
            <Card className="mt-3 border-gold/40 bg-gold/5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-gold">本局结束</div>
                  <p className="mt-1 text-xs text-muted">
                    第 {lastFrame.index} 局 · {m.players[lastFrame.winnerPlayerIndex]?.displayName ?? '—'} 获胜
                    {facts?.winReason ? ` · ${facts.winReason}` : ''}
                  </p>
                </div>
                <span className="tnum shrink-0 text-lg font-bold text-gold">
                  {wins.join(' : ')}
                </span>
              </div>
            </Card>
          )}

          {m.status === 'MATCH_END' && (
            <Card className="mt-3 border-felt/40 bg-felt/10">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-felt-strong">比赛结束</div>
                  <p className="mt-1 text-xs text-muted">
                    {m.players[wins.indexOf(Math.max(...wins))]?.displayName ?? '—'} 获胜 ·{' '}
                    {m.frames.length} 局
                  </p>
                </div>
                <span className="tnum text-2xl font-bold">{wins.join(' : ')}</span>
              </div>
            </Card>
          )}

          {m.status === 'CANCELLED' && (
            <Card className="mt-3 border-danger/40 bg-danger/5">
              <div className="text-sm font-semibold text-danger">比赛已取消</div>
              <p className="mt-1 text-xs text-muted">记录已保留，可在历史中查看。</p>
            </Card>
          )}

          {/* ---------- 局记录 ---------- */}
          {m.frames.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                局记录
              </div>
              <div className="flex flex-wrap gap-1.5">
                {m.frames.map((f) => (
                  <span
                    key={f.index}
                    className="rounded-lg border border-border bg-surface px-2 py-1 text-[11px]"
                  >
                    <span className="text-muted">{f.index}.</span>{' '}
                    <span className="font-medium">
                      {m.players[f.winnerPlayerIndex]?.displayName ?? '—'}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ---------- 精细记录（折叠） ---------- */}
          {hasEngine && (
            <div className="mt-4">
              <button
                onClick={() => setShowDetail((v) => !v)}
                className="flex w-full items-center justify-between rounded-xl border border-border bg-surface px-3 py-2.5 text-left"
              >
                <span className="text-xs">
                  <span className="font-semibold">精细记录</span>
                  <span className="ml-1.5 text-muted">
                    {detailSubtitle(m.gameType, board)}
                  </span>
                </span>
                <span className="text-[11px] text-muted">
                  {showDetail ? '收起 ▲' : '展开 ▼'}
                </span>
              </button>

              {showDetail && (
                <div className="mt-2 space-y-2">
                  {board && (
                    <BallBoard
                      view={board}
                      disabled={!playing}
                      onCommand={(action) => run(action.type, action.payload)}
                    />
                  )}

                  {/* 给谁记分：先选人，再点档位；不选则跟随当前击球方 */}
                  {playing && (adjustable || isChase) && (
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[11px] text-muted">给谁记分</span>
                        <span className="text-[10px] text-muted">
                          {targetSeat === null
                            ? '默认：当前击球方'
                            : `已选：${m.players[targetSeat]?.displayName ?? ''}`}
                        </span>
                      </div>
                      <div className={cn('grid gap-2', compact ? 'grid-cols-4' : 'grid-cols-2')}>
                        {m.players.map((p, i) => {
                          const active = scoringSeat === i;
                          return (
                            <button
                              key={i}
                              onClick={() => setTargetSeat(i)}
                              className={cn(
                                'min-h-touch truncate rounded-xl border px-2 text-sm',
                                active
                                  ? 'border-felt bg-felt/15 font-semibold text-felt-strong'
                                  : 'border-border bg-surface text-muted',
                              )}
                            >
                              {p.displayName}
                              {i === m.activePlayerIndex && !compact && (
                                <span className="ml-1 text-[10px] font-normal opacity-70">
                                  击球中
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {playing && quicks.length > 0 && (
                    <div
                      className={cn(
                        'grid gap-2',
                        isChase ? 'grid-cols-5' : 'grid-cols-4',
                      )}
                    >
                      {quicks.map((q) => (
                        <button
                          key={q.label}
                          onClick={() => runQuick(q.action)}
                          className={cn(
                            'min-h-touch rounded-xl border font-semibold',
                            isChase ? 'px-1 text-[13px]' : 'text-sm',
                            // 扣分按钮用中性色，避免和加分抢注意力
                            q.label.startsWith('-')
                              ? 'border-border bg-surface-2 text-muted'
                              : 'border-felt bg-felt/15 text-felt-strong',
                          )}
                        >
                          {q.label}
                          {q.hint && (
                            <span className="mt-0.5 block text-[10px] font-normal text-muted">
                              {q.hint}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* 自定义分值：任意数字，加/扣两个方向 */}
                  {playing && adjustable && (
                    <div className="flex items-center gap-2">
                      <Input
                        value={customPoints}
                        inputMode="numeric"
                        placeholder="自定义分值"
                        onChange={(e) =>
                          setCustomPoints(e.target.value.replace(/[^\d]/g, ''))
                        }
                      />
                      <button
                        disabled={!customPoints}
                        onClick={() => adjustScore(1)}
                        className="min-h-touch shrink-0 rounded-xl border border-felt bg-felt/15 px-4 text-sm font-semibold text-felt-strong disabled:opacity-40"
                      >
                        加分
                      </button>
                      <button
                        disabled={!customPoints}
                        onClick={() => adjustScore(-1)}
                        className="min-h-touch shrink-0 rounded-xl border border-border bg-surface-2 px-4 text-sm font-semibold text-muted disabled:opacity-40"
                      >
                        扣分
                      </button>
                    </div>
                  )}

                  {playing && (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setShowFoul((v) => !v)}
                        className="min-h-touch rounded-xl border border-border bg-surface text-xs"
                      >
                        记录犯规
                      </button>
                      <button
                        onClick={() => setShowReferee((v) => !v)}
                        className="min-h-touch rounded-xl border border-border bg-surface text-xs"
                      >
                        裁判裁定
                      </button>
                    </div>
                  )}

                  {showFoul && playing && (
                    <Card>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold">犯规原因</span>
                        <button
                          className="min-h-touch text-[11px] text-muted"
                          onClick={() => setShowFoul(false)}
                        >
                          收起
                        </button>
                      </div>
                      <div className="grid gap-1.5">
                        {foulReasons.map((r) => (
                          <button
                            key={r.value}
                            onClick={() => {
                              setShowFoul(false);
                              run(r.action.type, r.action.payload);
                            }}
                            className="min-h-touch rounded-lg border border-border bg-surface-2 px-3 text-left text-xs"
                          >
                            {r.label}
                            {r.hint && (
                              <span className="ml-1.5 text-[10px] text-muted">{r.hint}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </Card>
                  )}

                  {showReferee && playing && (
                    <Card>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold">裁判裁定</span>
                        <button
                          className="min-h-touch text-[11px] text-muted"
                          onClick={() => setShowReferee(false)}
                        >
                          收起
                        </button>
                      </div>
                      <p className="mb-2 text-[11px] leading-relaxed text-muted">
                        这两种操作只声明本局到此为止，胜方仍由规则引擎记录。
                      </p>
                      <div className="grid gap-1.5">
                        <button
                          onClick={() => {
                            setShowReferee(false);
                            run('COMPLETE_FRAME');
                          }}
                          className="min-h-touch rounded-lg border border-border bg-surface-2 px-3 text-left text-xs"
                        >
                          结束当前局
                          <span className="mt-0.5 block text-[10px] text-muted">
                            判当前击球方胜，停在本局结果页
                          </span>
                        </button>
                        <button
                          onClick={() => {
                            setShowReferee(false);
                            run('CONCEDE');
                          }}
                          className="min-h-touch rounded-lg border border-border bg-surface-2 px-3 text-left text-xs"
                        >
                          认输
                          <span className="mt-0.5 block text-[10px] text-muted">
                            由对手获得本局
                          </span>
                        </button>
                      </div>
                    </Card>
                  )}

                  {/* 追分每结算一次就换下一局，没有「本方回合」要手动结束 */}
                  {playing && !isChase && (
                    <button
                      onClick={() => run('END_TURN')}
                      className="min-h-touch w-full rounded-xl border border-border bg-surface text-xs text-muted"
                    >
                      本方回合结束（不判犯规，直接换手）
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ---------- 更多 ---------- */}
          {showMore && (
            <div className="mt-4 space-y-3">
              <Card>
                <div className="text-sm font-semibold">比赛信息</div>
                <dl className="mt-2 grid gap-1.5 text-xs">
                  {[
                    ['分享码', m.shareCode],
                    ['规则集', `${m.ruleSetSnapshot.name} v${m.ruleSetSnapshot.version}`],
                    ['赛制', m.matchFormat === 'singles' ? '单人对抗' : m.matchFormat],
                    ['事件数', String(m.eventSeq)],
                    ['创建时间', new Date(m.createdAt).toLocaleString('zh-CN')],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3">
                      <dt className="text-muted">{k}</dt>
                      <dd className="truncate font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
                <button
                  onClick={() => navigate(`/display/${m.id}`)}
                  className="mt-3 min-h-touch w-full rounded-xl border border-border bg-surface-2 text-xs"
                >
                  大屏展示
                </button>
              </Card>

              <Card>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold">事件日志</span>
                  <span className="text-[11px] text-muted">只追加 · {log.length}</span>
                </div>
                <div className="grid max-h-56 gap-1 overflow-y-auto text-[11px]">
                  {log.map((e) => (
                    <div key={e.id} className="flex justify-between gap-2">
                      <span>{EVENT_LABELS[e.type] ?? e.type}</span>
                      <span className="tnum text-muted">
                        {new Date(e.timestamp).toLocaleTimeString('zh-CN')}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>

              {/* 不限局数的比赛没有自动收场，必须有人工出口。
                  COMPLETE_MATCH 是管理员动作：按局数或总分判定领先者。
                  确认弹层是全局的（底部操作栏也能唤起）。 */}
              {!ended && (
                <Card>
                  <button
                    onClick={() => setConfirmEnd(true)}
                    className="min-h-touch w-full rounded-lg border border-border text-xs"
                  >
                    结束比赛
                  </button>
                  <p className="mt-2 text-[11px] text-muted">
                    {isChase ? '按累计总分判定名次。' : '按已赢局数判定，领先者获胜。'}
                  </p>
                </Card>
              )}

              {cmd.canCancel && (
                <Card>
                  {confirmCancel ? (
                    <>
                      <p className="text-xs text-muted">
                        取消后比赛将标记为「已取消」，记录仍会保留。确认？
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          className="min-h-touch flex-1 rounded-lg bg-danger text-xs text-white"
                          onClick={() => {
                            setConfirmCancel(false);
                            run('CANCEL_MATCH');
                          }}
                        >
                          确认取消
                        </button>
                        <button
                          className="min-h-touch flex-1 rounded-lg border border-border text-xs"
                          onClick={() => setConfirmCancel(false)}
                        >
                          再想想
                        </button>
                      </div>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmCancel(true)}
                      className="min-h-touch w-full rounded-lg border border-danger/40 text-xs text-danger"
                    >
                      取消比赛
                    </button>
                  )}
                </Card>
              )}
            </div>
          )}

          {ended && (
            <div className="mt-5 flex gap-2">
              <button
                className="min-h-touch flex-1 rounded-xl border border-border bg-surface text-sm"
                onClick={() => navigate('/history')}
              >
                查看历史
              </button>
              <button
                className="min-h-touch flex-1 rounded-xl bg-felt text-sm text-white"
                onClick={() => navigate('/')}
              >
                返回首页
              </button>
            </div>
          )}
        </Container>
      </main>

      {/* ---------- 底部操作栏 ---------- */}
      {!ended && (
        <ActionBar>
          {m.status === 'FRAME_END' ? (
            /*
              本局胜负已定，主操作变成「下一局」。
              此时再摆两个「谁赢了」是误导 —— 它们会把分记到下一局去。
            */
            <button
              disabled={busy}
              onClick={() => void startMatch()}
              className="min-h-[68px] w-full rounded-xl border-2 border-felt-strong bg-felt text-base font-semibold text-white transition-colors disabled:opacity-50 active:scale-[0.98]"
            >
              开始下一局
            </button>
          ) : isChase ? (
            /*
              追分没有「这一局谁赢了」：分是逐个得分类型累出来的，
              所以主操作改成「结束并结算」，避免记分员被一个不存在的概念困住。
            */
            <button
              disabled={busy}
              onClick={() => setConfirmEnd(true)}
              className="min-h-[60px] w-full rounded-xl border-2 border-border bg-surface-2 text-base font-semibold transition-colors disabled:opacity-50 active:scale-[0.98]"
            >
              结束比赛
              <span className="mt-0.5 block text-[10px] font-normal text-muted">
                按累计总分结算
              </span>
            </button>
          ) : (
            /*
              主操作永远只有一件事：「本局谁赢了」。
              即使在 READY（还没开始），点它也会自动开赛再记分 ——
              记分员不该为了记一局先学一遍状态机。
            */
            <div className="grid grid-cols-2 gap-2">
              {m.players.slice(0, 4).map((p, i) => (
                <button
                  key={i}
                  disabled={busy}
                  onClick={() => void awardFrame(i)}
                  className={cn(
                    'min-h-[68px] rounded-xl border-2 text-base font-semibold transition-colors',
                    'disabled:opacity-50 active:scale-[0.98]',
                    i === m.activePlayerIndex && playing
                      ? 'border-felt-strong bg-felt text-white'
                      : 'border-border bg-surface-2 text-text',
                  )}
                >
                  <span className="block truncate px-2">{p.displayName} 赢</span>
                  <span className="mt-0.5 block text-[10px] font-normal opacity-70">
                    记 1 局
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* 次要操作：开始 / 暂停 / 撤销 / 重做 */}
          <div className="mt-2 grid grid-cols-3 gap-2">
            {/* 走到这里一定不是 FRAME_END（那个分支的主操作是「开始下一局」），
                所以这一格只负责 开始比赛 / 暂停 / 继续。 */}
            {cmd.canStart ? (
              <ActionButton label="开始比赛" onClick={() => void startMatch()} />
            ) : (
              <ActionButton
                label={cmd.canPause ? '暂停' : '继续'}
                onClick={() => run(cmd.canPause ? 'PAUSE_MATCH' : 'RESUME_MATCH')}
              />
            )}
            <ActionButton label="撤销" disabled={!undoable} onClick={() => void undo()} />
            <ActionButton label="重做" disabled={!redoable} onClick={() => void redo()} />
          </div>
        </ActionBar>
      )}

      {/* 全局「结束比赛」确认：底部操作栏与「更多」都能唤起同一个确认 */}
      {confirmEnd && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-6"
          onClick={() => setConfirmEnd(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-surface p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold">结束这场比赛？</p>
            <p className="mt-1 text-xs text-muted">
              {isChase
                ? '按累计总分判定名次。结束后不能再记分，记录会保留。'
                : '按已赢局数判定，领先者获胜。记录会保留。'}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                className="min-h-touch rounded-xl bg-felt text-sm font-semibold text-white"
                onClick={() => {
                  setConfirmEnd(false);
                  run('COMPLETE_MATCH');
                }}
              >
                确认结束
              </button>
              <button
                className="min-h-touch rounded-xl border border-border text-sm"
                onClick={() => setConfirmEnd(false)}
              >
                再想想
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rejected-command notice */}
      {lastError && (
        <div className="pointer-events-none fixed inset-x-0 bottom-28 z-30 flex justify-center px-4">
          <div className="rounded-full bg-danger px-4 py-2 text-xs text-white shadow-lg">
            操作不被允许：{lastError}
          </div>
        </div>
      )}
    </div>
  );
}
