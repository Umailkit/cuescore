import type { GameType } from './gameType';
import type { RuleSet, MatchFormat } from './ruleset';
import { ruleSetId } from './ruleset';

/**
 * A recommended starting point for a match. Users can start directly or open
 * "自定义规则" to tweak the RuleSet before it is frozen onto the match.
 */
export interface MatchTemplate {
  id: string;
  gameType: GameType;
  name: string;
  description: string;
  matchFormat: MatchFormat;
  target: number;
  ruleSet: RuleSet;
}

/**
 * Recommended RuleSets (CueScore Standard). These are NOT claimed to be the
 * universal rules of any game — they are this product's sensible defaults,
 * and each is frozen into the match on creation (req #6).
 */
const RULESETS: Record<GameType, MatchTemplate['ruleSet']> = {
  'eight-ball': {
    id: ruleSetId('eight-ball'),
    name: 'CueScore Standard 中式八球',
    version: '1.0.0',
    description: '双/多人，Race To 制，胜方开球，打进 8 号球且符合规则即胜该局。',
    source: 'CueScore',
    config: { raceTo: 7, break: 'winner-breaks', eightBallWin: 'clean' },
  },
  'nine-ball': {
    id: ruleSetId('nine-ball'),
    name: 'CueScore Standard 九球',
    version: '1.0.0',
    // 台球厅的九球多数是记分的：进一颗记一分，可以加也可以扣。
    description: '记分制：进一颗球加 1 分，可手动加/扣分，先到 7 分者胜该局。',
    source: 'CueScore',
    config: {
      raceTo: 7,
      scoringMode: 'points',
      targetPoints: 7,
      quickPoints: [1, 4, 8, 10],
      // 清台口径的配置保留在 RuleSet 里，切回 'sequence' 即可用标准规则。
      pushOut: true,
      nineOnBreak: true,
    },
  },
  'six-ball': {
    id: ruleSetId('six-ball'),
    name: 'CueScore Standard 六球',
    version: '1.0.0',
    description: '每球 1 分，先达到目标分者胜。本产品默认口径，非行业统一规则。',
    source: 'CueScore',
    config: { perBall: 1, targetPoints: 7 },
  },
  'four-ball': {
    id: ruleSetId('four-ball'),
    name: 'CueScore Standard 四球',
    version: '1.0.0',
    description: '+1 / +4 / +8 / +10 快捷加分（可扣分）；默认犯规为对手 +1。本产品默认口径，非行业统一规则。',
    source: 'CueScore',
    config: {
      scoring: { p1: 1, p2: 4, p3: 8, custom: 10 },
      quickPoints: [1, 4, 8, 10],
      foul: 'opponent_plus_1',
    },
  },
  snooker: {
    id: ruleSetId('snooker'),
    name: 'CueScore Standard 斯诺克',
    version: '1.0.0',
    description: '标准 15 红；彩球分值 2–7；先达约定局数者胜系列赛。6-red 仅预留 RuleSet。',
    source: 'CueScore',
    config: { variant: '15-red', bestOf: 5, framesToWin: 3 },
  },
};

/**
 * One-click templates. Normal users start from these; advanced users enter
 * "自定义规则" which edits the same RuleSet before freezing it onto the match.
 */
export const MATCH_TEMPLATES: MatchTemplate[] = [
  {
    id: 'eight-ball.standard.2p.rt7',
    gameType: 'eight-ball',
    name: '标准娱乐赛 · 2 人 · Race To 7',
    description: '最常用：两人，先赢 7 局者获胜。',
    matchFormat: 'singles',
    target: 7,
    ruleSet: RULESETS['eight-ball'],
  },
  {
    id: 'nine-ball.standard.2p.rt7',
    gameType: 'nine-ball',
    name: '标准九球 · 2 人 · Race To 7',
    description: '两人，每球 1 分，先到 7 分胜该局；整场先胜 7 局。',
    matchFormat: 'singles',
    target: 7,
    ruleSet: RULESETS['nine-ball'],
  },
  {
    id: 'six-ball.standard.2p.t7',
    gameType: 'six-ball',
    name: '标准六球 · 2 人 · 7 分',
    description: '两人，每球 1 分，先到 7 分者获胜（CueScore Standard）。',
    matchFormat: 'singles',
    target: 7,
    ruleSet: RULESETS['six-ball'],
  },
  {
    id: 'four-ball.standard.2p',
    gameType: 'four-ball',
    name: '标准四球 · 2 人',
    description: '两人，+1/+2/+3 自定义加分（CueScore Standard）。',
    matchFormat: 'singles',
    target: 15,
    ruleSet: RULESETS['four-ball'],
  },
  {
    id: 'snooker.standard.bo5',
    gameType: 'snooker',
    name: '标准斯诺克 · Best Of 5',
    description: '两人，标准 15 红，五局三胜。',
    matchFormat: 'singles',
    target: 3,
    ruleSet: RULESETS['snooker'],
  },
];

export function getTemplate(id: string): MatchTemplate | undefined {
  return MATCH_TEMPLATES.find((t) => t.id === id);
}

export function templatesForGame(gameType: GameType): MatchTemplate[] {
  return MATCH_TEMPLATES.filter((t) => t.gameType === gameType);
}

/**
 * 全部 5 个游戏类型现在都有真实引擎，门控解除。
 *
 * 原本这里是 PHASE 2 的临时门控（只放八球/九球）。注意九球当时虽然被列为
 * "可玩"，但挂的是 NoopEngine —— 能建比赛却没有规则，等于假比赛。
 * 现在五个类型都由真实引擎驱动，门控数组保留（供 UI 渲染"即将支持"用），
 * 但已包含全部类型。
 */
export const PHASE2_PLAYABLE: readonly GameType[] = [
  'eight-ball',
  'nine-ball',
  'six-ball',
  'four-ball',
  'snooker',
];

export function isGamePlayable(gameType: GameType): boolean {
  return PHASE2_PLAYABLE.includes(gameType);
}

export const COMING_SOON_LABEL = '即将支持 · Coming in PHASE 3';
