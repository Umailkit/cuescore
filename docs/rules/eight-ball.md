# 中式八球规则引擎说明

> 本文描述 **`EightBallEngine` 实际实现的规则**，不是"台球规则科普"。
> 引擎是唯一的规则事实来源；UI 只发命令、只展示引擎派生的结果。
> 代码位置：`src/core/engine/eightBall/`。

---

## 1. 职责边界

| 层 | 拥有什么 | 不拥有什么 |
| --- | --- | --- |
| `EightBallEngine` | 球台事实、合法性判定、胜负判定 | 比分、局号、存储 |
| `MatchService` | 局数累加、比赛状态机、Race To 收场 | 八球具体规则 |
| UI | 发命令、渲染 `BoardView` | 任何规则判断 |

**局内没有"分数"这个概念。** 打进一颗球不是 `score++`。
分数（局数）只在 `Match` 层由 `FRAME_WON` 事件驱动累加。

链路始终是单向的：

```
MatchCommand → EightBallEngine.reduce → validate → reduce
             → EngineState → MatchEvent[] → EventLog → Snapshot → UI
```

---

## 2. 引擎维护的事实（`EightBallState`）

引擎只保存**可 JSON 序列化**的事实，因为它要写进 Snapshot，也要能被 EventLog 重放重建。

- `balls`：16 颗球（含母球 0）的状态，只有 `ON_TABLE` / `POCKETED`
- `groups`：席位 → 球组（`SOLIDS` 1–7 / `STRIPES` 9–15），未认组为 `null`
- `tableStatus`：`OPEN` / `GROUPS_ASSIGNED` / `EIGHT_BALL`
- `activePlayerIndex`、`turnNumber`（每换手 +1）
- `break`：开球是否完成、开球这一杆是否已打出、开球是否合法、开球方
- `foul`：最近一次判定（会被下一次击球覆盖，历史在 EventLog）
- `potted`：本局进球流水
- `frameStatus`：`PLAYING` / `WON` / `LOST` / `RERACK`

`state` 里**没有任何比分字段**。

---

## 3. 开球

开球由 `BREAK_STARTED` 标记完成。两条硬规则：

1. **开球之前没有任何合法目标球。**
   `getLegalTargetBalls()` 在 `break.completed === false` 时直接返回空数组——
   本局还没有第一杆，UI 上 15 颗球都不可点。
2. **开球这一杆不认组。**
   用 `break.completed === true && break.shotTaken === false` 区分
   "开球这一杆"与"开球之后的正常击球"。多数地区的做法是开球进球不定组，
   因此这一杆即使进球也不触发 `GROUPS_ASSIGNED`。

### 开球打进 8 号球

按 `RuleSet.config.eightOnBreak` 处理，三种取值：

| 取值 | 行为 |
| --- | --- |
| `rerack`（默认） | 重新摆球，本局 `frameStatus = RERACK` |
| `win` | 开球方直接赢下本局 |
| `lose` | 开球方直接输掉本局 |

注意：只有**真正的开球这一杆**才算 eight-on-break。
`break.completed === false`（还没人开球）不算。

---

## 4. 认组

认组只能发生在 `tableStatus === 'OPEN'`，且**不是开球这一杆**。

判定逻辑在 `resolveGroupAssignment()`：

- 进的球只属于同一组 → 认这一组，对手自动拿另一组
- 同一杆里同时进了两组 → **不认组**，球台继续保持 `OPEN`
- 开球这一杆 → 永不认组

一旦认组不再改变。`syncTableStatus()` 是幂等的，它按**当前球况**决定阶段，
而不是信任上一次的 `tableStatus` 字段：

- 双方都没有组 → `OPEN`
- 有人已清空自己的组 → `EIGHT_BALL`
- 否则 → `GROUPS_ASSIGNED`

---

## 5. 合法目标球

`getLegalTargetBalls(state, playerIndex)` 的规则：

| 球台状态 | 合法目标 |
| --- | --- |
| 未开球 | 无（空数组） |
| `OPEN` | 除 8 号外所有在台目标球（14 颗） |
| `GROUPS_ASSIGNED` | 本方组剩余球；本方清空后只剩 8 号 |
| `EIGHT_BALL` | 只剩 8 号（8 号已落袋则无） |

**8 号球在本方目标球清空前永远不是合法目标。**

---

## 6. 犯规

`FoulReason` 统一枚举，避免字符串散落：

| 原因 | 含义 |
| --- | --- |
| `WRONG_BALL_FIRST` | 先碰到的不是本方目标球 |
| `NO_CONTACT` | 空杆，母球没碰到任何球 |
| `SCRATCH` | 母球落袋 |
| `ILLEGAL_EIGHT_BALL` | 非法击打 8 号球 |
| `ILLEGAL_BREAK` | 开球不合法 |
| `OTHER` | 其他，由 `detail` 说明 |

犯规后换手，`runCount` 归零。

**打进对方球默认不是犯规**（`opponentBallPocketedIsFoul: false`），
但本回合不继续击球、换手。这是地区差异项，由 config 控制。

---

## 7. 8 号球与胜负

`onEightBallPotted()` 是引擎里最重要的状态转换：

```
打进 8 号
├─ 是开球这一杆 → 按 eightOnBreak（rerack / win / lose）
├─ 合法（本方已清空 + 母球未落袋） → FRAME_WON，本局获胜
└─ 非法（目标未清空 或 打 8 时母球落袋）
   ├─ eightBallEarlyLosesFrame = true  → FRAME_LOST，本局判负
   └─ eightBallEarlyLosesFrame = false → 仅判犯规
```

其他结束本局的方式：

- `CONCEDE` 认输 → 对手获得本局
- `COMPLETE_FRAME` 裁判声明 → 胜方仍由引擎产出 `FRAME_WON`，
  Service/UI 不得自己造这个事实
- `RERACK` 重新摆球

`COMPLETE_FRAME` 支持 `payload.winnerPlayerIndex` 指定胜方（`winReason = 'referee'`）；
不带该字段时退回当前击球方（`winReason = 'manual'`），
并会校验席位号越界。

> 引擎仍然区分「开球这一杆」与之后的击球（开球进球不认组）。
> 规则本身没变，变的只是 UI 不再要求记分员专门点一次"开球"。

---

## 8. 地区差异：全部参数化

PHASE 3A 第二十八条：**任何存在版本差异的细则都不许在引擎里写死**，
必须能从冻结在 `Match` 上的 `RuleSetSnapshot.config` 读出来。
这样历史比赛永远按它创建时的规则判定，即便以后默认规则改了。

`resolveEightBallRules()` 把 `unknown` 形状的 config 归一化成强类型，
缺失字段一律回落到 CueScore Standard 默认值（不抛错，保证老比赛能打开）。

| 配置项 | 定义 | 归一化 | 实际生效 | 说明 |
| --- | --- | :-: | :-: | --- |
| `breakRequiresPocketOrRailCount` | ✅ | ✅ | ❌ | 只出现在 `RuleTrace` 的开球说明文案里，**不参与任何判定** |
| `breakPocketContinues` | ✅ | ✅ | ❌ | `reduce()` 未读取该字段 |
| `eightOnBreak` | ✅ | ✅ | ✅ | 决定开球打进 8 号是重新摆球 / 赢 / 输 |
| `callShot` | ✅ | ✅ | ⚠️ 部分 | 只做开关（关闭时拒绝 `CALL_SHOT`）与记录，**不校验袋口** |
| `ballInHandOnFoul` | ✅ | ✅ | ❌ | `reduce()` 未读取该字段 |
| `eightBallEarlyLosesFrame` | ✅ | ✅ | ✅ | 决定非法黑八是判负本局还是仅判犯规 |
| `opponentBallPocketedIsFoul` | ✅ | ✅ | ✅ | 决定打进对方球是否算犯规 |

> 上表由 2026-10-30 的 PHASE 3A 终审实测得出（不是按类型定义推断）：
> 判定依据是 `engine.ts` 中 `rules.` 的实际引用点。
> `breakRequiresPocketOrRailCount`、`breakPocketContinues`、`ballInHandOnFoul`
> 三项只是把槽位留好了，行为尚未实现 —— 文档如实标注，避免误以为已生效。

---

## 9. 可解释性：RuleTrace

`reduce()` 每次都返回一条 `RuleTrace`（不写进 state，不持久化）：

- `decision`：人类可读的判定结论
- `validation`：`LEGAL` / `ILLEGAL`
- `reasons[]`：判定依据，逐条列出
- `events[]`：本次产生的事件类型

非法命令不抛异常——返回 `validation: 'ILLEGAL'` + 空事件数组，
状态保持不变。UI 拿到 `lastError` 后提示，业务层不需要 try/catch。

---

## 10. 测试覆盖

`tests/rules/eight-ball/` 共 51 项断言，覆盖：

- `engine.spec.ts`（51 项）：开球前无合法目标、OPEN 球台 14 颗可点、
  开球不认组、同时进两组不认组、本方清空后 8 号为唯一目标、
  非法黑八判负、开球打进 8 号 rerack、认输、裁判指定胜方席位校验等
- `trace.spec.ts`（6 项）：RuleTrace 的可解释性
- `matchService.spec.ts`（9 项）：局数累加、Race To、撤销重做

端到端 `tests/e2e/eightball.spec.ts`（11 项）验证的是
**UI 发命令、引擎判合法性**这条链路，而不是 UI 自己判断。
