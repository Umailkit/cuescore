import type { GameType, Match } from '@core/types';

/**
 * 只有这几个玩法按「分」结算。八球是按局定胜负，没有分数，不参与分值排名。
 */
export const SCORING_GAME_TYPES: readonly GameType[] = [
  'nine-ball',
  'six-ball',
  'four-ball',
  'snooker',
];

/**
 * 一场比赛里每个座位的总分。
 *
 * 唯一数据来源是 `FrameResult.scores` —— 每局结束时引擎交出的分数快照
 * （MatchService 在记帧时写入，并同步进事件 payload 供重放）。
 * 没有该字段的比赛（八球 / 老数据）整场跳过，不做任何推测性补算。
 */
export function seatTotals(m: Match): number[] {
  const totals = m.players.map(() => 0);
  for (const f of m.frames) {
    const scores = f.scores;
    if (!scores) continue;
    for (const [seat, value] of Object.entries(scores)) {
      const i = Number(seat);
      const cur = totals[i];
      if (cur !== undefined && Number.isFinite(value)) totals[i] = cur + value;
    }
  }
  return totals;
}

/** 这场比赛是否带有可统计的分值。 */
export function hasScores(m: Match): boolean {
  return seatTotals(m).some((v) => v !== 0);
}

/**
 * 座位归并键：老玩家按身份（playerId），临时玩家按名字。
 * 返回 name 用于展示 —— 同名临时玩家会合并，这是刻意的（没有账号可区分）。
 */
function seatKey(m: Match, index: number): { key: string; name: string } {
  const p = m.players[index];
  const name = p?.displayName ?? `选手 ${index + 1}`;
  const key = p?.playerId ? `id:${p.playerId}` : `name:${name.trim()}`;
  return { key, name };
}

export interface RankingRow {
  key: string;
  name: string;
  /** 累计总分 */
  total: number;
  /** 参与的计分比赛场次 */
  matches: number;
  /** 累计局数 */
  frames: number;
  /** 单场最高分 */
  best: number;
}

/**
 * 跨比赛累计总分排名。
 *
 * 只统计有分值的比赛；同一座位在每场里各算一行。总分相同的按名字排序，
 * 保证顺序稳定（否则 React key 乱跳）。
 */
export function buildRanking(matches: Match[]): RankingRow[] {
  const acc = new Map<string, RankingRow & { matchIds: Set<string> }>();

  for (const m of matches) {
    const totals = seatTotals(m);
    if (totals.every((v) => v === 0)) continue;

    totals.forEach((total, seat) => {
      const { key, name } = seatKey(m, seat);
      const cur =
        acc.get(key) ??
        ({
          key,
          name,
          total: 0,
          matches: 0,
          frames: 0,
          // 初值取本场分数而不是 0：追分会出现负分，用 0 打底会把
          // 「单场最高」显示成 0，比实际成绩还高。
          best: total,
          matchIds: new Set<string>(),
        } as RankingRow & { matchIds: Set<string> });

      cur.name = name;
      cur.total += total;
      cur.frames += m.frames.length;
      cur.best = Math.max(cur.best, total);
      cur.matchIds.add(m.id);
      cur.matches = cur.matchIds.size;
      acc.set(key, cur);
    });
  }

  return [...acc.values()]
    .map(({ matchIds: _matchIds, ...row }) => row)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'zh-CN'));
}
