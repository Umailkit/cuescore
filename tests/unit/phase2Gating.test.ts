import { describe, it, expect } from 'vitest';
import {
  isUnfinished,
  UNFINISHED_STATUSES,
} from '@core/match/stateMachine';
import { isValidShareCode, createShareCode, SHARE_CODE_LENGTH } from '@core/util/shareCode';
import {
  isGamePlayable,
  PHASE2_PLAYABLE,
  MATCH_TEMPLATES,
  templatesForGame,
} from '@core/types';
import { registerPlaceholderEngines } from '@core/engine/noopEngine';
import { getEngine, hasEngine } from '@core/engine/registry';

describe('unfinished match detection (home "继续比赛")', () => {
  it('treats READY/PLAYING/PAUSED/FRAME_END as unfinished', () => {
    expect(isUnfinished('READY')).toBe(true);
    expect(isUnfinished('PLAYING')).toBe(true);
    expect(isUnfinished('PAUSED')).toBe(true);
    expect(isUnfinished('FRAME_END')).toBe(true);
  });

  it('treats MATCH_END/CANCELLED/SETUP as not resumable', () => {
    expect(isUnfinished('MATCH_END')).toBe(false);
    expect(isUnfinished('CANCELLED')).toBe(false);
    expect(isUnfinished('SETUP')).toBe(false);
  });

  it('exposes exactly the four resumable statuses', () => {
    expect([...UNFINISHED_STATUSES]).toEqual([
      'READY',
      'PLAYING',
      'PAUSED',
      'FRAME_END',
    ]);
  });
});

describe('share code', () => {
  it('generates codes of the expected shape', () => {
    const code = createShareCode();
    expect(code).toHaveLength(SHARE_CODE_LENGTH);
    expect(isValidShareCode(code)).toBe(true);
  });

  it('rejects malformed codes', () => {
    expect(isValidShareCode('ABC')).toBe(false);
    expect(isValidShareCode('ABCDE0')).toBe(false); // 0 is excluded
    expect(isValidShareCode('ABCDEI')).toBe(false); // I is excluded
  });
});

describe('game type availability', () => {
  it('all five game types are playable now that they have real engines', () => {
    for (const g of ['eight-ball', 'nine-ball', 'six-ball', 'four-ball', 'snooker'] as const) {
      expect(isGamePlayable(g)).toBe(true);
    }
    expect([...PHASE2_PLAYABLE]).toEqual([
      'eight-ball',
      'nine-ball',
      'six-ball',
      'four-ball',
      'snooker',
    ]);
  });

  /**
   * 这条测试专门盯住一个曾经的隐患：九球被标为"可玩"，但挂的是 NoopEngine ——
   * 能建比赛却没有规则，等于假比赛。现在每个可玩类型都必须有真实引擎。
   */
  it('every playable game type has a real engine (no placeholder rules)', () => {
    registerPlaceholderEngines();
    for (const g of PHASE2_PLAYABLE) {
      expect(hasEngine(g)).toBe(true);
      const engine = getEngine(g);
      expect(engine).not.toBeNull();
      // NoopEngine 的初始状态只有 { started: false }，真实引擎不会这么单薄。
      const initial = engine!.createInitialState({
        matchId: 'm',
        gameType: g,
        players: [
          { playerId: null, displayName: 'A', isAnonymous: true },
          { playerId: null, displayName: 'B', isAnonymous: true },
        ],
        ruleSet: MATCH_TEMPLATES.find((t) => t.gameType === g)!.ruleSet as never,
        target: 7,
        matchFormat: 'singles',
      }) as Record<string, unknown>;
      expect(Object.keys(initial).length).toBeGreaterThan(1);
    }
  });

  it('still exposes templates for every game type', () => {
    for (const g of ['eight-ball', 'nine-ball', 'six-ball', 'four-ball', 'snooker'] as const) {
      expect(templatesForGame(g).length).toBeGreaterThan(0);
    }
  });

  it('every template references a valid ruleSet with provenance', () => {
    for (const t of MATCH_TEMPLATES) {
      expect(t.ruleSet.id).toBeTruthy();
      expect(t.ruleSet.version).toBeTruthy();
      expect(t.ruleSet.source).toBeTruthy();
    }
  });
});
