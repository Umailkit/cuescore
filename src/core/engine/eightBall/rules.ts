import type { EightBallRules } from './types';
import { DEFAULT_EIGHT_BALL_RULES } from './types';

/**
 * RuleSet.config 里出现的地区/赛事差异，统一在这里归一化成强类型规则。
 *
 * 原则（PHASE 3A 第二十八条）：任何存在版本差异的细则都不许在引擎里写死，
 * 必须能从冻结在 Match 上的 RuleSetSnapshot.config 读出来。这样历史比赛永远
 * 按它创建时的规则判定，即便以后默认规则改了。
 */
function asBoolean(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asEnum<T extends string>(
  v: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : fallback;
}

/**
 * 把任意 `RuleSet.config`（unknown shape）解析成规则对象。
 * 缺失字段一律回落到 CueScore Standard 默认值 —— 不用抛错的方式让老比赛打不开。
 */
export function resolveEightBallRules(
  config: Record<string, unknown> | undefined | null,
): EightBallRules {
  const c = config ?? {};
  const d = DEFAULT_EIGHT_BALL_RULES;

  return {
    breakRequiresPocketOrRailCount: Math.max(
      0,
      asNumber(c.breakRequiresPocketOrRailCount, d.breakRequiresPocketOrRailCount),
    ),
    breakPocketContinues: asBoolean(c.breakPocketContinues, d.breakPocketContinues),
    eightOnBreak: asEnum(c.eightOnBreak, ['rerack', 'win', 'lose'] as const, d.eightOnBreak),
    callShot: asBoolean(c.callShot, d.callShot),
    ballInHandOnFoul: asBoolean(c.ballInHandOnFoul, d.ballInHandOnFoul),
    eightBallEarlyLosesFrame: asBoolean(
      c.eightBallEarlyLosesFrame,
      d.eightBallEarlyLosesFrame,
    ),
    opponentBallPocketedIsFoul: asBoolean(
      c.opponentBallPocketedIsFoul,
      d.opponentBallPocketedIsFoul,
    ),
  };
}
