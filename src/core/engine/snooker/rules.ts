import type { SnookerRules } from './types';
import { DEFAULT_SNOOKER_RULES } from './types';

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
 * 注意：`variant: '6-red'` 目前只被解析、不参与判定（文档明确"不进入实现"）。
 * 这里如实保留字段，但不假装支持。
 */
export function resolveSnookerRules(
  config: Record<string, unknown> | undefined | null,
): SnookerRules {
  const c = config ?? {};
  const d = DEFAULT_SNOOKER_RULES;
  return {
    variant: asEnum(c.variant, ['15-red', '6-red'] as const, d.variant),
    minFoulPenalty: Math.max(0, asNumber(c.minFoulPenalty, d.minFoulPenalty)),
    freeBall: asBoolean(c.freeBall, d.freeBall),
    snookersRequired: asBoolean(c.snookersRequired, d.snookersRequired),
  };
}
