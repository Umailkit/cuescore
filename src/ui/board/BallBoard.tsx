import { cn } from '@ui/design/cn';
import type { BoardBall, BoardView } from '@app/services/boardView';
import type { MatchCommandType } from '@core/types/command';

/**
 * 球台球号面板。
 *
 * 只负责渲染 `BoardView` —— 组件内部 **没有任何规则判断**：
 * 可不可点、是不是目标、是否已进，全部来自引擎派生的 BoardView。
 * 点某颗球要发什么命令也是 BoardView 算好的（斯诺克传 'red'，其余传球号）。
 */

interface BallButtonProps {
  ball: BoardBall;
  onCommand: (action: { type: MatchCommandType; payload?: Record<string, unknown> }) => void;
  disabled: boolean;
}

function BallButton({ ball, onCommand, disabled }: BallButtonProps) {
  const pocketed = ball.status === 'POCKETED';
  const clickable = ball.legalTarget && !disabled;

  return (
    <button
      type="button"
      // 已进袋的球不可再点；非目标球也不可点（但保留可读性）。
      disabled={!clickable}
      aria-label={`${ball.label ?? ball.number} 号球${pocketed ? '（已进袋）' : ''}${
        ball.legalTarget ? ' · 当前目标' : ''
      }`}
      aria-pressed={pocketed}
      data-ball={ball.number}
      data-legal={ball.legalTarget ? 'true' : 'false'}
      data-status={ball.status}
      onClick={() => clickable && onCommand(ball.action)}
      className={cn(
        'relative flex aspect-square w-full items-center justify-center rounded-full',
        'text-base font-bold tabular-nums transition-colors',
        // 移动端触控下限：球径不得小于 44px（见下方 min-w/min-h）。
        'min-h-[44px] min-w-[44px]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-felt-strong',
        // 已进袋：灰化 + 删除线
        pocketed && 'border border-border/60 bg-surface-2/40 text-muted/40 line-through',
        // 彩球（有 tint）但不是当前目标：去色 + 压暗，避免"看起来都能点"
        !pocketed && ball.tint && !ball.legalTarget && 'opacity-40 grayscale',
      )}
      style={
        !pocketed
          ? ball.tint
            ? { backgroundColor: ball.tint, color: ball.number >= 5 ? '#fff' : '#111' }
            : undefined
          : undefined
      }
    >
      {/* 非 tint 球沿用主题配色（八球面板的既有观感） */}
      <span
        className={cn(
          'absolute inset-0 rounded-full',
          !pocketed &&
            !ball.tint &&
            (ball.legalTarget
              ? 'border-2 border-felt-strong bg-felt shadow-sm'
              : 'border border-border bg-surface'),
        )}
      />
      {ball.tint && !pocketed && ball.legalTarget && (
        <span className="absolute inset-0 rounded-full border-2 border-felt-strong shadow-sm" />
      )}
      <span className={cn('relative', !pocketed && !ball.tint && 'text-white')}>
        {ball.label ?? ball.number}
      </span>
      {/* 8 号球标记 */}
      {ball.kind === 'EIGHT' && !pocketed && (
        <span className="absolute -top-1 -right-1 rounded bg-gold px-1 text-[9px] font-bold leading-4 text-black">
          8
        </span>
      )}
    </button>
  );
}

interface BallBoardProps {
  view: BoardView;
  /** 主操作是否可用（例如比赛未开始 / 已暂停则整盘禁用）。 */
  disabled?: boolean;
  onCommand: (action: { type: MatchCommandType; payload?: Record<string, unknown> }) => void;
}

/** 子网格：disabled 由 BallBoard 解好默认值，这里必填。 */
interface GridProps {
  view: BoardView;
  disabled: boolean;
  onCommand: BallBoardProps['onCommand'];
}

export function BallBoard({ view, disabled = false, onCommand }: BallBoardProps) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      {view.kind === 'eight-ball' ? (
        <EightBallGrid view={view} disabled={disabled} onCommand={onCommand} />
      ) : (
        <PlainGrid view={view} disabled={disabled} onCommand={onCommand} />
      )}

      <BoardLegend view={view} />
    </div>
  );
}

/**
 * 八球的 7 列三行布局：7 颗全色 + 8 号居中 + 7 颗花色。
 * 这是八球的台面直觉，其它玩法不适用。
 */
function EightBallGrid({ view, disabled, onCommand }: GridProps) {
  const solids = view.balls.filter((b) => b.kind === 'SOLIDS');
  const eight = view.balls.filter((b) => b.kind === 'EIGHT');
  const stripes = view.balls.filter((b) => b.kind === 'STRIPES');

  return (
    <>
      {/*
        7 列网格 = 一颗球的最小触控单元。
        手机上用 gap-1（4px）而不是 gap-1.5，是为了让 390px 宽时
        每颗球仍有 ≥44px 的可点直径（移动端触控下限），不是审美取舍。
      */}
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {solids.map((b) => (
          <BallButton key={b.number} ball={b} onCommand={onCommand} disabled={disabled} />
        ))}
      </div>

      <div className="my-1.5 grid grid-cols-7 gap-1 sm:my-2 sm:gap-2">
        {eight.map((b) => (
          <div key={b.number} className="col-start-4">
            <BallButton ball={b} onCommand={onCommand} disabled={disabled} />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {stripes.map((b) => (
          <BallButton key={b.number} ball={b} onCommand={onCommand} disabled={disabled} />
        ))}
      </div>
    </>
  );
}

/** 数字球 / 斯诺克：一行铺满，最多 9 颗。 */
function PlainGrid({ view, disabled, onCommand }: GridProps) {
  return (
    <div className="grid grid-cols-5 gap-1 sm:gap-2">
      {view.balls.map((b) => (
        <BallButton key={`${b.number}-${b.label ?? ''}`} ball={b} onCommand={onCommand} disabled={disabled} />
      ))}
    </div>
  );
}

function BoardLegend({ view }: { view: BoardView }) {
  return (
    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] text-muted">
      <span>{view.note}</span>
      <span className="flex items-center gap-2.5">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-felt-strong" />
          可点
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full border border-border bg-surface-2" />
          非目标
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full border border-border/60 bg-surface-2/40" />
          已进袋
        </span>
      </span>
    </div>
  );
}
