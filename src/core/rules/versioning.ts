import type { RuleSet } from '../types';

/**
 * RuleSet validation & versioning helpers (req #6).
 * A valid RuleSet always carries provenance (id/name/version/description/source)
 * so we can never silently ship an un-versioned or anonymous ruleset.
 */
export function validateRuleSet(rule: RuleSet): string[] {
  const errors: string[] = [];
  if (!rule.id) errors.push('RuleSet.id is required');
  if (!rule.name) errors.push('RuleSet.name is required');
  if (!rule.version) errors.push('RuleSet.version is required');
  if (!rule.description) errors.push('RuleSet.description is required');
  if (!rule.source) errors.push('RuleSet.source is required');
  if (typeof rule.config !== 'object' || rule.config === null) {
    errors.push('RuleSet.config must be an object');
  }
  return errors;
}

export function isRuleSetValid(rule: RuleSet): boolean {
  return validateRuleSet(rule).length === 0;
}

/** Bump a semver-ish version string's patch component. */
export function bumpVersion(version: string): string {
  const parts = version.split('.');
  const patch = Number(parts[parts.length - 1] ?? '0');
  parts[parts.length - 1] = String(Number.isFinite(patch) ? patch + 1 : 0);
  return parts.join('.');
}
