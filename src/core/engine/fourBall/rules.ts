import type { FourBallRules } from './types';
import { DEFAULT_FOUR_BALL_RULES } from './types';

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function asBoolean(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
function asEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/**
 * 归一化 RuleSet.config → 强类型规则。
 *
 * 注意模板里的 config.scoring 是 `{ p1, p2, p3, custom }` 形状，
 * 这里逐字段读取并回落，避免整个对象缺失时崩掉。
 */
export function resolveFourBallRules(
  config: Record<string, unknown> | undefined | null,
): FourBallRules {
  const c = config ?? {};
  const d = DEFAULT_FOUR_BALL_RULES;
  const rawScoring = (c.scoring ?? {}) as Record<string, unknown>;
  return {
    scoring: {
      p1: asNumber(rawScoring.p1, d.scoring.p1),
      p2: asNumber(rawScoring.p2, d.scoring.p2),
      p3: asNumber(rawScoring.p3, d.scoring.p3),
      custom: asNumber(rawScoring.custom, d.scoring.custom),
    },
    foul: asEnum(
      c.foul,
      ['opponent_plus_1', 'opponent_plus_n', 'none'] as const,
      d.foul,
    ),
    foulPenalty: Math.max(0, asNumber(c.foulPenalty, d.foulPenalty)),
    // 0 = 不按目标分结束（追分整场累计）。不能像以前那样钳到 ≥1，
    // 否则任何一次得分都会当场判胜。
    targetPoints: Math.max(0, Math.floor(asNumber(c.targetPoints, d.targetPoints))),
    foulSwitchesTurn: asBoolean(c.foulSwitchesTurn, d.foulSwitchesTurn),
  };
}
