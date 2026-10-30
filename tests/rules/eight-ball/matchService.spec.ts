import { describe, it, expect, beforeAll } from 'vitest';
import { MATCH_TEMPLATES } from '@core/types';
import { MatchService } from '@app/services/matchService';
import { repos } from '@app/repos';
import { getEngine } from '@core/engine/registry';
import { registerPlaceholderEngines } from '@core/engine/noopEngine';
import type { MatchPlayerInput } from '@core/types';

const EIGHT = MATCH_TEMPLATES[0]!;

const TWO: MatchPlayerInput[] = [
  { displayName: 'Alice', isAnonymous: true },
  { displayName: 'Bob', isAnonymous: true },
];

beforeAll(() => {
  registerPlaceholderEngines();
});

describe('engine registry', () => {
  it('registers a real engine for eight-ball', () => {
    const engine = getEngine('eight-ball');
    expect(engine).not.toBeNull();
    expect(engine?.gameType).toBe('eight-ball');
    // A NoopEngine has no createInitialState balls; the real one does.
    const state = engine!.createInitialState({
      matchId: 'm',
      gameType: 'eight-ball',
      players: [
        { playerId: null, displayName: 'A', isAnonymous: true },
        { playerId: null, displayName: 'B', isAnonymous: true },
      ],
      ruleSet: EIGHT.ruleSet as never,
      target: 7,
      matchFormat: 'singles',
    }) as { balls?: unknown };
    expect(state.balls).toBeDefined();
  });

  it('gives nine-ball a real engine state (rules implemented)', () => {
    const engine = getEngine('nine-ball');
    expect(engine).not.toBeNull();
    const state = engine!.createInitialState({
      matchId: 'm',
      gameType: 'nine-ball',
      players: [
        { playerId: null, displayName: 'A', isAnonymous: true },
        { playerId: null, displayName: 'B', isAnonymous: true },
      ],
      ruleSet: EIGHT.ruleSet as never,
      target: 7,
      matchFormat: 'singles',
    }) as { balls?: Record<number, string>; started?: boolean };
    expect(state.balls).toBeDefined();
    expect(state.balls?.[9]).toBe('ON_TABLE');
    expect(state.started).toBeUndefined();
  });
});

describe('MatchService × eight-ball engine', () => {
  it('creates a match with a live eight-ball engine state', async () => {
    const svc = new MatchService();
    const { match } = await svc.createMatch(EIGHT, TWO);
    const state = match.engineState as { balls: Record<number, string> };
    expect(state.balls[1]).toBe('ON_TABLE');
    expect(state.balls[8]).toBe('ON_TABLE');
    await repos.repository.deleteMatch(match.id);
  });

  it('routes BALL_POTTED through the engine and persists the fact', async () => {
    const svc = new MatchService();
    const { match } = await svc.createMatch(EIGHT, TWO);
    const { match: started } = await svc.applyCommand(match, { type: 'START_MATCH' });
    await svc.applyCommand(started, { type: 'BREAK_STARTED' });

    const { match: after, events } = await svc.applyCommand(started, {
      type: 'BALL_POTTED',
      payload: { ball: 3 },
    });
    expect(events.some((e) => e.type === 'BALL_POTTED')).toBe(true);

    const state = after.engineState as { balls: Record<number, string> };
    expect(state.balls[3]).toBe('POCKETED');

    // Match-level score is untouched by a mid-frame pot: no frame ended.
    expect(after.frames).toHaveLength(0);
    await repos.repository.deleteMatch(match.id);
  });

  it('records a frame from FRAME_WON and never from "who was on strike"', async () => {
    const svc = new MatchService();
    const { match } = await svc.createMatch(EIGHT, TWO);
    const { match: started } = await svc.applyCommand(match, { type: 'START_MATCH' });
    const { match: broken } = await svc.applyCommand(started, { type: 'BREAK_STARTED' });

    // P2 concedes → P1 wins, even though the engine's active seat says otherwise.
    const { match: p2Turn } = await svc.applyCommand(broken, { type: 'END_TURN' });
    const { match: decided } = await svc.applyCommand(p2Turn, { type: 'CONCEDE' });

    expect(decided.status).toBe('FRAME_END');
    expect(decided.frames).toHaveLength(1);
    // P2 (index 1) conceded, so the engine awarded the frame to P1 (index 0).
    expect(decided.frames[0]?.winnerPlayerIndex).toBe(0);
    await repos.repository.deleteMatch(match.id);
  });

  it('advances currentFrame after a decided frame', async () => {
    const svc = new MatchService();
    const { match } = await svc.createMatch(EIGHT, TWO);
    const { match: started } = await svc.applyCommand(match, { type: 'START_MATCH' });
    const { match: decided } = await svc.applyCommand(started, { type: 'CONCEDE' });
    expect(decided.currentFrame).toBe(2);
    await repos.repository.deleteMatch(match.id);
  });

  it('starts a fresh frame with a re-racked table', async () => {
    const svc = new MatchService();
    const { match } = await svc.createMatch(EIGHT, TWO);
    const { match: started } = await svc.applyCommand(match, { type: 'START_MATCH' });
    const { match: broken } = await svc.applyCommand(started, { type: 'BREAK_STARTED' });
    const { match: potted } = await svc.applyCommand(broken, {
      type: 'BALL_POTTED',
      payload: { ball: 3 },
    });
    expect((potted.engineState as { balls: Record<number, string> }).balls[3]).toBe(
      'POCKETED',
    );

    const { match: decided } = await svc.applyCommand(potted, { type: 'CONCEDE' });
    const { match: nextFrame } = await svc.applyCommand(decided, { type: 'START_MATCH' });

    const state = nextFrame.engineState as {
      balls: Record<number, string>;
      frameStatus: string;
      break: { completed: boolean };
    };
    expect(state.balls[3]).toBe('ON_TABLE');
    expect(state.frameStatus).toBe('PLAYING');
    expect(state.break.completed).toBe(false);
    expect(nextFrame.status).toBe('PLAYING');
    await repos.repository.deleteMatch(match.id);
  });

  it('recovers the exact engine state from the EventLog alone', async () => {
    const svc = new MatchService();
    const { match } = await svc.createMatch(EIGHT, TWO);
    const { match: started } = await svc.applyCommand(match, { type: 'START_MATCH' });
    const { match: broken } = await svc.applyCommand(started, { type: 'BREAK_STARTED' });
    const { match: p1 } = await svc.applyCommand(broken, {
      type: 'BALL_POTTED',
      payload: { ball: 2 },
    });
    const { match: p2 } = await svc.applyCommand(p1, {
      type: 'BALL_POTTED',
      payload: { ball: 5 },
    });
    const { match: p3 } = await svc.applyCommand(p2, {
      type: 'BALL_POTTED',
      payload: { ball: 6 },
    });

    const liveState = p3.engineState as Record<string, unknown>;

    // Destroy BOTH the snapshot cache and the canonical record.
    await repos.snapshot.delete(match.id);
    await repos.repository.deleteMatch(match.id);

    const recovered = await svc.recover(match.id);
    expect(recovered).not.toBeNull();

    const replayed = recovered!.engineState as Record<string, unknown>;
    expect(replayed.balls).toEqual(liveState.balls);
    expect(replayed.groups).toEqual(liveState.groups);
    expect(replayed.tableStatus).toBe(liveState.tableStatus);
    expect(replayed.activePlayerIndex).toBe(liveState.activePlayerIndex);
    expect(replayed.turnNumber).toBe(liveState.turnNumber);
    expect(replayed.potted).toEqual(liveState.potted);
  });

  it('keeps the EventLog append-only through a full eight-ball sequence', async () => {
    const svc = new MatchService();
    const { match } = await svc.createMatch(EIGHT, TWO);
    const { match: started } = await svc.applyCommand(match, { type: 'START_MATCH' });
    const before = await repos.eventLog.listEvents(match.id);

    await svc.applyCommand(started, { type: 'BREAK_STARTED' });
    const after = await repos.eventLog.listEvents(match.id);

    expect(after.length).toBeGreaterThan(before.length);
    for (const e of before) {
      expect(after.some((x) => x.id === e.id)).toBe(true);
    }
    // Every event carries a monotonic sequence → deterministic replay.
    const seqs = after.map((e) => e.seq).filter((s): s is number => typeof s === 'number');
    expect(seqs.length).toBe(after.length);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    await repos.repository.deleteMatch(match.id);
  });
});
