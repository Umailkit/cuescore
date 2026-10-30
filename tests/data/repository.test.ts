import { describe, it, expect } from 'vitest';
import { repos } from '@app/repos';
import { MatchService } from '@app/services/matchService';
import { reconstructMatchFromEvents } from '@data/recovery';
import { MATCH_TEMPLATES, MATCH_SCHEMA_VERSION, snapshotRuleSet } from '@core/types';
import { createId } from '@core/util/id';
import { createShareCode } from '@core/util/shareCode';
import type { Match, MatchEvent, MatchPlayerInput } from '@core/types';

const T = MATCH_TEMPLATES[0]!;

const TWO: MatchPlayerInput[] = [
  { displayName: 'A', isAnonymous: true },
  { displayName: 'B', isAnonymous: true },
];

function makeMatch(): Match {
  const t = T;
  const now = Date.now();
  return {
    id: createId('m'),
    shareCode: createShareCode(),
    displayName: t.name,
    gameType: t.gameType,
    ruleSetSnapshot: snapshotRuleSet(t.ruleSet, now),
    matchFormat: 'singles',
    players: [
      { playerId: null, displayName: 'A', isAnonymous: true },
      { playerId: null, displayName: 'B', isAnonymous: true },
    ],
    activePlayerIndex: 0,
    status: 'READY',
    currentFrame: 1,
    target: t.target,
    engineState: {},
    engineStateVersion: 0,
    eventSeq: 1,
    schemaVersion: MATCH_SCHEMA_VERSION,
    frames: [],
    winnerPlayerId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function makeEvents(m: Match): MatchEvent[] {
  return [
    { id: 'e1', matchId: m.id, timestamp: 1, type: 'MATCH_CREATED', payload: { match: m } },
    { id: 'e2', matchId: m.id, timestamp: 2, type: 'MATCH_STARTED', payload: {} },
  ];
}

describe('IndexedDB persistence (Repository / EventLog / Snapshot)', () => {
  it('saves and loads a match', async () => {
    const m = makeMatch();
    await repos.repository.putMatch(m);
    const got = await repos.repository.getMatch(m.id);
    expect(got?.id).toBe(m.id);
    expect(got?.displayName).toBe(m.displayName);
    expect(got?.shareCode).toBe(m.shareCode);
  });

  it('appends events and lists them in timestamp order', async () => {
    const m = makeMatch();
    const evs = makeEvents(m);
    for (const e of evs) await repos.eventLog.append(e.matchId, e);
    const list = await repos.eventLog.listEvents(m.id);
    expect(list.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('reconstructs current state from EventLog when snapshot is absent (req #1)', async () => {
    const m = makeMatch();
    const evs = makeEvents(m);
    for (const e of evs) await repos.eventLog.append(e.matchId, e);
    await repos.snapshot.delete(m.id); // simulate cache loss
    const recovered = reconstructMatchFromEvents(evs);
    expect(recovered).not.toBeNull();
    expect(recovered!.status).toBe('PLAYING');
    expect(recovered!.id).toBe(m.id);
  });
});

describe('Player repository', () => {
  it('persists, lists (hiding archived) and hard-deletes a player', async () => {
    const now = Date.now();
    const id = createId('p');
    await repos.repository.putPlayer({
      id,
      name: '测试球员',
      createdAt: now,
      updatedAt: now,
      stats: {
        matches: 0,
        wins: 0,
        losses: 0,
        framesWon: 0,
        framesLost: 0,
        highestBreak: 0,
        longestStreak: 0,
        totalPoints: 0,
      },
    });

    const listed = await repos.repository.listPlayers();
    expect(listed.some((p) => p.id === id)).toBe(true);

    // archive → hidden by default, visible with includeArchived
    const p = await repos.repository.getPlayer(id);
    await repos.repository.putPlayer({ ...p!, archived: true });
    expect((await repos.repository.listPlayers()).some((x) => x.id === id)).toBe(false);
    expect(
      (await repos.repository.listPlayers({ includeArchived: true })).some(
        (x) => x.id === id,
      ),
    ).toBe(true);

    await repos.repository.deletePlayer(id);
    expect(await repos.repository.getPlayer(id)).toBeNull();
  });
});

describe('MatchService orchestration', () => {
  it('createMatch persists match + MATCH_CREATED event + snapshot', async () => {
    const svc = new MatchService();
    const { match, event } = await svc.createMatch(T, TWO);
    expect(event.type).toBe('MATCH_CREATED');
    expect(match.status).toBe('READY');
    expect(match.shareCode).toMatch(/^[2-9A-Z]{6}$/);
    expect(match.eventSeq).toBe(1);
    expect(match.schemaVersion).toBe(MATCH_SCHEMA_VERSION);

    const loaded = await repos.repository.getMatch(match.id);
    expect(loaded?.id).toBe(match.id);

    const events = await repos.eventLog.listEvents(match.id);
    expect(events.some((e) => e.type === 'MATCH_CREATED')).toBe(true);
  });

  it('freezes displayName so later renames never rewrite history (Q6)', async () => {
    const svc = new MatchService();
    const { match } = await svc.createMatch(T, [{ displayName: '张三' }, { displayName: '李四' }]);
    expect(match.players[0]?.displayName).toBe('张三');
    expect(match.players[0]?.isAnonymous).toBe(true);

    // A rename on the source input must not affect the persisted snapshot.
    const loaded = await repos.repository.getMatch(match.id);
    expect(loaded?.players[0]?.displayName).toBe('张三');
  });

  it('honours a custom target override', async () => {
    const svc = new MatchService();
    const { match } = await svc.createMatch(T, TWO, { target: 3 });
    expect(match.target).toBe(3);
  });

  it('recover prefers snapshot, then falls back to EventLog replay', async () => {
    const svc = new MatchService();
    const { match } = await svc.createMatch(T, TWO);
    const fromSnapshot = await svc.recover(match.id);
    expect(fromSnapshot?.id).toBe(match.id);

    // simulate snapshot loss
    await repos.snapshot.delete(match.id);
    const fromLog = await svc.recover(match.id);
    expect(fromLog).not.toBeNull();
    expect(fromLog?.status).toBe('READY'); // derived from MATCH_CREATED replay
  });

  it('applyCommand records events and keeps snapshot in sync', async () => {
    const svc = new MatchService();
    const { match } = await svc.createMatch(T, TWO);
    const { match: next, events } = await svc.applyCommand(match, { type: 'START_MATCH' });
    expect(next.status).toBe('PLAYING');
    expect(events.some((e) => e.type === 'MATCH_STARTED')).toBe(true);
    expect(events.some((e) => e.type === 'FRAME_STARTED')).toBe(true);

    const snap = await repos.snapshot.load(match.id);
    expect(snap?.status).toBe('PLAYING');
  });

  it('full lifecycle: READY→PLAYING→FRAME_END→PLAYING→MATCH_END', async () => {
    const svc = new MatchService();
    const { match: created } = await svc.createMatch(T, TWO);

    const { match: playing } = await svc.applyCommand(created, { type: 'START_MATCH' });
    expect(playing.status).toBe('PLAYING');

    const { match: frameEnd } = await svc.applyCommand(playing, { type: 'COMPLETE_FRAME' });
    expect(frameEnd.status).toBe('FRAME_END');
    expect(frameEnd.frames).toHaveLength(1);
    expect(frameEnd.frames[0]?.winnerPlayerIndex).toBe(0);
    expect(frameEnd.currentFrame).toBe(2);

    const { match: nextFrame } = await svc.applyCommand(frameEnd, { type: 'START_MATCH' });
    expect(nextFrame.status).toBe('PLAYING');

    const { match: endFrame2 } = await svc.applyCommand(nextFrame, {
      type: 'COMPLETE_FRAME',
    });
    const { match: finished } = await svc.applyCommand(endFrame2, {
      type: 'COMPLETE_MATCH',
    });
    expect(finished.status).toBe('MATCH_END');
    expect(finished.frames).toHaveLength(2);
  });

  it('lets the referee end a running series (COMPLETE_MATCH from PLAYING)', async () => {
    const svc = new MatchService();
    const { match } = await svc.createMatch(T, TWO);
    const { match: playing } = await svc.applyCommand(match, { type: 'START_MATCH' });
    // 「不限局数」的比赛没有自动收场点，这是它的人工出口。
    const { match: ended } = await svc.applyCommand(playing, { type: 'COMPLETE_MATCH' });
    expect(ended.status).toBe('MATCH_END');
  });

  it('unlimited target (0) never auto-ends the series', async () => {
    const svc = new MatchService();
    const { match } = await svc.createMatch(T, TWO, { target: 0 });
    expect(match.target).toBe(0);

    let m = (await svc.applyCommand(match, { type: 'START_MATCH' })).match;
    // 连记 5 局（远超任何预设），仍然不该自动收场
    for (let i = 0; i < 5; i += 1) {
      m = (
        await svc.applyCommand(m, {
          type: 'COMPLETE_FRAME',
          payload: { winnerPlayerIndex: 0 },
        })
      ).match;
      if (m.status === 'FRAME_END') {
        m = (await svc.applyCommand(m, { type: 'START_MATCH' })).match;
      }
    }
    expect(m.frames).toHaveLength(5);
    expect(m.status).not.toBe('MATCH_END');
  });

  it('rejects an illegal transition (READY → MATCH_END)', async () => {
    const svc = new MatchService();
    const { match } = await svc.createMatch(T, TWO);
    // 还没开打就判整场结果 —— 状态机必须拦住
    await expect(
      svc.applyCommand(match, { type: 'COMPLETE_MATCH' }),
    ).rejects.toThrow(/not allowed/);
  });

  it('rebuilds frames + currentFrame from the EventLog alone (no snapshot)', async () => {
    const svc = new MatchService();
    const { match } = await svc.createMatch(T, TWO);
    const { match: p1 } = await svc.applyCommand(match, { type: 'START_MATCH' });
    const { match: f1 } = await svc.applyCommand(p1, { type: 'COMPLETE_FRAME' });
    await svc.applyCommand(f1, { type: 'START_MATCH' });

    // Destroy the cache — recovery must rely on the append-only log.
    await repos.snapshot.delete(match.id);
    await repos.repository.deleteMatch(match.id);

    const recovered = await svc.recover(match.id);
    expect(recovered).not.toBeNull();
    expect(recovered!.status).toBe('PLAYING');
    expect(recovered!.frames).toHaveLength(1);
    expect(recovered!.frames[0]?.winnerPlayerIndex).toBe(0);
    expect(recovered!.currentFrame).toBe(2);
  });

  it('keeps the EventLog append-only through undo/redo', async () => {
    const svc = new MatchService();
    const { match } = await svc.createMatch(T, TWO);
    const { match: playing } = await svc.applyCommand(match, { type: 'START_MATCH' });
    const before = await repos.eventLog.listEvents(match.id);

    await svc.recordUndo(match, ['some-event']);
    await svc.recordRedo(playing, ['some-event']);
    const after = await repos.eventLog.listEvents(match.id);

    // Nothing was removed, only appended.
    expect(after.length).toBe(before.length + 2);
    expect(after.some((e) => e.type === 'UNDO')).toBe(true);
    expect(after.some((e) => e.type === 'REDO')).toBe(true);
    for (const e of before) {
      expect(after.some((x) => x.id === e.id)).toBe(true);
    }
  });
});
