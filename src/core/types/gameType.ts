/**
 * Supported game types. New variants are added here only — engines, templates
 * and UI read from this single source of truth.
 */
export type GameType =
  | 'eight-ball'
  | 'nine-ball'
  | 'six-ball'
  | 'four-ball'
  | 'snooker';

export const GAME_TYPES: readonly GameType[] = [
  'eight-ball',
  'nine-ball',
  'six-ball',
  'four-ball',
  'snooker',
] as const;

export interface GameTypeMeta {
  id: GameType;
  /** 中文显示名 */
  label: string;
  emoji: string;
  description: string;
}

export const GAME_TYPE_META: Record<GameType, GameTypeMeta> = {
  'eight-ball': {
    id: 'eight-ball',
    label: '中式八球',
    emoji: '🎱',
    description: '双打或多人，Race To 制，胜负以局为单位。',
  },
  'nine-ball': {
    id: 'nine-ball',
    label: '九球',
    emoji: '🎱',
    description: '记分制：按顺序击打 1–9 号球，本局比分累计进总分排名。',
  },
  'six-ball': {
    id: 'six-ball',
    label: '六球',
    emoji: '🎱',
    description: 'CueScore Standard：每球 1 分，先达目标分胜。',
  },
  'four-ball': {
    id: 'four-ball',
    label: '四球',
    emoji: '🎱',
    description: '记分制：+1 / +4 / +8 / +10 快捷档位，也可自定义加减分。',
  },
  snooker: {
    id: 'snooker',
    label: '斯诺克',
    emoji: '🎱',
    description: '标准 15 红，彩球分值 2–7，最高单杆 147。',
  },
};
