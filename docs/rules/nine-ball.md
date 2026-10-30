# 九球规则工程化规范（Nine-Ball Rules Engineering）

> 本文件是九球规则引擎的**唯一事实来源**。
> 实现位于 `src/core/engine/nineBall/`，测试位于 `tests/rules/nineBall/nineBall.spec.ts`。
>
> 与八球一样：凡本文件与代码不一致，以**代码 + 测试**为准，并回来改本文件。

---

## 0. 口径声明

九球同样存在地区差异（Push Out、三次犯规、开球金等）。
本产品实现的是 **CueScore Standard 口径**，差异项全部走 `RuleSet.config`，不在代码里写死：

| config | 默认 | 含义 |
|--------|------|------|
| `scoringMode` | `'sequence'` | `'points'` = 记分制，`'sequence'` = 标准清台制 |
| `targetPoints` | `0` | 记分制的目标分（0 = 不按分数判胜） |
| `quickPoints` | `[1, 4, 8, 10]` | 记分制的快捷档位（UI 从中派生 +N / -N 按钮） |
| `nineOnBreak` | `true` | 开球直接打进 9 号球算赢 |
| `pushOut` | `true` | 启用推杆 |
| `threeFoulsLosesFrame` | `true` | 同一人连续三次犯规判负本局 |
| `ballInHandOnFoul` | `true` | 犯规后对手获得自由球 |
| `breakRequiresPocketOrRailCount` | `0` | 开球必须有球进袋或 N 颗球碰库；0 = 不校验 |

---

## 1. 状态（NineBallState）

```ts
interface NineBallState {
  balls: Record<number, 'ON_TABLE' | 'POCKETED'>;   // 1–9
  activePlayerIndex: number;
  turnNumber: number;
  break: { completed: boolean; shotTaken: boolean; playerIndex: number };
  pushOut: { available: boolean; used: boolean };
  foul: FoulRecord;
  consecutiveFouls: Record<number, number>;
  ballInHand: boolean;
  potted: PocketRecord[];
  runCount: number;
  /** 记分制的本局比分（座位 → 分数）；`'sequence'` 下恒为空对象内容无关。 */
  points: Record<number, number>;
  frameStatus: 'PLAYING' | 'WON' | 'LOST';
}
```

---

## 2. 两种口径

九球在本产品里有两条互斥的口径，由 `config.scoringMode` 决定：

| | `'points'`（记分制） | `'sequence'`（标准清台制） |
|---|---|---|
| 记分方式 | 记分员点 +N / -N | 按号序击打，进袋即记录 |
| 球台面板 | **不显示**（没有"该打哪颗球"） | 显示，只有最小号球可点 |
| 本局胜负 | 先到 `targetPoints` 分 | 合法打进 9 号球 |
| 适用 | 台球厅日常记分（**推荐模板默认**） | 标准九球比赛 |

> 引擎的 `DEFAULT_NINE_BALL_RULES` 仍是 `'sequence'` —— 老比赛和老事件的
> 重放必须保持原语义；推荐模板会显式覆盖成 `'points'`。

### 2.0 记分制（`scoringMode: 'points'`）

`ADJUST_SCORE` 命令，`payload.points` **正数加分、负数扣分**：

- 分值必须是非零整数，`0` / 小数 / 非数字一律 `ILLEGAL`
- 扣分后比分不得为负（`ILLEGAL`，不静默截断到 0）
- 达到 `targetPoints` → `FRAME_WON`，`winReason` 写入事件 payload
- 该模式下 `ADJUST_SCORE` 之外仍可用 `END_TURN` / `CONCEDE` / `COMPLETE_FRAME`

**给谁记分**（`payload.playerIndex`，可选）：不传记给 `activePlayerIndex`（当前击球方）；
传了则记给指定座位，且**不改变击球方**。越界（非整数 / `< 0` / `>= 座位数`）一律 `ILLEGAL`。

**快捷档位**由 `config.quickPoints` 决定（默认 `[1, 4, 8, 10]`），UI 通过
`@app/services/boardView` 的 `quickActions()` 派生 `+1/+4/+8/+10` 与 `-1/-4/-8/-10`；
自定义分值走同一个 `ADJUST_SCORE`，不新增命令。

**本局分数快照** `getFrameScores(state)`：全 0 返回 `null`（不产生空快照），
否则返回 `points`。`MatchService` 在记帧时把它写进 `FrameResult.scores` 与事件 payload，
供历史、本场排名、跨场总分排名累计 —— 不另建统计表。

事件：`SCORE_ADDED { playerIndex, points, reason: 'manual' }`（+ 可能的 `FRAME_WON`）。
重放按 `SCORE_ADDED` 累加 `points`；`RERACK` 把本局比分归零。

### 2.1 按号序击打（仅 `'sequence'`）
台面最小号球是唯一合法目标。母球必须先碰到它（`payload.firstContact` 给了就校验）。

- 合法 → 记 `BALL_POTTED`，继续击球（`runCount + 1`）
- 先碰到别的球 → `WRONG_BALL_FIRST` 犯规

### 2.2 打进 9 号球即胜本局
合法打进 9 号球 → `FRAME_WON`，`winReason` 写入事件 payload 供重放还原。
非法打进（犯规的同时进 9）→ 9 号球摆回台面（`balls[9] = 'ON_TABLE'`），不判胜。

### 2.3 开球金（nineOnBreak）
`config.nineOnBreak` 为真时，开球一杆直接合法打进 9 号球算赢。

### 2.4 Push Out（推杆）
开球后的第一杆可以使用一次。使用后 `pushOut.used = true`，由对手决定接打或交回。
可用性条件：`break.completed && !break.shotTaken && pushOut.available && !pushOut.used`。

### 2.5 连续三次犯规判负
同一位选手连续三次犯规 → 判负本局（`FRAME_LOST`）。合法击球时该计数归零。

### 2.6 犯规
- `NO_CONTACT` 空杆
- `SCRATCH` 母球落袋
- `NO_RAIL` 无球进袋且无球碰库
- `WRONG_BALL_FIRST` 先碰到的不是最小号球
- `OTHER`

犯规后：`ballInHandOnFoul` 为真时对手获得自由球，并换手。

---

## 3. 事件

| 命令 | 事件 | 说明 |
|------|------|------|
| `BREAK_STARTED` | `BREAK_STARTED` | 开球 |
| `ADJUST_SCORE` | `SCORE_ADDED`（+ 可能的 `FRAME_WON`） | 记分制人工加/扣分，可指定 `playerIndex` |
| `BALL_POTTED` | `BALL_POTTED`（+ 胜负事件） | 合法进球；`payload.continues` 供重放还原 `runCount` |
| `BALL_MISSED` | `BALL_MISSED` + `FOUL` | 空杆 |
| `FOUL` | `FOUL` | 犯规，对手自由球并换手 |
| `PUSH_OUT` | `ENGINE_EVENT` | 推杆 |
| `END_TURN` | `TURN_ENDED` | 换手 |
| `CONCEDE` | `CONCEDE` + `FRAME_LOST` | 认输 |
| `COMPLETE_FRAME` | `FRAME_WON` | 裁判判定 |

---

## 4. 重放保真

`applyNineBallEvent` 必须能从 `createInitialState` 出发、逐字段重建 live 状态。
关键字段：`runCount`、`consecutiveFouls`、`pushOut` —— 三者都靠事件 payload 携带
（`continues` / `ENGINE_EVENT` / push-out 事件）来还原，不能靠重放时重新推导。

---

## 5. 已知未实现

- 一杆多颗球：一次 `BALL_POTTED` 只记一颗，多球需多次记录。
- `breakRequiresPocketOrRailCount`：已定义并归一化，**尚未在判定中生效**（默认 0，等同于不校验）。
