import type { SixBallRules } from './types';
import { DEFAULT_SIX_BALL_RULES } from './types';

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function asBoolean(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** 归一化 RuleSet.config → 强类型规则；缺失字段回落 CueScore Standard。 */
export function resolveSixBallRules(
  config: Record<string, unknown> | undefined | null,
): SixBallRules {
  const c = config ?? {};
  const d = DEFAULT_SIX_BALL_RULES;
  return {
    perBall: Math.max(0, asNumber(c.perBall, d.perBall)),
    targetPoints: Math.max(1, asNumber(c.targetPoints, d.targetPoints)),
    foulPenalty: Math.max(0, asNumber(c.foulPenalty, d.foulPenalty)),
    foulSwitchesTurn: asBoolean(c.foulSwitchesTurn, d.foulSwitchesTurn),
  };
}
