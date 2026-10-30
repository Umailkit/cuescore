import type { GameType } from './gameType';

/**
 * MatchFormat — PHASE 1 implements only `singles`. The others are reserved in
 * the data model so future phases (doubles / round-robin / knockout) need no
 * schema migration.
 */
export type MatchFormat = 'singles' | 'doubles' | 'round-robin' | 'knockout';

export const MATCH_FORMATS: readonly MatchFormat[] = [
  'singles',
  'doubles',
  'round-robin',
  'knockout',
] as const;

/**
 * A RuleSet MUST carry provenance. We never claim any local default is the
 * universal standard for a game — it is explicitly a "CueScore Standard".
 */
export interface RuleSet {
  id: string;
  name: string;
  version: string;
  description: string;
  source: string;
  /** game-specific tunables (race-to, foul mode, variant, …) */
  config: Record<string, unknown>;
}

/**
 * Frozen copy stored on every match at creation time (req #6). Future changes
 * to the default RuleSet never affect already-created matches.
 */
export interface RuleSetSnapshot extends RuleSet {
  frozenAt: number;
}

export function snapshotRuleSet(rule: RuleSet, frozenAt = Date.now()): RuleSetSnapshot {
  return { ...rule, frozenAt };
}

export function ruleSetId(gameType: GameType, variant = 'cuescore-standard'): string {
  return `${gameType}.${variant}`;
}
