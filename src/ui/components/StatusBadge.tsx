import type { MatchStatus } from '@core/types';
import { cn } from '../design/cn';

const LABELS: Record<MatchStatus, string> = {
  SETUP: '设置中',
  READY: '准备',
  PLAYING: '进行中',
  PAUSED: '已暂停',
  FRAME_END: '本局结束',
  MATCH_END: '比赛结束',
  CANCELLED: '已取消',
};

const COLORS: Record<MatchStatus, string> = {
  SETUP: 'bg-surface-2 text-muted',
  READY: 'bg-surface-2 text-text',
  PLAYING: 'bg-felt/20 text-felt-strong',
  PAUSED: 'bg-gold/15 text-gold',
  FRAME_END: 'bg-gold/15 text-gold',
  MATCH_END: 'bg-felt/20 text-felt-strong',
  CANCELLED: 'bg-danger/15 text-danger',
};

export function StatusBadge({ status }: { status: MatchStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        COLORS[status],
      )}
    >
      {LABELS[status]}
    </span>
  );
}
