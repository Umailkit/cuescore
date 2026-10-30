# 四球追分规则工程化规范（Four-Ball Chase Rules Engineering）

> 本文件是四球规则引擎的**唯一事实来源**。
> 实现位于 `src/core/engine/fourBall/`（规则表在 `chase.ts`），
> 测试位于 `tests/rules/pointsGames/sixAndFourBall.spec.ts` 与 `tests/unit/quickPoints.test.ts`。

---

## 0. 口径声明（重要）

**四球没有行业统一规则。** 本引擎实现的是台球房里俗称的 **追分（Chase）口径**：

- 一场比赛里 **每人先有一个净分**，整场累计，不按局重开
- 每次有人完成一次「有效清台」，由**上家 / 下家按规则表赔付**给本家
- 结算**零和**：所有人净分相加恒为 `0`

与六球的关键区别：

- 六球靠「打进哪颗球」**推导**分数，赢得本局的人加分
- 四球是**多人零和赔付**：本家得分 = 上家/下家失分，引擎只维护每个座位的净分

所以四球没有球台面板（UI 的 `buildBoardView` 返回 `null`），
主操作就是规则表里的五个档位：`普胜 / 小金 / 大金 / 黄金九 / 黑金`。

### 0.1 规则表

| 档位 | `kind` | 条件 | 上家 | 下家 | 本家净得 |
|------|--------|------|------|------|----------|
| 普胜 | `normal` | 按顺序完成击打 | +4 | — | **+4** |
| 小金 | `smallGold` | 接清台面剩余球 | +7 | — | **+7** |
| 大金 | `bigGold` | 开球后一杆清台 | +10 | +10 | **+20** |
| 黄金九 | `goldNine` | 开球直接进 9 号 | +4 | +4 | **+8** |
| 黑金 | `blackGold` | 清台时白球落袋 | +10 | +10 | **−20** |

「上家 / 下家」按**座位环形顺序**取：座位 `i` 的上家是 `i-1`、下家是 `i+1`（首尾相接）。
两人局时上家与下家是同一人，赔付**叠加**——例如两人局的黑金，对手独自承担 `20` 分。

`黑金` 是唯一**本家倒赔**的档位：本家 −20，上家与下家各 +10。

以上数值定义在 `src/core/engine/fourBall/chase.ts` 的 `CHASE_RULES` 里，
引擎、UI、测试共用同一份来源，不允许在别处硬编码分值。

### 0.2 规则集 config

| config | 默认 | 含义 |
|--------|------|------|
| `targetPoints` | `0` | **`0` = 不按目标分结束**（追分靠手动结束比赛） |
| `scoring.p1 / p2 / p3` | `4 / 7 / 10` | 旧档位字段，引擎在 `SCORE` 未带 `points` 时取 `p1` |
| `scoring.custom` | `10` | 自定义档位的建议值（仅展示用，命令永远带显式 `points`） |
| `foul` | `'opponent_plus_1'` | 犯规处理：`opponent_plus_1` / `opponent_plus_n` / `none` |
| `foulPenalty` | `1` | `opponent_plus_n` 时对手加多少分 |
| `foulSwitchesTurn` | `true` | 犯规后是否换手 |

> `targetPoints` 曾被钳到 `≥ 1`，导致追分模式「一得分就判胜」。
> 现在 `rules.ts` 用 `Math.max(0, …)`，引擎三处胜负判断都加了 `targetPoints > 0` 前置守卫。

---

## 1. 状态（FourBallState）

```ts
interface FourBallState {
  activePlayerIndex: number;
  turnNumber: number;
  points: Record<number, number>;   // seat -> 整场累计净分（可为负）
  scoreLog: ScoreRecord[];          // 加分流水（source: pot/foul/manual/chase）
  foul: FoulRecord;
  runCount: number;
  frameStatus: 'PLAYING' | 'WON' | 'LOST';
}
```

**整场累计**：`startFrame` 保留上一局的 `points`（`points[i] = state.points[i] ?? 0`），
唯一清零入口是 `RERACK`。

---

## 2. 规则条目

### 2.1 追分结算（`CHASE_SCORED`，主路径）

`payload.kind` 取 `normal | smallGold | bigGold | goldNine | blackGold`；
`payload.playerIndex`（可选）指定谁是本家，不传则取 `activePlayerIndex`，越界判 `ILLEGAL`。

引擎行为：

1. 用 `chaseDeltas(kind, seat, seats)` 算出**全桌每个座位的增量**（恒为零和）
2. 每个非零增量座位发一条 `SCORE_ADDED`
3. **只有本家那条带 `continues: true`**——本家完成清台，继续保持击球
4. `runCount += 1`
5. 不判胜负（`targetPoints = 0`），比赛由用户点「结束比赛」收尾

所以一次 `CHASE_SCORED` 在事件日志里是 **2~3 条 `SCORE_ADDED`**，
观感上只算一个动作；撤销时整组一起回退。

### 2.2 手动加分（`SCORE` / `ADJUST_SCORE`）

`CHASE_SCORED` 之外的兜底通道，用于记错纠偏或临时约定：

- `SCORE` 带 `payload.points`（正数）；不给则取 `config.scoring.p1`
- `ADJUST_SCORE` 的 `points` **正数加分、负数扣分**
- 必须是非零整数；加分后达到 `targetPoints > 0` 才会 `FRAME_WON`
- 扣分**允许把分数拉成负**（追分场面本来就有负分），只拦「从非负直接拉负」的误操作：
  `if (nextScore < 0 && current >= 0) → ILLEGAL`
- `payload.playerIndex`（可选）指定记给谁，不传记给 `activePlayerIndex`

**分数快照** `getFrameScores(state)`：全 0 返回 `null`，否则返回 `points`（可为负）。

### 2.3 犯规

`NO_CONTACT` / `SCRATCH` / `WRONG_BALL_FIRST` / `OTHER`。

按 `config.foul` 处理：`opponent_plus_1` 给对手 +1、`opponent_plus_n` 给对手 `+foulPenalty`、
`none` 不加分。`foulSwitchesTurn` 为真时换手。

### 2.4 换手 / 认输 / 重摆

`END_TURN` 换手、`CONCEDE` 认输、`RERACK` 清空比分与流水重开（唯一清零入口）。

---

## 3. 事件

| 命令 | 事件 | 说明 |
|------|------|------|
| `CHASE_SCORED` | `SCORE_ADDED` × 2~3（`reason: 'chase'` + `chaseKind`） | 追分结算，零和 |
| `SCORE` | `SCORE_ADDED`（+ 胜负事件） | 手动加分 |
| `ADJUST_SCORE` | `SCORE_ADDED`（+ 胜负事件） | 人工加/扣分（`points` 可为负） |
| `FOUL` | `FOUL` + `SCORE_ADDED`（对手加分） | 犯规 |
| `END_TURN` | `TURN_ENDED` | 换手 |
| `CONCEDE` | `CONCEDE` + `FRAME_LOST` | 认输 |
| `RERACK` | `RERACK` | 重开（清零） |
| `COMPLETE_FRAME` | `FRAME_WON` | 裁判判定 |

---

## 4. 一局都没有的「比赛」怎么落库

追分通常**没有局的概念**，但排名依赖 `FrameResult.scores`。
处理方式：

- `COMPLETE_MATCH` 时若 `frames.length === 0` 且存在总分，就把**总分当成一局快照**落盘
  （`scores: totals`、`detail: 总分 N`），并把同样的 `scores` 写回 `MATCH_WON` 事件 payload
- `data/recovery.ts` 的 `replayFrames` 见到 `MATCH_WON` 且 `frames` 为空时，
  用 `payload.scores` 补一条 `index: 1` 的帧

这样刷新 / 重放后总分排名不会丢分。

---

## 5. 重放保真

`applyFourBallEvent` 从 `createInitialState` 出发逐字段重建。
`runCount` 还原规则：

```
p.continues === true   → runCount += 1
isChase && 无 continues → runCount 保持不变（赔付方那几条）
其他                    → runCount = 0（犯规加分）
```

---

## 6. 已知未实现 / 取舍

- 多球同杆：一次 `CHASE_SCORED` 只结算一次，不叠加档位
- 追分不自动判定比赛结束：没有目标分，必须手动「结束比赛 · 按累计总分结算」
- 排名里「局数」对追分恒为 1（整场当一局快照）
