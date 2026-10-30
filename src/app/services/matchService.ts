import type {
  Match,
  MatchCommand,
  MatchEvent,
  MatchPlayer,
  MatchPlayerInput,
  MatchTemplate,
  GameType,
  FrameResult,
} from '@core/types';
import { MATCH_SCHEMA_VERSION, snapshotRuleSet, isEngineCommand } from '@core/types';
import { getEngine } from '@core/engine/registry';
import { registerPlaceholderEngines } from '@core/engine/noopEngine';
import { canApplyCommand, statusForCommand, isTerminal } from '@core/match/stateMachine';
import { COMMAND_EVENT_MAP } from '@core/types';
import { createId } from '@core/util/id';
import { createShareCode } from '@core/util/shareCode';
import { clone } from '@core/util/serialization';
import type { Repositories } from '@data/index';
import { reconstructMatchFromEvents } from '@data/recovery';
import { repos as defaultRepos } from '../repos';
import { playerService } from './playerService';

// Ensure engines are registered before any match is created.
registerPlaceholderEngines();

interface ApplyResult {
  match: Match;
  events: MatchEvent[];
}

/** Normalizes UI input (existing player / temp player / bare name) → MatchPlayer. */
function toMatchPlayers(inputs: MatchPlayerInput[]): MatchPlayer[] {
  const list = inputs.length ? inputs : [{ displayName: '' }, { displayName: '' }];
  return list.slice(0, 8).map((input, i) => {
    const name = input.displayName?.trim() || `选手 ${i + 1}`;
    const playerId = input.playerId ?? null;
    return {
      playerId,
      displayName: name,
      // A player is anonymous unless it is backed by a real Player record.
      isAnonymous: input.isAnonymous ?? playerId === null,
      seat: i,
    };
  });
}

interface FrameDecidingPayload {
  frame?: number;
  winnerPlayerIndex?: number;
  loserPlayerIndex?: number;
  winnerPlayerId?: string | null;
  reason?: string;
}

/**
 * Orchestrates the full command pipeline:
 *   command → engine.reduce → events → snapshot + record → (in-memory history)
 *
 * Owns NO UI state. The store wraps this and maintains the past/present/future
 * stacks for O(1) undo/redo. Persistence here always appends to the EventLog
 * (never mutates it) and keeps the Snapshot cache in sync.
 *
 * PHASE 3A rule: the SERVICE DOES NOT KNOW ANY GAME RULES. It never decides who
 * won a frame. It forwards commands to the engine and then only *aggregates*
 * whatever FRAME_WON / FRAME_LOST facts the engine produced (Race To is a
 * match-format concern, not a game rule).
 */
export class MatchService {
  private repos: Repositories;

  constructor(repos: Repositories = defaultRepos) {
    this.repos = repos;
  }

  private ctxOf(m: Match) {
    return {
      matchId: m.id,
      gameType: m.gameType,
      players: m.players,
      ruleSet: m.ruleSetSnapshot,
      target: m.target,
      matchFormat: m.matchFormat,
    };
  }

  async createMatch(
    template: MatchTemplate,
    players: MatchPlayerInput[],
    opts?: { target?: number; displayName?: string },
  ): Promise<{ match: Match; event: MatchEvent }> {
    const now = Date.now();
    const id = createId('m');
    const matchPlayers = toMatchPlayers(players);

    // target = 0 表示「不限局数」（用户主动不设比赛目标），是合法值；
    // 只有 undefined / 非法值才回落到模板默认。
    const target =
      typeof opts?.target === 'number' && opts.target >= 0 && Number.isInteger(opts.target)
        ? opts.target
        : template.target;

    const ruleSnap = snapshotRuleSet(template.ruleSet, now);
    const engine = getEngine(template.gameType as GameType);
    const ctx = {
      matchId: id,
      gameType: template.gameType,
      players: matchPlayers,
      ruleSet: ruleSnap,
      target,
      matchFormat: template.matchFormat,
    };
    const engineState = engine ? engine.createInitialState(ctx) : {};

    const match: Match = {
      id,
      shareCode: createShareCode(),
      displayName: opts?.displayName?.trim() || template.name,
      gameType: template.gameType,
      ruleSetSnapshot: ruleSnap,
      matchFormat: template.matchFormat,
      players: matchPlayers,
      activePlayerIndex: 0,
      status: 'READY',
      currentFrame: 1,
      target,
      engineState,
      engineStateVersion: 0,
      // MATCH_CREATED is event #1 for this match.
      eventSeq: 1,
      schemaVersion: MATCH_SCHEMA_VERSION,
      frames: [],
      winnerPlayerId: null,
      createdAt: now,
      updatedAt: now,
    };

    const event: MatchEvent = {
      id: createId('ev'),
      matchId: id,
      timestamp: now,
      seq: 0,
      type: 'MATCH_CREATED',
      payload: { match },
    };

    await this.repos.eventLog.append(id, event);
    await this.repos.snapshot.save(id, match);
    await this.repos.repository.putMatch(match);

    const knownIds = matchPlayers
      .map((p) => p.playerId)
      .filter((pid): pid is string => typeof pid === 'string' && pid.length > 0);
    if (knownIds.length) {
      try {
        await playerService.touch(knownIds);
      } catch {
        // Recency is a convenience; never fail match creation over it.
      }
    }

    return { match, event };
  }

  async applyCommand(current: Match, command: MatchCommand): Promise<ApplyResult> {
    if (!canApplyCommand(current, command.type)) {
      throw new Error(`Command ${command.type} not allowed in status ${current.status}`);
    }

    const engine = getEngine(current.gameType as GameType);
    const ctx = this.ctxOf(current);
    const reduced = engine
      ? engine.reduce(current.engineState, command, ctx)
      : { state: current.engineState, events: [] as MatchEvent[] };

    const now = Date.now();
    const events: MatchEvent[] = [];

    let { currentFrame, frames, winnerPlayerId, activePlayerIndex, status } = current;

    // ---- 1. lifecycle event (if the command implies one) -------------------
    // Engine commands never synthesize a lifecycle event: the engine's own
    // events are the facts, and inventing a second one would duplicate them.
    const coreType = isEngineCommand(command.type)
      ? undefined
      : COMMAND_EVENT_MAP[command.type];
    if (coreType) {
      events.push({
        id: createId('ev'),
        matchId: current.id,
        timestamp: now,
        playerId: command.playerId,
        type: coreType,
        payload: command.payload ?? {},
      });
    }

    // ---- 2. engine events --------------------------------------------------
    for (const ee of reduced.events) {
      events.push({
        ...ee,
        id: ee.id || createId('ev'),
        matchId: current.id,
        timestamp: ee.timestamp || now,
        playerId: ee.playerId ?? command.playerId,
      });
    }

    // ---- 3. derive match-level facts from the engine's events -------------
    // Scores come ONLY from FRAME_WON / FRAME_LOST. No placeholder winner.
    for (const e of events) {
      if (e.type !== 'FRAME_WON' && e.type !== 'FRAME_LOST') continue;
      if (frames.some((f) => f.index === currentFrame)) {
        // Idempotent: a frame is only recorded once.
        continue;
      }
      const p = e.payload as FrameDecidingPayload;
      const winnerIndex =
        typeof p.winnerPlayerIndex === 'number' ? p.winnerPlayerIndex : activePlayerIndex;
      const idx = typeof p.frame === 'number' && p.frame > 0 ? p.frame : currentFrame;

      // 计分制玩法把本局分数快照一起存下来 —— 排名总览要跨局累计，
      // 而分数只有引擎知道（service 不猜）。
      const frameScores = engine?.getFrameScores?.(reduced.state) ?? null;

      // Rewrite the payload so EventLog replay rebuilds scores without us.
      e.payload = {
        ...e.payload,
        frame: idx,
        winnerPlayerIndex: winnerIndex,
        winnerPlayerId: current.players[winnerIndex]?.playerId ?? null,
        ...(frameScores ? { scores: frameScores } : {}),
      };

      frames = [
        ...frames,
        {
          index: idx,
          winnerPlayerIndex: winnerIndex,
          winnerPlayerId: current.players[winnerIndex]?.playerId ?? null,
          detail: `${current.players[winnerIndex]?.displayName ?? ''} Win`.trim(),
          ...(frameScores ? { scores: frameScores } : {}),
        },
      ];
      currentFrame = idx + 1;
      status = 'FRAME_END';
      activePlayerIndex = winnerIndex;
    }

    // ---- 4. lifecycle status / seat bookkeeping ---------------------------
    let nextEngineState = reduced.state;

    // Starting a match also opens its first/next frame, so the EventLog records
    // the full MATCH_STARTED → FRAME_STARTED pair the spec asks for.
    if (command.type === 'START_MATCH') {
      const openingFrame = current.status === 'FRAME_END' ? current.currentFrame : 1;
      // A fresh frame begins; the winner of the previous frame breaks first.
      const lastFrame = frames[frames.length - 1];
      if (current.status === 'FRAME_END' && lastFrame) {
        activePlayerIndex = lastFrame.winnerPlayerIndex;
      }
      // The engine owns its own frame lifecycle — ask it to reset, don't poke
      // into engineState internals from the service.
      if (engine?.startFrame) {
        nextEngineState = engine.startFrame(
          nextEngineState,
          activePlayerIndex,
          this.ctxOf(current),
        );
      }
      events.push({
        id: createId('ev'),
        matchId: current.id,
        timestamp: now,
        type: 'FRAME_STARTED',
        payload: { frame: openingFrame },
      });
    }

    // Engine commands may move the active seat themselves (via TURN_ENDED).
    if (isEngineCommand(command.type)) {
      const engineActive = this.engineActiveSeat(reduced.state);
      if (typeof engineActive === 'number') activePlayerIndex = engineActive;
    }

    let nextStatus = statusForCommand(command.type) ?? status;

    if (command.type === 'COMPLETE_MATCH') {
      // 整场累计的玩法（追分）没有「局」：把总分当成一局快照落下来，
      // 否则胜方和排名都拿不到分数。事件同样带上，保证重放不丢。
      const totals = engine?.getFrameScores?.(reduced.state) ?? null;
      if (frames.length === 0 && totals) {
        let best = 0;
        for (let i = 1; i < current.players.length; i += 1) {
          if ((totals[i] ?? 0) > (totals[best] ?? 0)) best = i;
        }
        const winId = current.players[best]?.playerId ?? null;
        winnerPlayerId = winId;
        frames = [
          {
            index: currentFrame,
            winnerPlayerIndex: best,
            winnerPlayerId: winId,
            detail: `总分 ${totals[best] ?? 0}`,
            scores: totals,
          },
        ];
        const wonEvent = events.find((e) => e.type === 'MATCH_WON');
        if (wonEvent) {
          wonEvent.payload = {
            ...wonEvent.payload,
            winnerPlayerIndex: best,
            winnerPlayerId: winId,
            scores: totals,
          };
        }
      } else {
        // Ending the series is a match-level decision. The winner is whoever
        // leads on frames — derived from recorded results, never from "who was
        // on strike".
        winnerPlayerId = this.leaderOf(frames, current.players);
      }
    }

    if (command.type === 'SWITCH_PLAYER') {
      activePlayerIndex = (activePlayerIndex + 1) % Math.max(1, current.players.length);
    }

    // Race To: once a player reaches the target, the series is decided.
    //
    // 自动收场：记分器不该让人再点一次「结束比赛」。
    // 谁先到 target 谁就赢下整场，这是 Race To 的定义，不是额外操作。
    const clinched = this.clinchedSeat(frames, current.target);
    if (clinched !== null) {
      const leader = current.players[clinched];
      if (leader) {
        winnerPlayerId = leader.playerId ?? winnerPlayerId;
      }
      if (nextStatus === 'FRAME_END') {
        nextStatus = 'MATCH_END';
      }
    }

    // 引擎也可以直接宣布「整场结束」（例如斯诺克认输）。
    // 计分类玩法（六球/四球）可能在只打了一局时就分出整场胜负，
    // Race To 的局数口径对不上，所以必须让引擎有机会收场。
    if (
      engine?.isMatchComplete(nextEngineState) &&
      !isTerminal(nextStatus)
    ) {
      const w = engine.getWinner(nextEngineState);
      const seat = w === null ? null : Number(w);
      if (seat !== null && Number.isInteger(seat)) {
        const leader = current.players[seat];
        if (leader) winnerPlayerId = leader.playerId ?? winnerPlayerId;
      }
      nextStatus = 'MATCH_END';
    }

    // Stamp a monotonic sequence on EVERY event, including the ones appended
    // above (FRAME_STARTED). `eventSeq` counts every event ever appended
    // including MATCH_CREATED, so the next free seq is exactly that number.
    // This is what makes replay order deterministic when timestamps collide.
    let seqCursor = current.eventSeq;
    for (const e of events) {
      e.seq = seqCursor;
      seqCursor += 1;
    }

    const match: Match = {
      ...clone(current),
      engineState: nextEngineState,
      engineStateVersion: current.engineStateVersion + 1,
      status: nextStatus,
      currentFrame,
      frames,
      winnerPlayerId,
      activePlayerIndex,
      eventSeq: current.eventSeq + events.length,
      updatedAt: now,
    };

    // Persistence is awaited so the snapshot/record are consistent before any
    // subsequent read (recovery, tests). UI updates from the returned value.
    if (events.length > 0) {
      await this.repos.eventLog.appendMany(current.id, events);
    }
    await this.repos.snapshot.save(current.id, match);
    await this.repos.repository.putMatch(match);

    return { match, events };
  }

  /**
   * Read the engine's own active seat, without the service knowing the game.
   * Engines that expose `activePlayerIndex` (eight-ball does) drive turn order.
   */
  private engineActiveSeat(state: unknown): number | null {
    if (state && typeof state === 'object' && 'activePlayerIndex' in state) {
      const v = (state as { activePlayerIndex?: unknown }).activePlayerIndex;
      if (typeof v === 'number' && Number.isInteger(v)) return v;
    }
    return null;
  }

  private leaderOf(frames: FrameResult[], players: MatchPlayer[]): string | null {
    const wins = players.map(() => 0);
    for (const f of frames) {
      const cur = wins[f.winnerPlayerIndex];
      if (cur !== undefined) wins[f.winnerPlayerIndex] = cur + 1;
    }
    let best = 0;
    for (let i = 1; i < wins.length; i += 1) {
      if ((wins[i] ?? 0) > (wins[best] ?? 0)) best = i;
    }
    return players[best]?.playerId ?? null;
  }

  /**
   * Which seat (if any) has already reached the Race-To target.
   *
   * `target <= 0` 表示「不限局数」—— 谁都不自动收场，由裁判手动结束。
   */
  private clinchedSeat(frames: FrameResult[], target: number): number | null {
    if (!Number.isInteger(target) || target <= 0) return null;
    const wins = new Map<number, number>();
    for (const f of frames) {
      wins.set(f.winnerPlayerIndex, (wins.get(f.winnerPlayerIndex) ?? 0) + 1);
    }
    for (const [seat, n] of wins) {
      if (n >= target) return seat;
    }
    return null;
  }

  async recover(matchId: string): Promise<Match | null> {
    const snap = await this.repos.snapshot.load(matchId);
    if (snap) return snap;

    const events = await this.repos.eventLog.listEvents(matchId);
    const replayed = reconstructMatchFromEvents(events);
    if (replayed) return replayed;

    // Last resort only — the EventLog should always win when it exists.
    return this.repos.repository.getMatch(matchId);
  }

  async listEvents(matchId: string): Promise<MatchEvent[]> {
    return this.repos.eventLog.listEvents(matchId);
  }

  async listMatches(filter?: { gameType?: GameType }): Promise<Match[]> {
    return this.repos.repository.listMatches(filter);
  }

  /**
   * 记录一次撤销。
   *
   * UNDO 本身也是一条 append 进 EventLog 的事件，所以它同样要占一个 seq。
   * 关键在于 **eventSeq 必须单调递增**：撤销会把 current 换回一个更早的
   * Match（它的 eventSeq 更小），如果不在这里 +1，下一条真实事件就会
   * 拿到和 UNDO 相同的 seq —— 日志里出现两个 #6，重放顺序就不再确定。
   *
   * 因此返回的是「撤销后的状态 + 已递增的 eventSeq」，调用方应当用它
   * 作为新的 current。
   */
  async recordUndo(
    match: Match,
    targetEventIds: string[],
  ): Promise<{ event: MatchEvent; match: Match }> {
    const event: MatchEvent = {
      id: createId('ev'),
      matchId: match.id,
      timestamp: Date.now(),
      seq: match.eventSeq,
      type: 'UNDO',
      payload: { targetEventIds },
    };
    const next: Match = { ...match, eventSeq: match.eventSeq + 1, updatedAt: event.timestamp };
    await this.repos.eventLog.append(match.id, event);
    await this.repos.snapshot.save(match.id, next);
    await this.repos.repository.putMatch(next);
    return { event, match: next };
  }

  /** 同 recordUndo：REDO 也占一个 seq，eventSeq 必须递增。 */
  async recordRedo(
    match: Match,
    targetEventIds: string[],
  ): Promise<{ event: MatchEvent; match: Match }> {
    const event: MatchEvent = {
      id: createId('ev'),
      matchId: match.id,
      timestamp: Date.now(),
      seq: match.eventSeq,
      type: 'REDO',
      payload: { targetEventIds },
    };
    const next: Match = { ...match, eventSeq: match.eventSeq + 1, updatedAt: event.timestamp };
    await this.repos.eventLog.append(match.id, event);
    await this.repos.snapshot.save(match.id, next);
    await this.repos.repository.putMatch(next);
    return { event, match: next };
  }
}
