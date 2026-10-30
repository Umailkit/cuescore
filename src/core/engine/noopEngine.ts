import type { GameType } from '../types';
import { GAME_TYPES } from '../types';
import type { EngineContext, EngineResult, GameEngine, ScoreSummary } from './types';
import { registerEngine } from './registry';
import { EightBallEngine } from './eightBall/engine';
import { NineBallEngine } from './nineBall/engine';
import { SixBallEngine } from './sixBall/engine';
import { FourBallEngine } from './fourBall/engine';
import { SnookerEngine } from './snooker/engine';

/**
 * PHASE 1 placeholder engine. It owns NO game rules — it simply satisfies the
 * GameEngine contract so the whole pipeline (create → command → event → snapshot
 * → history) works end-to-end.
 *
 * 现在所有 5 个游戏类型都有真实引擎，占位引擎只为「将来新增的游戏类型」
 * 保留兜底能力，正常情况下不会被注册到任何已实现的类型上。
 */
export interface NoopState {
  started: boolean;
}

class NoopEngine implements GameEngine<NoopState> {
  readonly gameType: GameType;

  constructor(gameType: GameType) {
    this.gameType = gameType;
  }

  createInitialState(_ctx: EngineContext): NoopState {
    return { started: false };
  }

  reduce(state: NoopState, command: import('../types').MatchCommand): EngineResult<NoopState> {
    if (command.type === 'ENGINE_COMMAND') {
      return {
        state,
        events: [
          {
            id: '',
            matchId: '',
            timestamp: 0,
            type: 'ENGINE_EVENT',
            payload: { ...command.payload, note: 'placeholder-engine' },
          },
        ],
      };
    }
    // Lifecycle commands are owned by the service/state machine.
    return { state, events: [] };
  }

  getScoreSummary(_state: NoopState): ScoreSummary {
    return { lines: [] };
  }

  isFrameComplete(_state: NoopState): boolean {
    return false;
  }

  isMatchComplete(_state: NoopState): boolean {
    return false;
  }

  getWinner(_state: NoopState): string | null {
    return null;
  }

  getStatistics(_state: NoopState): unknown {
    return {};
  }
}

/**
 * Game types whose rules are actually implemented.
 * Everything else gets a placeholder so the product skeleton keeps working,
 * but the UI must never pretend those rules exist.
 */
export const IMPLEMENTED_GAME_TYPES: readonly GameType[] = [
  'eight-ball',
  'nine-ball',
  'six-ball',
  'four-ball',
  'snooker',
] as const;

export function isGameEngineImplemented(gameType: GameType): boolean {
  return IMPLEMENTED_GAME_TYPES.includes(gameType);
}

/**
 * Register engines. Real engines are registered AFTER the placeholders so they
 * always win — otherwise a placeholder would shadow the real eight-ball rules.
 */
export function registerPlaceholderEngines(): void {
  for (const g of GAME_TYPES) {
    if (isGameEngineImplemented(g)) continue;
    registerEngine(new NoopEngine(g));
  }
  // Real engines last: they must never be overwritten by a placeholder.
  registerEngine(new EightBallEngine());
  registerEngine(new NineBallEngine());
  registerEngine(new SixBallEngine());
  registerEngine(new FourBallEngine());
  registerEngine(new SnookerEngine());
}
