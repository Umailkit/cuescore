import { describe, it, expect } from 'vitest';
import {
  canTransition,
  assertTransition,
  statusForCommand,
  isTerminal,
  canApplyCommand,
} from '@core/match/stateMachine';
import type { Match } from '@core/types';

describe('Match state machine', () => {
  it('allows legal transitions', () => {
    expect(canTransition('READY', 'PLAYING')).toBe(true);
    expect(canTransition('PLAYING', 'PAUSED')).toBe(true);
    expect(canTransition('PLAYING', 'FRAME_END')).toBe(true);
    expect(canTransition('FRAME_END', 'PLAYING')).toBe(true);
  });

  it('rejects illegal jumps', () => {
    // 还没开打的比赛不能直接判出整场结果
    expect(canTransition('SETUP', 'PLAYING')).toBe(false);
    expect(canTransition('READY', 'MATCH_END')).toBe(false);
    // 终态不可复活
    expect(canTransition('MATCH_END', 'PLAYING')).toBe(false);
    expect(canTransition('CANCELLED', 'PLAYING')).toBe(false);
  });

  /**
   * PLAYING / PAUSED → MATCH_END 是**允许的**，但只服务于管理员动作
   * `COMPLETE_MATCH`（裁判宣布收场，例如「不限局数」的比赛）。
   * 规则推断出来的整场胜负仍然必须走 FRAME_END → MATCH_END。
   */
  it('allows COMPLETE_MATCH to end a running series', () => {
    expect(canTransition('PLAYING', 'MATCH_END')).toBe(true);
    expect(canTransition('PAUSED', 'MATCH_END')).toBe(true);
    expect(canTransition('FRAME_END', 'MATCH_END')).toBe(true);
  });

  it('assertTransition throws on illegal transition', () => {
    expect(() => assertTransition('READY', 'MATCH_END')).toThrow();
  });

  it('statusForCommand maps lifecycle commands', () => {
    expect(statusForCommand('START_MATCH')).toBe('PLAYING');
    expect(statusForCommand('PAUSE_MATCH')).toBe('PAUSED');
    expect(statusForCommand('RESUME_MATCH')).toBe('PLAYING');
    expect(statusForCommand('CANCEL_MATCH')).toBe('CANCELLED');
    expect(statusForCommand('COMPLETE_FRAME')).toBe('FRAME_END');
    expect(statusForCommand('COMPLETE_MATCH')).toBe('MATCH_END');
    // engine commands do not move the lifecycle
    expect(statusForCommand('SWITCH_PLAYER')).toBeNull();
    expect(statusForCommand('ENGINE_COMMAND')).toBeNull();
  });

  it('isTerminal', () => {
    expect(isTerminal('MATCH_END')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('PLAYING')).toBe(false);
  });

  it('canApplyCommand enforces lifecycle via state machine', () => {
    const playing = { status: 'PLAYING' } as Match;
    expect(canApplyCommand(playing, 'PAUSE_MATCH')).toBe(true);
    // 管理员动作：进行中也能直接收场（不限局数的比赛靠它结束）
    expect(canApplyCommand(playing, 'COMPLETE_MATCH')).toBe(true);

    const ready = { status: 'READY' } as Match;
    expect(canApplyCommand(ready, 'COMPLETE_MATCH')).toBe(false);
  });
});
