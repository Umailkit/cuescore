import { describe, it, expect } from 'vitest';
import {
  validateRuleSet,
  isRuleSetValid,
  bumpVersion,
} from '@core/rules/versioning';
import { MATCH_TEMPLATES, templatesForGame, snapshotRuleSet } from '@core/types';

describe('RuleSet versioning & validation', () => {
  it('every shipped template carries a valid, provenanced RuleSet', () => {
    expect(MATCH_TEMPLATES.length).toBeGreaterThan(0);
    for (const t of MATCH_TEMPLATES) {
      expect(isRuleSetValid(t.ruleSet)).toBe(true);
    }
  });

  it('rejects a RuleSet missing provenance', () => {
    const errors = validateRuleSet({
      id: '',
      name: '',
      version: '',
      description: '',
      source: '',
      config: {},
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('snapshot freezes a copy and stamps frozenAt', () => {
    const base = MATCH_TEMPLATES[0]!.ruleSet;
    const snap = snapshotRuleSet(base);
    expect(snap.frozenAt).toBeTypeOf('number');
    expect(snap.id).toBe(base.id);
    // mutating the original must NOT change the snapshot
    base.version = '9.9.9';
    expect(snap.version).not.toBe('9.9.9');
  });

  it('bumpVersion increments the patch segment', () => {
    expect(bumpVersion('1.0.0')).toBe('1.0.1');
    expect(bumpVersion('2.3.9')).toBe('2.3.10');
  });

  it('provides at least one template per game type', () => {
    for (const g of ['eight-ball', 'nine-ball', 'six-ball', 'four-ball', 'snooker'] as const) {
      expect(templatesForGame(g).length).toBeGreaterThan(0);
    }
  });
});
