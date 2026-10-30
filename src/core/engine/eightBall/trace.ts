import type { TableStatus } from './types';

/**
 * RuleTrace —— 一次 reduce 的可解释记录。
 *
 * 关键约束（PHASE 3A 第十六条）：RuleTrace **不得污染生产核心 State**。
 * 它只是一个附带的返回值，用于 Debug / 测试 / 规则解释 / 将来的裁判辅助
 * 与 AI 分析。不写进 Snapshot、不写进 EventLog 的必填字段、不参与判定。
 */
export interface RuleTrace {
  /** 触发本次判定的命令。 */
  command: string;
  /** 判定时的击球方 seat index。 */
  playerIndex: number;
  /** 涉及的球号（如有）。 */
  ball?: number;
  /** 判定前的球台阶段。 */
  tableStatusBefore: TableStatus;
  /** 判定后的球台阶段。 */
  tableStatusAfter: TableStatus;
  /** 合法性校验结论。 */
  validation: 'LEGAL' | 'ILLEGAL' | 'IGNORED';
  /** 引擎做出的决定（人类可读短句）。 */
  decision: string;
  /** 判定依据，逐条列出，便于"为什么这么判"。 */
  reasons: string[];
  /** 本次产出的事件类型序列。 */
  events: string[];
}

/** 便于测试/调试时打印。 */
export function formatTrace(trace: RuleTrace): string {
  const lines = [
    `Command: ${trace.command}`,
    `Player: P${trace.playerIndex + 1}`,
  ];
  if (trace.ball !== undefined) lines.push(`Ball: ${trace.ball}`);
  lines.push(`Table: ${trace.tableStatusBefore} → ${trace.tableStatusAfter}`);
  lines.push(`Validation: ${trace.validation}`);
  lines.push(`Decision: ${trace.decision}`);
  if (trace.reasons.length) lines.push(`Reasons: ${trace.reasons.join('; ')}`);
  lines.push(`Events: ${trace.events.join(', ') || '—'}`);
  return lines.join('\n');
}
