import type { GameType } from '../types';
import type { GameEngine } from './types';

/**
 * Engine registry. The app resolves an engine by GameType at runtime.
 * PHASE 1 registers only the NoopEngine placeholder; later phases register
 * EightBallEngine, NineBallEngine, … here without touching call sites.
 */
const registry = new Map<GameType, GameEngine>();

export function registerEngine(engine: GameEngine): void {
  registry.set(engine.gameType, engine);
}

export function getEngine(gameType: GameType): GameEngine | null {
  return registry.get(gameType) ?? null;
}

export function hasEngine(gameType: GameType): boolean {
  return registry.has(gameType);
}

export function registeredGameTypes(): GameType[] {
  return [...registry.keys()];
}
