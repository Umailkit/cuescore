# 六球规则工程化规范（Six-Ball Rules Engineering）

> 本文件是六球规则引擎的**唯一事实来源**。
> 实现位于 `src/core/engine/sixBall/`，测试位于 `tests/rules/pointsGames/sixAndFourBall.spec.ts`。

---

## 0. 口径声明（重要）

**六球没有行业统一规则。** 本引擎实现的是 **CueScore Standard 口径**
—— 产品默认口径，不是任何官方规则。模板里已向用户注明这一点。

口径要点：

- 台面 1–6 号球，**按号序击打**
- 每打进一颗得 `perBall` 分
- **先达到 `targetPoints` 分者赢下本局**
- 犯规由对手获得 `foulPenalty` 分，并按 `foulSwitchesTurn` 决定是否换手

所有差异项走 `RuleSet.config`：

| config | 默认 | 含义 |
|--------|------|------|
| `perBall` | `1` | 每颗球的分值 |
| `targetPoints` | `7` | 达到多少分赢下本局 |
| `foulPenalty` | `1` | 犯规时对手加多少分 |
| `foulSwitchesTurn` | `true` | 犯规后是否换手 |

---

## 1. 状态（SixBallState）

```ts
interface SixBallState {
  balls: Record<number, 'ON_TABLE' | 'POCKETED'>;   // 1–6
  activePlayerIndex: number;
  turnNumber: number;
  points: Record<number, number>;   // seat -> 本局累计得分
  break: { completed: boolean; shotTaken: boolean; playerIndex: number };
  foul: FoulRecord;
  potted: PocketRecord[];           // 含本杆记了多少分
  runCount: number;
  frameStatus: 'PLAYING' | 'WON' | 'LOST';
}
```

---

## 2. 规则条目

### 2.1 按号序击打
台面最小号球是唯一合法目标；母球必须先碰到它。

### 2.2 计分
合法进球 → 本方 `+perBall`，同一杆可连续打（`runCount` 累加）。
分数达到 `targetPoints` → `FRAME_WON`，`winReason` 为「先达到 N 分」。

### 2.3 犯规
`NO_CONTACT` / `SCRATCH` / `WRONG_BALL_FIRST` / `OTHER`。

- 对手 `+foulPenalty`
- 对手分数因此达标 → 对手赢下本局（`winReason` 区分「对手犯规」与「自己得分达标」）
- 本方 `runCount` 归零；`foulSwitchesTurn` 为真时换手

### 2.4 认输
`CONCEDE` → `FRAME_LOST`，由对手获得本局。

### 2.5 重新摆球
`RERACK` → 重置台面与比分，回到本局开局状态。

---

## 3. 事件

| 命令 | 事件 | 说明 |
|------|------|------|
| `BREAK_STARTED` | `BREAK_STARTED` | 开球 |
| `BALL_POTTED` / `SCORE` | `BALL_POTTED` + `SCORE_ADDED`（+ 胜负事件） | 合法进球 |
| `BALL_MISSED` | `BALL_MISSED` + `FOUL` | 空杆 |
| `FOUL` | `FOUL` + `SCORE_ADDED`（对手加分） | 犯规 |
| `END_TURN` | `TURN_ENDED` | 换手 |
| `CONCEDE` | `CONCEDE` + `FRAME_LOST` | 认输 |
| `RERACK` | `RERACK` | 重新摆球 |
| `COMPLETE_FRAME` | `FRAME_WON` | 裁判判定 |

---

## 4. 重放保真

`applySixBallEvent` 从 `createInitialState` 出发逐字段重建。
`runCount` 靠 `BALL_POTTED.payload.continues` 还原（合法进球为 `true`，犯规进球为 `false`）。

---

## 5. 已知未实现

- 一杆多颗球：一次命令只记一颗。
- 打进非目标球的处理：当前按 `WRONG_BALL_FIRST` 判犯规，不做「球留在袋里 / 摆回」的区分。
