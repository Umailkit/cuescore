import { describe, it, expect } from 'vitest';
import { MATCH_TEMPLATES } from '@core/types';
import type { MatchPlayerInput, MatchEvent } from '@core/types';
import { MatchService } from '@app/services/matchService';
import { registerPlaceholderEngines } from '@core/engine/noopEngine';

/**
 * EventLog 序号与「非法命令不污染日志」。
 *
 * `seq` 是重放顺序的唯一保证（同毫秒事件靠它定序），因此必须 **唯一且单调**。
 * 撤销会把 current 换回一个更早的 Match（eventSeq 更小），如果 UNDO 事件
 * 不占号，下一条真实事件就会和它撞号 —— 这条测试专门盯这个。
 */

const EIGHT = MATCH_TEMPLATES[0]!;
const TWO: MatchPlayerInput[] = [
  { displayName: 'Alice', isAnonymous: true },
  { displayName: 'Bob', isAnonymous: true },
];

function seqsOf(log: MatchEvent[]): number[] {
  return log.map((e) => e.seq ?? -1);
}

function duplicated(xs: number[]): number[] {
  return [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];
}

describe('EventLog seq', () => {
  it('正常命令流：seq 从 0 连续且无重复', async () => {
    registerPlaceholderEngines();
    const svc = new MatchService();
    const { match } = await svc.createMatch(EIGHT, TWO);
    let m = match;
    for (const cmd of [
      { type: 'START_MATCH' as const },
      { type: 'BREAK_STARTED' as const },
      { type: 'BALL_POTTED' as const, payload: { ball: 1 } },
      { type: 'END_TURN' as const },
    ]) {
      m = (await svc.applyCommand(m, cmd)).match;
    }
    const seqs = seqsOf(await svc.listEvents(m.id));
    expect(duplicated(seqs)).toEqual([]);
    expect(seqs).toEqual(seqs.map((_, i) => i));
    // eventSeq 指向下一个可用序号
    expect(m.eventSeq).toBe(seqs.length);
  });

  it('撤销之后：UNDO 自己占号，下一条命令不会撞号', async () => {
    registerPlaceholderEngines();
    const svc = new MatchService();
    const { match } = await svc.createMatch(EIGHT, TWO);
    let m = (await svc.applyCommand(match, { type: 'START_MATCH' })).match;
    m = (await svc.applyCommand(m, { type: 'BREAK_STARTED' })).match;

    const afterUndo = await svc.recordUndo(m, []);
    // UNDO 占掉了 seq，eventSeq 必须跟着递增（它是「已 append 的事件总数」）
    expect(afterUndo.event.seq).toBe(m.eventSeq);
    expect(afterUndo.match.eventSeq).toBe(m.eventSeq + 1);

    // 撤销后再发命令 —— 以前这里会和 UNDO 撞成同一个 seq
    const r = await svc.applyCommand(afterUndo.match, { type: 'END_TURN' });
    const log = await svc.listEvents(m.id);
    expect(duplicated(seqsOf(log))).toEqual([]);
    expect(r.events[0]?.seq ?? -1).toBeGreaterThan(afterUndo.event.seq ?? -1);
  });

  it('重做之后：REDO 同样占号，不产生重复', async () => {
    registerPlaceholderEngines();
    const svc = new MatchService();
    const { match } = await svc.createMatch(EIGHT, TWO);
    const m = (await svc.applyCommand(match, { type: 'START_MATCH' })).match;

    const undone = await svc.recordUndo(m, []);
    const redone = await svc.recordRedo(undone.match, []);
    expect(redone.match.eventSeq).toBe(undone.match.eventSeq + 1);

    const r = await svc.applyCommand(redone.match, { type: 'END_TURN' });
    const log = await svc.listEvents(m.id);
    expect(duplicated(seqsOf(log))).toEqual([]);
    expect(r.events[0]?.seq ?? -1).toBeGreaterThan(redone.event.seq ?? -1);
  });
});

describe('非法命令不污染 EventLog', () => {
  it('引擎拒绝的命令（非法球号）不写入任何事件', async () => {
    registerPlaceholderEngines();
    const svc = new MatchService();
    const { match } = await svc.createMatch(EIGHT, TWO);
    const started = (await svc.applyCommand(match, { type: 'START_MATCH' })).match;

    const before = await svc.listEvents(started.id);
    const r = await svc.applyCommand(started, { type: 'BALL_POTTED', payload: { ball: 99 } });

    expect(r.events).toHaveLength(0);
    const after = await svc.listEvents(started.id);
    expect(after).toHaveLength(before.length);
  });

  it('状态机拒绝的命令直接抛错，不写入任何事件', async () => {
    registerPlaceholderEngines();
    const svc = new MatchService();
    const { match } = await svc.createMatch(EIGHT, TWO);

    const before = await svc.listEvents(match.id);
    await expect(svc.applyCommand(match, { type: 'COMPLETE_MATCH' })).rejects.toThrow(
      /not allowed in status READY/,
    );
    const after = await svc.listEvents(match.id);
    expect(after).toHaveLength(before.length);
  });

  it('本局已结束后继续击球：引擎忽略，不产生事件', async () => {
    registerPlaceholderEngines();
    const svc = new MatchService();
    const { match } = await svc.createMatch(EIGHT, TWO);
    let m = (await svc.applyCommand(match, { type: 'START_MATCH' })).match;
    m = (await svc.applyCommand(m, { type: 'BREAK_STARTED' })).match;
    m = (await svc.applyCommand(m, { type: 'COMPLETE_FRAME', payload: { winnerPlayerIndex: 1 } })).match;

    const before = await svc.listEvents(m.id);
    const r = await svc.applyCommand(m, { type: 'BALL_POTTED', payload: { ball: 3 } });
    expect(r.events).toHaveLength(0);
    expect(await svc.listEvents(m.id)).toHaveLength(before.length);
  });
});
