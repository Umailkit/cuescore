/**
 * 追分（Chase）结算规则 —— 四球玩法的计分口径。
 *
 * 规则来自球厅通行的一张表（「追分基本计分规则」）：
 *
 * | 得分类型 | 条件               | 上家赔付 | 下家赔付 | 本家净得 |
 * |----------|--------------------|----------|----------|----------|
 * | 普胜     | 按顺序完成击打     | 4 分     | -        | +4       |
 * | 小金     | 接清台面剩余球     | 7 分     | -        | +7       |
 * | 大金     | 开球后一杆清台     | 10 分    | 10 分    | +20      |
 * | 黄金九   | 开球直接进 9 号    | 4 分     | 4 分     | +8       |
 * | 黑金     | 清台时白球落袋     | 赔付 10  | 赔付 10  | -20      |
 *
 * 关键点：**所有结算都是零和的**。本家净得 = 上家/下家付出的分，
 * 所以引擎只维护每个座位的净分，不做「只加不减」的记账。
 *
 * 座位顺序即「上家 / 下家」：座位 i 的上家是 i-1，下家是 i+1（环形）。
 * 两人局时上家与下家是同一个人，赔付自然叠加（大金 = 对手 -20、本家 +20）。
 */

export type ChaseKind = 'normal' | 'smallGold' | 'bigGold' | 'goldNine' | 'blackGold';

export interface ChasePayer {
  /** 'prev' = 上家，'next' = 下家 */
  side: 'prev' | 'next';
  points: number;
}

export interface ChaseRule {
  kind: ChaseKind;
  label: string;
  /** 结算条件，直接用于 UI 提示 */
  condition: string;
  /** 谁付给本家 */
  payers: readonly ChasePayer[];
  /** true = 本家付给上/下家（黑金） */
  selfPays?: boolean;
}

export const CHASE_RULES: Record<ChaseKind, ChaseRule> = {
  normal: {
    kind: 'normal',
    label: '普胜',
    condition: '按顺序完成击打',
    payers: [{ side: 'prev', points: 4 }],
  },
  smallGold: {
    kind: 'smallGold',
    label: '小金',
    condition: '接清台面剩余球',
    payers: [{ side: 'prev', points: 7 }],
  },
  bigGold: {
    kind: 'bigGold',
    label: '大金',
    condition: '开球后一杆清台',
    payers: [
      { side: 'prev', points: 10 },
      { side: 'next', points: 10 },
    ],
  },
  goldNine: {
    kind: 'goldNine',
    label: '黄金九',
    condition: '开球直接进 9 号',
    payers: [
      { side: 'prev', points: 4 },
      { side: 'next', points: 4 },
    ],
  },
  blackGold: {
    kind: 'blackGold',
    label: '黑金',
    condition: '清台时白球落袋',
    payers: [
      { side: 'prev', points: 10 },
      { side: 'next', points: 10 },
    ],
    selfPays: true,
  },
};

/** UI 按这个顺序排按钮（与规则表的行序一致）。 */
export const CHASE_ORDER: readonly ChaseKind[] = [
  'normal',
  'smallGold',
  'bigGold',
  'goldNine',
  'blackGold',
];

/** 本家的净得分（用于按钮提示与断言）。 */
export function chaseNet(kind: ChaseKind): number {
  const rule = CHASE_RULES[kind];
  const sum = rule.payers.reduce((n, p) => n + p.points, 0);
  return rule.selfPays ? -sum : sum;
}

function seatOf(seat: number, seats: number, side: 'prev' | 'next'): number {
  const delta = side === 'prev' ? -1 : 1;
  return (seat + delta + seats) % seats;
}

/**
 * 一次得分在每个座位上的净变化（零和）。
 *
 * 返回 Record<座位, 分值>；两人局聚合后同一个键只出现一次。
 */
export function chaseDeltas(
  kind: ChaseKind,
  seat: number,
  seats: number,
): Record<number, number> {
  const rule = CHASE_RULES[kind];
  const total = Math.max(1, seats);
  const deltas: Record<number, number> = {};
  const add = (s: number, v: number) => {
    deltas[s] = (deltas[s] ?? 0) + v;
  };

  for (const payer of rule.payers) {
    const other = seatOf(seat, total, payer.side);
    if (rule.selfPays) {
      // 本家赔出去：对方得到，本家失去
      add(other, payer.points);
      add(seat, -payer.points);
    } else {
      // 对方赔给本家
      add(other, -payer.points);
      add(seat, payer.points);
    }
  }

  return deltas;
}

/** 结算摘要，例如「上家 -10、下家 -10、本家 +20」。 */
export function chaseSummary(kind: ChaseKind, seat: number, seats: number): string {
  const deltas = chaseDeltas(kind, seat, seats);
  return Object.entries(deltas)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([s, v]) => {
      const seatNo = Number(s);
      const who = seatNo === seat ? '本家' : `P${seatNo + 1}`;
      return `${who} ${v > 0 ? '+' : ''}${v}`;
    })
    .join('、');
}
