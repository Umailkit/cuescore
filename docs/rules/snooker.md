# 斯诺克规则工程化规范（Snooker Rules Engineering）

> 本文件是斯诺克规则引擎的**唯一事实来源**与**测试契约**。
> 实现阶段（PHASE 5）必须按「规则说明 → 状态转换 → Event → Unit Test」逐条落地，
> 且 `tests/rules/snooker/snooker.spec.ts` 中的每个 `it.skip` 必须变成可运行的真实测试。
>
> 第一版只实现**标准 15 红**。`6-red` 仅预留 RuleSet（`config.variant: '6-red'`），不进入实现。

---

## 0. 球值（Ball Values）

| 球 | 值 | 颜色 |
|----|----|------|
| Red | 1 | 红 |
| Yellow | 2 | 黄 |
| Green | 3 | 绿 |
| Brown | 4 | 棕 |
| Blue | 5 | 蓝 |
| Pink | 6 | 粉 |
| Black | 7 | 黑 |

- 红球阶段：每打入一红球得 1 分，之后必须指定一门彩球（黄→黑），彩球打完放回原位（re-spot）。
- 红球清光后，按黄→黑顺序依次打入彩球，不再放回。
- 单杆满分（147）：15 红各配黑（15×8=120）+ 黄到黑（2+3+4+5+6+7=27）= 147。

---

## 1. 引擎状态（SnookerEngineState）

```ts
interface SnookerEngineState {
  stage: 'reds' | 'colours';        // 红球阶段 / 彩球阶段
  redsRemaining: number;            // 0..15
  scores: Record<string, number>;   // playerId -> 当前局分
  breaks: Record<string, number>;   // playerId -> 当前单杆
  highestBreak: Record<string, number>;
  currentBreak: number;             // 当前连续得分累计
  activePlayerId: string;
  freeBall: boolean;                // 自由球标记
  lastColourOnBreak: number | null; // 本杆已打彩球值（用于 End Break 校验）
  frameComplete: boolean;
  matchComplete: boolean;
}
```

引擎为纯函数：`reduce(state, command) → { state, events }`。

---

## 2. 规则场景 → 状态转换 → Event → Unit Test

### 2.1 147 满分杆

- **规则说明**：单杆内 15 颗红球各配黑球（15×8=120），随后黄→黑彩球顺序（27），合计 147。
- **状态转换**：每 `SCORE_RED`（+1）→ `SCORE_COLOUR`(black, +7) 循环 15 次；红球清零后 `stage: 'reds'→'colours'`，依次打入 2..7。最终某玩家 `scores[p] === 147`，`currentBreak === 147`。
- **Event**：`SCORE_ADDED`（`payload: { value: 1 | 7, ball: 'red'|'black' ... }`）+ 最终 `FRAME_WON`。
- **Unit Test**：`it('147 maximum break', ...)` — 构造连续 15×(红+黑)+彩球序列，断言胜者 `scores === 147` 且 `highestBreak === 147`。

### 2.2 Foul 4 / 5 / 6 / 7 罚分

- **规则说明**：犯规时对手获得**至少 4 分**的罚分；具体为所击球的分值与 4 取大者（命中蓝球犯规=5，粉球=6，黑球=7）。
- **状态转换**：`FOUL`（`payload: { ball: 4|5|6|7 }`）→ 对手 `scores[opp] += max(4, ball)`；当前 `currentBreak` 归零；`activePlayerId` 切换。
- **Event**：`FOUL`（`payload: { penalty: 4|5|6|7 }`）。
- **Unit Test**：
  - `it('foul on blue awards 5')` — 断言对手 +5。
  - `it('foul on pink awards 6')`、`it('foul on black awards 7')`、`it('minimum foul penalty is 4')`（如未命中球且判 4）。

### 2.3 Free Ball 自由球

- **规则说明**：当对手犯规后形成斯诺克，且台面无合法明显球时，犯规后的击球方获得自由球——可指定任意一颗彩球当作目标球替代。
- **状态转换**：犯规后 `freeBall = true`；下一杆 `SCORE_COLOUR` 时允许以任一彩球分值计分（按被替代球计），之后按正常流程 re-spot 或继续。
- **Event**：`FOUL` 之后追加 `FREE_BALL`（`payload: { awardedTo }`）。
- **Unit Test**：`it('free ball allows substituting any colour')` — 在 `freeBall` 态下打入绿球按正常分值计且清除 `freeBall`。

### 2.4 Foul + Free Ball 组合

- **规则说明**：对手犯规（≥4 罚分）且构成斯诺克，判自由球；本杆处理方式同 2.3。
- **状态转换**：`FOUL`（罚分+切换）→ `FREE_BALL`（置位）→ 玩家击打替代球。
- **Event**：`FOUL` + `FREE_BALL` 连续两条。
- **Unit Test**：`it('foul then free ball awards penalty and grants substitute')` — 断言对手已 +4 且 `freeBall===true`。

### 2.5 Miss 未击中

- **规则说明**：未击中任何合法球（miss），判犯规（最少 4 分），裁判可要求重摆（re-spot）；若形成斯诺克可判自由球。
- **状态转换**：`MISS` → 等同 `FOUL` 罚分 + 可选 `freeBall`。
- **Event**：`FOUL`（`payload: { kind: 'miss' }`）。
- **Unit Test**：`it('miss is a foul with minimum 4 penalty')`。

### 2.6 Re-Spot 重置彩球

- **规则说明**：彩球阶段当目标点位被占或规则要求时，将彩球放回其标准点位（点序：绿→棕→蓝 / 粉 / 黑）。
- **状态转换**：`RE_SPOT`（`payload: { ball }`）→ 状态中该彩球回到台面（仅影响渲染与合法性，不直接改分）。
- **Event**：`ENGINE_EVENT`（`type: 'RE_SPOT'`）。
- **Unit Test**：`it('re-spot returns a colour to its spot')` — 断言状态标记对应彩球在台。

### 2.7 Re-Rack 重新摆球

- **规则说明**：出现争议或规则允许的极端情形，裁判重新摆球（常见于 6-red 或争议），本局重新开始。
- **状态转换**：`RE_RACK` → 重置 `SnookerEngineState` 为初始，保留 `scores`（或按规则清零本局）。
- **Event**：`ENGINE_EVENT`（`type: 'RE_RACK'`）。
- **Unit Test**：`it('re-rack resets frame state')` — 断言 `redsRemaining===15` 且 `stage==='reds'`。

### 2.8 Concede 认输

- **规则说明**：玩家可认输当前局/比赛，对手获胜。
- **状态转换**：`CONCEDE` → `frameComplete = true`、`matchComplete = true`、胜者为对手。
- **Event**：`FRAME_WON` + `MATCH_WON`。
- **Unit Test**：`it('concede awards frame and match to opponent')`。

### 2.9 最后一颗黑球

- **规则说明**：台面仅剩黑球时，若两人局分打平，需重摆黑球争胜（re-spotted black）；否则打入黑球即结束本局。
- **状态转换**：`redsRemaining===0` 且 `colours` 仅剩黑（值 7）时，若分差==0 → `RE_SPOT(black)` + 继续；否则 `SCORE_COLOUR(7)` → `frameComplete=true`。
- **Event**：分平时 `RE_SPOT`，否则 `FRAME_WON`。
- **Unit Test**：`it('tie on final black triggers re-spot')` 与 `it('final black ends frame when not tied')`。

### 2.10 Snookers Required 所需斯诺克

- **规则说明**：落后方分数低于台面剩余最高可得分时，需要做成斯诺克才可能翻盘。需计算「还需几颗斯诺克」。
- **状态转换**：派生量，不改状态；由 `getStatistics` 计算 `snookersRequired = ceil((diff - pointsRemaining) / 2)`（每次斯诺克最少追回 2 分净差）。
- **Event**：无（派生统计）。
- **Unit Test**：`it('computes snookers required when behind')` — 给定 `diff` 与 `pointsRemaining`，断言公式正确。

### 2.11 Points Remaining 剩余分数

- **规则说明**：台面剩余可得总分 = 红球数×8（每红配黑）+ 剩余彩球分值（彩球阶段为剩余彩球之和）。
- **状态转换**：派生量。
- **Event**：无。
- **Unit Test**：`it('computes points remaining on table')` — 初始 `15×8 + (2+3+4+5+6+7) = 147`；清 5 红后 `10×8+27=107`。

### 2.12 Break 单杆连续得分

- **规则说明**：从解球/开杆起，连续合法得分累计为单杆（break）；犯规清零。
- **状态转换**：每次 `SCORE_*` → `currentBreak += value`、`breaks[p] += value`、`highestBreak[p] = max(...)`；`FOUL`/`MISS` → `currentBreak = 0`。
- **Event**：`SCORE_ADDED`。
- **Unit Test**：`it('accumulates current break across pots')` 与 `it('foul resets current break')`。

### 2.13 End Break 结束单杆

- **规则说明**：玩家选择结束单杆（换对手），或犯规/未击中后自然结束单杆。
- **状态转换**：`END_BREAK` → `currentBreak = 0`、`activePlayerId` 切换、`lastColourOnBreak = null`。
- **Event**：`PLAYER_SWITCHED`。
- **Unit Test**：`it('end break switches player and resets break')`。

---

## 3. 键盘 / 快捷（后续阶段，不影响引擎）

参考 SnookerScore 的快捷键思路重新设计（不直接复制）：
`1=红, 2=黄, 3=绿, 4=棕, 5=蓝, 6=粉, 7=黑, U=撤销, Y=重做, Space=结束单杆`。
快捷键只应触发对应 `command`，规则判定全部在引擎内。

---

## 4. 自动计算项（getStatistics 输出）

- 当前 Break
- 最高 Break（每人）
- 局分（Frame Score）
- 分差（Margin）
- 台面剩余分数（Points Remaining）
- 所需分数（Points Needed）
- Snookers Required

以上全部由 `SnookerEngineState` 派生，引擎不存储冗余统计，避免与历史对不上。
