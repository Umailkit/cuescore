import { describe, it, expect } from 'vitest';
import { snapshotRuleSet, MATCH_TEMPLATES } from '@core/types';
import type { EngineContext } from '@core/engine/types';
import { EightBallEngine } from '@core/engine/eightBall/engine';
import { formatTrace } from '@core/engine/eightBall/trace';
import { EIGHT_BALL } from '@core/engine/eightBall/types';

const T = MATCH_TEMPLATES[0]!;

function makeCtx(): EngineContext {
  return {
    matchId: 'm-trace',
    gameType: 'eight-ball',
    players: [
      { playerId: 'p1', displayName: 'P1', isAnonymous: false },
      { playerId: 'p2', displayName: 'P2', isAnonymous: false },
    ],
    ruleSet: snapshotRuleSet(T.ruleSet, 1),
    target: 7,
    matchFormat: 'singles',
  };
}

const engine = new EightBallEngine();

describe('RuleTrace', () => {
  it('explains a legal pot', () => {
    const ctx = makeCtx();
    const state = engine.createInitialState(ctx);
    const r = engine.reduce(state, { type: 'BALL_POTTED', payload: { ball: 3 } }, ctx);

    expect(r.trace.command).toBe('BALL_POTTED');
    expect(r.trace.ball).toBe(3);
    expect(r.trace.playerIndex).toBe(0);
    expect(r.trace.validation).toBe('LEGAL');
    expect(r.trace.tableStatusBefore).toBe('OPEN');
    expect(r.trace.events).toContain('BALL_POTTED');
  });

  it('explains an illegal 8-ball', () => {
    const ctx = makeCtx();
    const state = engine.createInitialState(ctx);
    const r = engine.reduce(
      state,
      { type: 'BALL_POTTED', payload: { ball: EIGHT_BALL } },
      ctx,
    );
    expect(r.trace.validation).toBe('ILLEGAL');
    expect(r.trace.decision).toContain('判负');
    expect(r.trace.reasons.join()).toContain('尚未清空');
    expect(r.trace.events).toContain('FRAME_LOST');
  });

  it('records the table phase transition', () => {
    const ctx = makeCtx();
    let state = engine.createInitialState(ctx);
    state = engine.reduce(state, { type: 'BREAK_STARTED' }, ctx).state;
    state = engine.reduce(state, { type: 'BALL_POTTED', payload: { ball: 2 } }, ctx).state;
    const r = engine.reduce(state, { type: 'BALL_POTTED', payload: { ball: 3 } }, ctx);
    expect(r.trace.tableStatusBefore).toBe('OPEN');
    expect(r.trace.tableStatusAfter).toBe('GROUPS_ASSIGNED');
  });

  it('does not leak trace data into the engine state', () => {
    const ctx = makeCtx();
    const state = engine.createInitialState(ctx);
    const r = engine.reduce(state, { type: 'BALL_MISSED' }, ctx);
    expect(r.trace).toBeDefined();
    // The state itself must stay serializable fact-only data.
    expect('trace' in r.state).toBe(false);
    expect('reasons' in r.state).toBe(false);
    const json = JSON.stringify(r.state);
    expect(json).not.toContain('RuleTrace');
  });

  it('formats a readable trace', () => {
    const ctx = makeCtx();
    const state = engine.createInitialState(ctx);
    const r = engine.reduce(
      state,
      { type: 'BALL_POTTED', payload: { ball: EIGHT_BALL } },
      ctx,
    );
    const text = formatTrace(r.trace);
    expect(text).toContain('Command: BALL_POTTED');
    expect(text).toContain('Ball: 8');
    expect(text).toContain('Validation: ILLEGAL');
    expect(text).toContain('Decision:');
    expect(text).toContain('Events:');
  });

  it('marks non-engine commands as IGNORED', () => {
    const ctx = makeCtx();
    const state = engine.createInitialState(ctx);
    const r = engine.reduce(state, { type: 'PAUSE_MATCH' }, ctx);
    expect(r.trace.validation).toBe('IGNORED');
    expect(r.events).toEqual([]);
  });
});
