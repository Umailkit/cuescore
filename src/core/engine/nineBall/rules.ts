import type { NineBallRules } from './types';
import { DEFAULT_NINE_BALL_RULES } from './types';

/**
 * 把 RuleSet.config（unknown shape）归一化成强类型规则。
 * 缺失字段一律回落到 CueScore Standard 默认值 —— 不用抛错的方式让老比赛打不开。
 */
function asBoolean(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function asScoringMode(v: unknown, fallback: 'points' | 'sequence'): 'points' | 'sequence' {
  return v === 'points' || v === 'sequence' ? v : fallback;
}

export function resolveNineBallRules(
  config: Record<string, unknown> | undefined | null,
): NineBallRules {
  const c = config ?? {};
  const d = DEFAULT_NINE_BALL_RULES;
  return {
    scoringMode: asScoringMode(c.scoringMode, d.scoringMode),
    targetPoints: Math.max(0, asNumber(c.targetPoints, d.targetPoints)),
    nineOnBreak: asBoolean(c.nineOnBreak, d.nineOnBreak),
    pushOut: asBoolean(c.pushOut, d.pushOut),
    threeFoulsLosesFrame: asBoolean(c.threeFoulsLosesFrame, d.threeFoulsLosesFrame),
    ballInHandOnFoul: asBoolean(c.ballInHandOnFoul, d.ballInHandOnFoul),
    breakRequiresPocketOrRailCount: Math.max(
      0,
      asNumber(c.breakRequiresPocketOrRailCount, d.breakRequiresPocketOrRailCount),
    ),
  };
}
