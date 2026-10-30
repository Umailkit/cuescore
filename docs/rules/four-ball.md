# 四球规则工程化规范（Four-Ball Rules Engineering）

> 本文件是四球规则引擎的**唯一事实来源**。
> 实现位于 `src/core/engine/fourBall/`，测试位于 `tests/rules/pointsGames/sixAndFourBall.spec.ts`。

---

## 0. 口径声明（重要）

**四球同样没有行业统一规则。** 本引擎实现的是 **CueScore Standard 口径**。

与六球的关键区别：

- 六球靠「打进哪颗球」**推导**分数
- 四球是**纯加分制**：分值由记分员直接给，引擎不解释球号含义

所以四球没有球台面板（UI 的 `buildBoardView` 返回 `null`），
主操作就是 `+1 / +4 / +8 / +10 / 自定义`。

| config | 默认 | 含义 |
|--------|------|------|
| `quickPoints` | `[1, 4, 8, 10]` | UI 快捷档位（加与扣成对派生） |
| `scoring.p1 / p2 / p3` | `1 / 4 / 8` | 旧档位字段，引擎在 `SCORE` 未带 `points` 时取 `p1` |
| `scoring.custom` | `10` | 自定义档位的建议值（仅展示用，命令永远带显式 `points`） |
| `foul` | `'opponent_plus_1'` | 犯规处理：`opponent_plus_1` / `opponent_plus_n` / `none` |
| `foulPenalty` | `1` | `opponent_plus_n` 时对手加多少分 |
| `targetPoints` | `15` | 达到多少分赢下本局 |
| `foulSwitchesTurn` | `true` | 犯规后是否换手 |

---

## 1. 状态（FourBallState）

```ts
interface FourBallState {
  activePlayerIndex: number;
  turnNumber: number;
  points: Record<number, number>;   // seat -> 累计得分
  scoreLog: ScoreRecord[];          // 加分流水（含 source: pot/foul/manual）
  foul: FoulRecord;
  runCount: number;
  frameStatus: 'PLAYING' | 'WON' | 'LOST';
}
```

---

## 2. 规则条目

### 2.1 加分
`SCORE` 命令带 `payload.points`：

- 给了 `points` → 用它
- 没给 → 取 `config.scoring.p1`
- 必须为正数，否则判 `ILLEGAL` 且不产生事件

分数达到 `targetPoints` → `FRAME_WON`。

### 2.1b 扣分（`ADJUST_SCORE`）
`payload.points` **正数加分、负数扣分** —— 记错了直接扣回来。

- 必须是非零整数
- 扣分后不得为负（`ILLEGAL`，不静默截断）
- 人工加分同样能达到 `targetPoints` 赢局
- `payload.playerIndex`（可选）指定记给谁：不传记给 `activePlayerIndex`，
  传了记给指定座位且不改变击球方；越界 `ILLEGAL`
- 快捷档位由 `config.quickPoints` 决定，UI 通过 `@app/services/boardView` 的
  `quickActions()` 派生 `+N / -N`；自定义分值走同一个命令

**本局分数快照** `getFrameScores(state)`：全 0 返回 `null`，否则返回 `points`。
`MatchService` 记帧时写入 `FrameResult.scores` 与事件 payload，供跨场总分排名累计。

### 2.2 犯规
`NO_CONTACT` / `SCRATCH` / `WRONG_BALL_FIRST` / `OTHER`。

按 `config.foul` 处理：`opponent_plus_1` 给对手 +1、`opponent_plus_n` 给对手 `+foulPenalty`、
`none` 不加分。`foulSwitchesTurn` 为真时换手。

### 2.3 换手 / 认输 / 重摆
`END_TURN` 换手、`CONCEDE` 认输、`RERACK` 清空比分与流水重开。

---

## 3. 事件

| 命令 | 事件 | 说明 |
|------|------|------|
| `SCORE` | `SCORE_ADDED`（+ 胜负事件） | 加分 |
| `ADJUST_SCORE` | `SCORE_ADDED`（+ 胜负事件） | 人工加/扣分（`points` 可为负） |
| `FOUL` | `FOUL` + `SCORE_ADDED`（对手加分） | 犯规 |
| `END_TURN` | `TURN_ENDED` | 换手 |
| `CONCEDE` | `CONCEDE` + `FRAME_LOST` | 认输 |
| `RERACK` | `RERACK` | 重开本局 |
| `COMPLETE_FRAME` | `FRAME_WON` | 裁判判定 |

---

## 4. 重放保真

`applyFourBallEvent` 从 `createInitialState` 出发逐字段重建。
`runCount` 靠 `SCORE_ADDED.payload.continues` 还原
（主动加分为 `true`，犯规加分为 `false` —— 犯规时 `runCount` 归零）。

---

## 5. 已知未实现

- 多球同杆：一次 `SCORE` 只记一次加分。
