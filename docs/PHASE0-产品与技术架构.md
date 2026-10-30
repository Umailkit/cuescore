# CueScore · PHASE 0 产品与技术架构分析

> 版本：v0.1（草案，待确认）
> 日期：2026-10-30
> 状态：**等待确认后再进入 PHASE 1，本阶段不写业务代码**

---

## 0. 本文档要解决什么

把「一个能 +1 的网页」和「一个真正的台球计分产品」之间的差距，拆成可执行的工程结构。
全文分 13 节，对应你要求的 13 项输出。所有决策都给出**理由**和**代价**，方便你逐条拍板。

---

## 1. 参考项目分析

### 1.1 CueSport Scoreboard（主要参考，v8.6.0）

| 维度 | 它怎么做的 | 对 CueScore 的启示 | 我们不照做的地方 |
|---|---|---|---|
| 形态 | OBS Browser Dock（控制面板）+ Browser Source（覆盖层）两个 HTML 页面 | 控制面板 / 展示层**分离**的思想 | 它绑死 OBS；我们做成 `/display/:id` 独立路由，可被 OBS、电视、投影任意一端消费 |
| 玩法 | `8/9/10-Ball / Straight / Bank / One Pocket / Custom / Snooker`，主得分单位分「Racks」与「Points」两类 | **「主得分单位」是一个规则维度**（racks vs points），不是每种玩法各写一套 | 我们抽象成 `ScoringUnit`，而不是靠 gameType 分支 |
| 规则选项 | Golden Ball、Win on Break、Early Game Ball、Point Based 都存在开关里 | 规则差异应收敛为**可配置 ruleSet**，不是硬编码 | 我们用版本化 `ruleSet` 对象，可序列进比赛快照 |
| Ball Scoring | 点球网格，打进游戏球才 +1 rack；unclick 会**扣分** | 高级球号面板的价值：统计 balls potted、B&R、TR | 我们要把「点球」变成事件（BALL_POTTED），而不是直接改计数 |
| Undo | Snooker 逐 pot 撤销，**最多 40 步**，恢复分数/序列阶段/Free Ball 标志/红球清台状态/Active Player | Undo 要恢复的是**一整个可序列化状态**，不是 `score--` | 我们用快照栈 + 事件日志，步数上限可配，默认 100 |
| 统计 | IndexedDB `cuesport_stats`，全局共享不按 instance；H2H、Match History、手动补录比赛 | 统计数据**独立于比分板设置**存放 | 我们更进一步：统计**派生自比赛**，不维护易失的增量计数（见 §6.5） |
| 恢复 | per-instance pending session 存 IndexedDB，刷新即恢复 | 进行中比赛必须可恢复 | 我们把它升格为 Match 状态机的一等公民 |
| 云 / 房间 | **Dock 是唯一计分权威**，云只中继命令；Room 以 Dock Key 为 seat；`/m/{room}` 主控、`/g/{token}` 访客 | 房间码、访客链接、断线暂停控制的 UX | 权威方选择不同，见 §10 |
| 数据 | localStorage（设置）+ BroadcastChannel（跨页同步）+ IndexedDB（历史） | 三种存储各有职责 | 我们收敛为 Repository + IndexedDB 单一真源，跨页同步用 BroadcastChannel 作为传输插件 |

**最关键的一条经验**：它把「计分」和「展示」拆成两个页面后，才可能同时支持 OBS、电视、手机。CueScore 的 `/display/:id` 与 `/m/:code` 本质上是这条路的延伸。

### 1.2 BreakBPM（产品化参考）

| 值得学 | 说明 |
|---|---|
| 5 字符分享码 + `/join/:code` + `/watch/:name` | 三种入口对应三种权限：主控 / 加入 / 观战 |
| `?obs=1` 无边框透明 HUD | 大屏不是「把手机界面放大」，是另一套信息密度 |
| 本地球厅排行榜 `/leaderboard/hall/:slug` | 「地理维度」是台球产品天然的组织方式，Venue 模式有真实需求 |
| Rematch 一键复盘（复用 mode/players/settings） | 降低二次开赛成本，直击 Score First |
| BPM（balls per minute）节奏指标 | 差异化数据维度；CueScore 可对应「每局耗时 / 每杆得分 / 清台率」 |
| Delete my data 时他人记录匿名化而非删除 | 数据统计的隐私边界设计 |

它的 Win98 视觉是刻意的复古定位，**不学**——我们的设计系统走专业体育向（§11）。

### 1.3 SnookerScore（斯诺克规则参考）

- 快捷键表：`1-7` 球、`F4-F7` 犯规、`O` 开球、`E` 结束击球、`M` Miss、`F` Free Ball、`B` Put Back、`A` Play Again、`L` Red Lost、`R` Re-Rack、`W` 赢局、`C` 认输、`U/Z` 撤销、`D/Y` 重做、`Esc` 返回。
- 语义上「Undo/Redo 成对存在」且**自动保存、随时回来接着记**——这是斯诺克场景的硬需求（一局可能 40 分钟）。
- 启示：键盘位是一等交互，不是装饰；我们要重新设计键位（避开与浏览器冲突的组合），但保留「一指一球」的肌肉记忆结构。

### 1.4 Tailuge Billiards（未来扩展参考）

- 物理引擎 + WebGL + Replay + 在线大厅 + 最高 break 排行榜 + Glicko2 等级分。
- 启示：Replay 有两种形态 —— **事件日志回放**（我们 Phase 6 就能做）与**物理轨迹回放**（需要物理引擎，不在路线图内）。
- 明确：**CueScore 第一版不做台球物理游戏**，只保留事件级 Replay 与未来的 Elo/Glicko 接口位。

### 1.5 HP-Billiards

- 仓库返回 404（不存在 / 已删除 / 私有），无法研究。
- 替代方案：多人架构以 **CueSport Cloud 的中继模型**（主机权威）+ **服务端权威 + 乐观更新**的混合设计为准，见 §10。这条路径已被 CueSport 与 BreakBPM 两个真实产品验证过其房间/角色/权限模型。

---

## 2. CueScore 产品定位

> **一句话**：台球领域的「比赛记录 + 实时计分 + 数据平台」。

三层价值，逐层递进：

| 层 | 用户得到什么 | 竞品现状 |
|---|---|---|
| L1 工具 | 30 秒内开一场比赛，桌边单手计分，永不丢数据 | 已有，但多为单玩法、无恢复 |
| L2 记录 | 每杆都有记录：历史、局分、Break、H2H、统计 | CueSport 有（本地）、BreakBPM 有（云） |
| L3 现场 | 大屏 / OBS / 观战 / 房间码，一场比赛多端同看 | CueSport（OBS 强、Web 弱）、BreakBPM（Web 强、玩法少） |

**差异化切口**：把 CueSport 的「玩法与规则深度」和 BreakBPM 的「社交与数据产品化」拼在一起，同时做到 **Offline First**（两者都不彻底）。

### 2.1 三条不可妥协的原则（落到工程约束）

| 原则 | 工程约束 |
|---|---|
| Score First | 首页到「可计分」≤ 3 次点击；不强制注册；玩法默认带推荐配置，可「直接开始」 |
| Mobile First | 所有交互先做 390×844；桌面端是增强（快捷键、多列布局） |
| Offline First | core 与 data 层零网络依赖；网络只做同步增强；Service Worker 预缓存全部静态资源 |

### 2.2 明确不做（第一版）

- 台球物理 / WebGL 对局
- 账号体系、云同步（Phase 9 才引入）
- 淘汰赛 / 循环赛编排（Tournament 在 Phase 10）
- 支付、订阅

---

## 3. 功能优先级（MoSCoW）

| 等级 | 功能 |
|---|---|
| **Must**（没有就不叫产品） | 5 种玩法计分、Race To / Best Of、多人数据模型、状态机、Undo/Redo、事件日志、IndexedDB 持久化、刷新/关页恢复、比赛历史、大屏模式、PWA 安装 |
| **Should** | 选手档案与统计、H2H、排行榜、分享链接、二维码、导入导出 JSON、桌面快捷键、深色模式 |
| **Could**（Phase 9+） | 房间 / 多人协作、观战、WebSocket 实时同步、Venue 多桌、Replay 可视化 |
| **Won't（v1）** | 物理引擎、账号、赛事编排、支付 |

**“快速开始”的最短路径必须是**：首页 → 点【开始比赛】→ 选玩法 → 用默认配置 + 两个临时名字 → 进入计分。注册/选手档案是**事后补全**，不是前置门槛。

---

## 4. 页面信息架构与路由

```
/                          首页：CTA + 进行中比赛卡片 + 最近比赛
/new                       玩法选择（卡片）
/new/:gameType             比赛设置（按玩法动态表单）
/match/:id                 计分台（主战场，移动端底部固定操作栏）
/match/:id/summary         比赛结束页（结果 + 一键再来一局）
/display/:id               大屏模式（只读，自适应 1080p / 竖屏）
/m/:shareCode              分享观看（只读）
/join                      输入房间码加入（Phase 9）
/history                   历史（按玩法筛选 + 搜索）
/history/:id               比赛详情（逐局 / 逐帧 + Break）
/players                   选手列表 + 快速新建
/players/:id               选手主页（统计 + 最近比赛）
/players/:id/h2h/:otherId  H2H 详情
/stats                     统计总览
/leaderboard               排行榜（本地 → 城市 → 球厅）
/settings                  规则默认、外观、数据（导入导出/清空）
```

**导航结构**（移动端底部 Tab 5 个）：比赛 / 历史 / 选手 / 统计 / 设置。首页不放在 Tab 里，Tab 第一项即「当前比赛 or 开始比赛」，保证任何时刻一次点击就能回到计分。

---

## 5. 技术架构

### 5.1 技术选型（Phase 1 锁定）

| 层 | 选型 | 理由 |
|---|---|---|
| 构建 | Vite + React 18 + TypeScript（strict） | 快、生态稳、未来可 SSR |
| 样式 | Tailwind CSS + CSS 变量 design token | 设计系统集中在一个 `theme.css`，不散落魔法色值 |
| 状态 | Zustand（多个小 store，不用一个巨型 store） | 引擎是纯函数，Zustand 只做「装载 + 订阅」，不承担规则 |
| 存储 | IndexedDB（`idb` 薄封装），自研 Repository 层 | 见 §9 |
| PWA | vite-plugin-pwa（Workbox） | manifest + 预缓存 + 更新提示 |
| 单测 | Vitest（+ `fake-indexeddb` 做集成测试） | 与 Vite 同源，零配置成本 |
| 属性测试 | fast-check（可选，Phase 5 引入） | 验证 undo/redo 往返与序列化 round-trip 的不变量 |
| E2E | Playwright（3 视口 + 存储恢复场景） | 唯一能验证「关页恢复」的手段 |
| 后端（Phase 9） | Fastify + ws + PostgreSQL + Prisma | 与 core 同构，直接复用规则引擎 |

### 5.2 分层与依赖方向（**最重要的一条纪律**）

```
┌──────────────────────────────────────────────┐
│  ui/       页面、组件、手势、快捷键            │  可依赖 core / data
├──────────────────────────────────────────────┤
│  app/      store、路由、副作用编排、选择器      │  可依赖 core / data
├──────────────────────────────────────────────┤
│  data/     Repository 接口 + IndexedDB 实现     │  只依赖 core 的类型
├──────────────────────────────────────────────┤
│  core/     规则引擎、状态机、事件、统计派生      │  ★ 零依赖：不碰 React、不碰 IndexedDB、不碰 DOM
└──────────────────────────────────────────────┘
```

依赖**只能向下**。用 ESLint `no-restricted-imports` 在 CI 里强制：

- `core/**` 禁止 import `react`、`zustand`、`idb`、`src/data`、`src/ui`
- `data/**` 禁止 import `src/ui`、`src/app`

**为什么值得在第一天花半天做这件事**：Phase 9 要把规则引擎搬到 Node 服务端跑。只要 core 里渗进一行 `localStorage`，那一天就得重构。core 是纯 TS，可以被浏览器、Node、Vitest 三端同时 import —— 这也是「服务端权威」能成立的前提。

### 5.3 目录结构

```
src/
  core/
    domain/            # 类型：Match / Player / Frame / MatchEvent / RuleSet
    engine/
      types.ts         # GameEngine 接口
      registry.ts      # gameType → engine 工厂
      eight-ball.ts  nine-ball.ts  six-ball.ts  four-ball.ts  snooker.ts
      shared/          # 通用：turn 轮换、race/bestOf 判定、undo 栈
    stats/             # 从 Match[] 派生 PlayerStats / H2H / Leaderboard
    serialize/         # 快照序列化 + schemaVersion 迁移
    __tests__/
  data/
    repository.ts      # 接口定义（MatchRepo / PlayerRepo / EventRepo / KVRepo）
    idb/               # IndexedDB 实现 + schema 版本迁移
    memory/            # 内存实现（测试用）
    sync/              # Phase 9：Transport 接口（BroadcastChannel / WS）
  app/
    stores/            # matchStore / playerStore / uiStore
    selectors/
  ui/
    components/        # 设计系统原子组件
    screens/           # 每个路由一个目录
    scoring/           # 玩法专属计分面板（受 engine 的 EngineView 驱动）
docs/                  # 本文档及后续 Phase 验收记录
tests/e2e/
```

### 5.4 一次操作的完整数据流

```
UI 点击「🔴 红球」
   ↓  构造 MatchCommand { type:'POT_BALL', payload:{ ball:'red' }, actorId }
matchStore.dispatch(command)
   ↓  1) 校验（当前状态允许该命令吗？）
   ↓  2) engine.reduce(currentEngineState, command) → newEngineState + MatchEvent[]
   ↓  3) events 追加到 EventLog（append-only，带 seq）
   ↓  4) 新状态压入 undo 栈（past/present/future）
   ↓  5) 派生 EngineView（比分、当前 break、剩余分、snookers required）
   ↓  6) 持久化（节流 300ms 写 IndexedDB）
UI 重渲染
```

UI **永远不直接写** `match.score`。所有变更都必须产出一个 `MatchEvent`。这条纪律换来的是：Undo/Redo、Replay、审计、多人同步、观战，全部免费。

---

## 6. 数据模型

### 6.1 标识与版本

- 所有实体 `id` 用 `nanoid`（URL 安全，分享码另用 6 位大写字母数字，去除易混字符 `0/O/1/I`）。
- 每个持久化对象带 `schemaVersion`，`data/serialize` 提供迁移链 `v1→v2→…`，保证老比赛能读。

### 6.2 Player

```ts
interface Player {
  id: string
  name: string                  // 唯一展示名，必填
  nickname?: string
  avatarId?: string             // 内置头像 id（避免二进制入库）
  colorSeed: number             // 决定球桌配色槽位，避免用户每次选色
  note?: string
  createdAt: number
  updatedAt: number
  archived: boolean             // 不真删，历史要引用
}
```

**统计不挂在 Player 上**（`stats` 字段是诱人的陷阱：一旦冗余就会不一致）。统计是 §6.5 的派生结果。

### 6.3 Match（统一核心模型）

```ts
type GameType = 'eight-ball' | 'nine-ball' | 'six-ball' | 'four-ball' | 'snooker'

type MatchStatus =
  | 'SETUP'       // 已创建，选手/规则可调
  | 'READY'       // 配置锁定，等待开球
  | 'PLAYING'     // 进行中
  | 'PAUSED'      // 暂停（接电话、换桌）
  | 'FRAME_END'   // 一局刚结束，等待「下一局」
  | 'MATCH_END'   // 已分胜负
  | 'CANCELLED'   // 作废，不计入统计

interface Match {
  id: string
  shareCode: string
  gameType: GameType
  ruleSetId: string                 // 规则版本标识，如 'eight-ball.cn.2024'
  ruleConfig: RuleConfig            // 玩法专属配置（序列化保存，回放时按原始规则复算）

  status: MatchStatus
  createdAt: number
  updatedAt: number
  startedAt?: number
  endedAt?: number

  players: MatchPlayer[]            // ★ 数组，不是 player1/player2
  seatsOrder: string[]              // 出杆顺序（旋转赛/循环赛未来可用）

  target: { kind: 'raceTo' | 'bestOf'; value: number }

  frameIndex: number
  frames: Frame[]
  activePlayerId?: string
  winnerId?: string

  engineState: unknown              // ★ 玩法专属状态，由 engine 负责序列化
  engineStateVersion: number

  eventSeq: number                  // 已确认事件的最大 seq（同步用）
  schemaVersion: number
}

interface MatchPlayer {
  playerId: string                  // 引用 Player；未建档的临时选手用 temp: 前缀
  displayName: string               // 快照名字（后续改名不污染历史）
  colorSeed: number
  joinedAt: number
  role?: 'host' | 'guest' | 'spectator'   // Phase 9 用
}

interface Frame {
  index: number
  startedAt: number
  endedAt?: number
  winnerId?: string
  scores: Record<string, number>    // playerId → 本局得分（斯诺克为分数，八球为 0/1）
  stats: FrameStats                 // 玩法专属：highestBreak / ballsPotted / B&R / fouls / 时长
  endedReason?: 'normal' | 'conceded' | 'early' | 're-rack'
}
```

**设计要点**

1. `players: MatchPlayer[]` —— 支持 2/3/4/6 人数据；而「本局谁对谁」由 engine 的 `seatsOrder` + 赛制决定。用户要求「多人报名、比赛按双人 Match 运行」→ 用 `MatchFormat` 描述：`singles` / `doubles` / `roundRobin`（Phase 10），第一版只实现 `singles`，但**数据形状已留好**。
2. `engineState: unknown` 是关键：核心模型不认识斯诺克的红球数、不认识九球的球号。玩法差异全在 engine 内部，核心只负责「谁在打、第几局、谁赢了」。
3. `ruleConfig` 随比赛存快照 —— 明年改了默认规则，老比赛回放仍然对得上。

### 6.4 MatchEvent

```ts
type MatchEventType =
  | 'MATCH_CREATED' | 'MATCH_STARTED' | 'MATCH_PAUSED' | 'MATCH_RESUMED'
  | 'FRAME_STARTED' | 'FRAME_RESET'          // re-rack
  | 'BALL_POTTED'   | 'SCORE_ADDED'
  | 'FOUL'          | 'MISS' | 'FREE_BALL' | 'SAFETY' | 'PUSH_OUT'
  | 'PLAYER_SWITCHED' | 'BREAK_ENDED' | 'TURN_ENDED'
  | 'FRAME_WON'     | 'MATCH_WON' | 'MATCH_ENDED_EARLY' | 'MATCH_CANCELLED'
  | 'UNDO' | 'REDO' | 'RULE_OVERRIDE'        // 后三个为审计/人工修正

interface MatchEvent {
  id: string
  matchId: string
  seq: number                 // 单调递增，同步与回放的锚点
  timestamp: number
  frameIndex: number
  actorId?: string            // 谁按的
  playerId?: string           // 作用于谁
  type: MatchEventType
  payload: Record<string, unknown>
  schemaVersion: number
}
```

- **append-only**，永不修改。Undo **不删除**事件，而是追加一条 `UNDO`（并指向被撤销的 `seq`）—— 这样 Replay 可以选择「按事实回放（含撤销）」或「按净结果回放」两种模式。
- 事件日志独立 store 存储，按 `matchId + seq` 索引；定期裁剪策略见 §12 风险 9。

### 6.5 统计：派生，不冗余

```ts
interface PlayerStats {
  matches: number; wins: number; losses: number; winRate: number
  frameWins: number; frameLosses: number; frameWinRate: number
  highestBreak: number; longestRun: number
  totalPoints: number; avgPointsPerFrame: number
  totalDurationMs: number; avgFrameDurationMs: number
  currentStreak: number; longestStreak: number
  byGameType: Partial<Record<GameType, StatsSlice>>
  recentForm: ('W' | 'L')[]        // 最近 10 场
  lastPlayedAt?: number
}
interface H2H {
  playerA: string; playerB: string
  matches: number; aWins: number; bWins: number
  frameA: number; frameB: number
  byGameType: Partial<Record<GameType, { matches: number; aWins: number; bWins: number }>>
  recentMatchIds: string[]
}
```

**决策：第一版统计全部从 `Match[]` 实时派生，不建物化统计表。**
理由：单机数据量级（几百到几千场）下，全量聚合 < 10ms；**永远不会出现「统计和历史对不上」**这类最难查的 bug。代价是数据量上万后需要缓存 —— 解法明确：加一层带 TTL 的内存/IndexedDB 派生缓存，或 Phase 9 服务端改用物化视图。这个代价比修一致性 bug 便宜得多。

---

## 7. GameEngine 架构

### 7.1 接口（唯一入口，无 gameType 分支）

```ts
interface GameEngine<S = unknown> {
  readonly gameType: GameType
  readonly ruleSetId: string

  /** 从配置 + 选手创建初始引擎状态 */
  createInitialState(config: RuleConfig, players: MatchPlayer[]): S

  /** 纯函数：状态 + 命令 → 新状态 + 事件。绝不修改入参 */
  reduce(state: S, command: MatchCommand, ctx: EngineContext): EngineResult<S>

  /** 派生视图：给 UI 用的一切，全部由 state 推算，不另存 */
  derive(state: S, ctx: EngineContext): EngineView

  /** 判定 */
  isFrameComplete(state: S): boolean
  isMatchComplete(state: S, ctx: MatchContext): boolean
  getFrameResult(state: S): FrameResult
  getMatchResult(state: S, ctx: MatchContext): MatchResult | null

  /** 持久化 */
  serialize(state: S): unknown
  deserialize(raw: unknown, version: number): S
}

interface EngineResult<S> {
  state: S
  events: Omit<MatchEvent, 'id' | 'matchId' | 'seq' | 'timestamp'>[]
  sideEffects?: SideEffect[]       // 震动、音效、Toast —— 不属于状态
}
```

**纯函数 + 不可变**是整个项目的支点：

| 能力 | 由纯函数直接换来 |
|---|---|
| Undo/Redo | 保存状态快照即可，无需写逆操作（逆操作是 bug 温床） |
| 时间旅行 / Replay | 从初始状态重放事件序列 |
| 多人同步 | 客户端与服务端跑同一份 reduce，乐观更新后比对 |
| 测试 | 无需 mock DOM / 存储，测的是输入→输出 |
| 服务端权威 | core 包能被 Node 直接 import |

### 7.2 通用能力下沉到 `shared/`

| 共享模块 | 内容 |
|---|---|
| `turnManager` | 出杆顺序推进、连续得分留在台上、犯规/失误后换人 |
| `targetPolicy` | `raceTo N` 与 `bestOf N` 的达成判定（bestOf 达成 = `floor(N/2)+1` 局） |
| `undoStack` | 通用 past/present/future，与玩法无关 |
| `clock` | 局/场计时、暂停累计 |

玩法引擎只写自己的规则差异。

### 7.3 五个玩法引擎的范围（第一版）

| 玩法 | 得分单位 | 引擎要管的状态 | 关键规则点 |
|---|---|---|---|
| 中式八球 | Rack（局） | 开球方、当前击球方、犯规标记、8 号球状态 | 简单模式「赢一局」按钮；高级模式球号面板（开球、清台、B&R、8 号球提前/犯规、让局） |
| 九球 | Rack | 当前合法目标球（按号序）、push out 标记、safety 标记 | 打进 9 号球赢局、9 on break、犯规后自由球、push out |
| 六球 | 分（目标分制） | 当前分数、回合、连续得分 | **规则口径需你确认**（见 §14 待确认 Q3）：计分口径与犯规处理做成可配置 ruleSet，不写死 |
| 四球 | 分（目标分制） | 当前分数、+1/+2/+3/自定义、连续得分 | 多人轮转、犯规处理配置化 |
| 斯诺克 | Frame + Points | 红球剩余、当前阶段（red/color/free-ball/endgame）、当前 break、free ball 标记、re-spot 状态 | 见 §7.4 |

### 7.4 斯诺克引擎（最复杂，独立设计）

状态机（台面阶段）：

```
BREAK_OFF → REDS (可打红)
   → COLOR_AFTER_RED → REDS ...（循环）
   → ENDGAME (黄绿棕蓝粉黑依次) → FRAME_END
任意阶段可被打断：FOUL → 对手可 FREE_BALL
```

必须实现的计算（全部为 `derive()` 的纯函数）：

| 计算 | 定义 |
|---|---|
| `currentBreak` | 当前选手本杆连续得分 |
| `frameScore` | 双方本局累计分 |
| `pointsRemaining` | 台面剩余理论分值（含红球数 × (1+7) 的经典公式） |
| `pointsDeficit` | 落后方与领先方的分差 |
| `snookersRequired` | 经典公式：`ceil((deficit - remaining) / 8)`，仍需考虑罚分，**必须写单测逐档验证** |
| `highestBreak` | 本局 / 本场 / 个人历史三级 |

必须支持的操作：End Break、Foul(4/5/6/7)、Miss、Free Ball、Re-Spot、Re-Rack、Concede、Frame Win、Undo、Redo、Put Back、Play Again。

---

## 8. MatchEvent 架构（事件如何驱动一切）

```
       Command（意图）                       Event（事实）
   ┌────────────────────┐              ┌────────────────────┐
   │ POT_BALL{red}      │  engine      │ BALL_POTTED        │
   │ FOUL{value:4}      │ ──reduce──►  │ SCORE_ADDED        │
   │ END_TURN           │              │ PLAYER_SWITCHED    │
   │ NEXT_FRAME         │              │ FRAME_WON          │
   └────────────────────┘              └─────────┬──────────┘
             ▲                                    │
             │ UI / 远端 / 快捷键                   ▼
             │                          ┌────────────────────┐
             │                          │ EventLog（append）  │
             │                          └─────────┬──────────┘
             │                                    ├─► Undo/Redo 快照栈
             │                                    ├─► 持久化（IndexedDB）
             │                                    ├─► Replay 时间线
             │                                    ├─► 统计派生
             │                                    └─► Phase 9：WS 广播 / 观战
```

**三种消费者，同一份日志**：本地 UI、回放、远端同步。这是不用 boolean 管状态、所有变更走事件的直接收益。

---

## 9. Repository 架构（存储可替换）

### 9.1 接口

```ts
interface Repository<T extends { id: string }> {
  get(id: string): Promise<T | undefined>
  list(filter?: Partial<T>): Promise<T[]>
  save(entity: T): Promise<void>
  saveMany(entities: T[]): Promise<void>
  delete(id: string): Promise<void>
  watch(handler: (change: Change<T>) => void): Unsubscribe
}

interface MatchRepository extends Repository<Match> {
  listByStatus(status: MatchStatus[]): Promise<Match[]>
  listRecent(limit: number): Promise<Match[]>
}
interface EventRepository {
  append(matchId: string, events: MatchEvent[]): Promise<void>
  since(matchId: string, seq: number): Promise<MatchEvent[]>
  range(matchId: string, from: number, to: number): Promise<MatchEvent[]>
}
interface PlayerRepository extends Repository<Player> { findByName(name: string): Promise<Player | undefined> }
interface KVRepository { get<T>(k: string): Promise<T | undefined>; set(k: string, v: unknown): Promise<void> }
```

### 9.2 实现演进（业务代码零改动）

```
Repository 接口
   ├── IdbRepository        ← Phase 1，真源：matches / players / events / kv / meta
   ├── MemoryRepository     ← 单测与集成测试
   ├── BroadcastChannelTransport（同一设备多标签页同步，Phase 8 大屏用得上）
   └── HttpRepository + WsTransport  ← Phase 9（Supabase / 自建 Fastify+Postgres 均可）
```

注入方式：`RepositoryProvider`（React Context）+ 工厂函数。业务代码只见接口。

### 9.3 IndexedDB schema（v1）

| store | keyPath | 索引 |
|---|---|---|
| `matches` | `id` | `by-updatedAt`, `by-status`, `by-gameType`, `by-shareCode` |
| `players` | `id` | `by-name`, `by-updatedAt` |
| `events` | `[matchId, seq]` | `by-matchId` |
| `meta` | `key` | — |

**事务边界**：一次计分 = 一个读写事务（更新 match + 追加 events），保证不出现「比分改了但事件没记」。

### 9.4 恢复策略（用户关掉网页的场景）

1. 每次状态变更节流 300ms 持久化；`visibilitychange → hidden` 与 `pagehide` 时**强制同步落盘**。
2. 启动时先查 `status ∈ {READY, PLAYING, PAUSED, FRAME_END}` 的 match，有则首页顶部展示「继续比赛」卡片。
3. 恢复走完整 `deserialize` + `engine.deserialize`，并对 eventSeq 做一致性校验；校验失败时降级为「只读历史 + 提示」，**绝不静默丢弃**。

---

## 10. 未来多人 WebSocket 架构（Phase 9 设计，现在只留缝）

### 10.1 权威方：选服务端权威

CueSport 选「主机 dock 权威」，因为它的场景是 OBS 单机直播。CueScore 要支持**多设备计分、观战、断线重连、球厅多桌**，主机权威会让「主持人手机没电 = 比赛冻结」。

又因为 core 是纯 TS，**服务端可以直接 import 同一份 engine** —— 服务端权威几乎没有额外实现成本。

```
客户端 A（记分）──┐
客户端 B（记分）──┼──► Server（持有 Match + engine，执行 reduce，分配 seq）
大屏 /display ───┤        │
观战 /m/:code ───┘        └─► 广播 EventBatch（含权威 seq）
```

### 10.2 协议

```ts
// 上行：意图
interface ClientCommand { t: 'cmd'; matchId: string; baseSeq: number; cmd: MatchCommand; cmdId: string }
// 下行：事实
interface EventBatch { t: 'events'; matchId: string; fromSeq: number; toSeq: number; events: MatchEvent[]; stateVersion: number }
interface CommandAck { t: 'ack'; cmdId: string; status: 'ok' | 'rejected'; reason?: string; seq: number }
interface Snapshot   { t: 'snapshot'; matchId: string; match: Match; seq: number }
```

**乐观更新 + seq 对齐**：客户端本地先跑一遍 reduce（同构，结果必然一致）立刻渲染；服务端回 `ack + seq`。若 `baseSeq` 落后（别人先动了一步）→ 服务端 `rejected`，客户端用 `since(baseSeq)` 拉增量后重放本地命令。冲突在台球场景极少（一次只有一人按按钮），但协议必须能自愈。

### 10.3 房间与角色

```
Room { id, code(6位), hostId, matchId, tableId?, venueId?, participants[], spectators[], status }
角色：host（可改配置/结束）/ scorer（可计分）/ spectator（只读）
```

大屏 `/display/:id` 永远是 spectator 角色，且**不发任何命令** —— 这样电视端不会因为误触改变比分。

### 10.4 传输抽象（现在就留缝）

```ts
interface Transport {
  send(msg: ClientMessage): void
  on(handler: (msg: ServerMessage) => void): Unsubscribe
  readonly status: 'connecting' | 'open' | 'closed'
}
```
Phase 8 用 `BroadcastChannelTransport` 打通「同一台设备开大屏窗口」，Phase 9 换成 `WebSocketTransport`，上层 store 零改动。

---

## 11. 设计系统（克制、专业、运动感）

| Token | 值（深色为主模式） | 用途 |
|---|---|---|
| `--cue-green-600` | `#0F5132` | 主色，主按钮、球桌底 |
| `--cue-green-500` | `#146B44` | 主色亮态 |
| `--ink-900 / 800 / 700` | `#0B0F0D / #141A17 / #1E2622` | 背景层 |
| `--paper` | `#F5F6F5` | 前景文字（深色模式） |
| `--gold-500` | `#C8A34A` | **仅**胜利 / 冠军 / 破纪录状态 |
| `--danger` | `#C0483B` | 犯规、认输 |
| `--foul-amber` | `#D98324` | 犯规提示，避免与 danger 混用 |

**规则**

- 禁用：大面积渐变、玻璃拟态、发光、超大圆角（>12px）、多色霓虹。
- 圆角：卡片 12px，按钮 10px，芯片 999px。
- 数字：`font-variant-numeric: tabular-nums`，比分用 `clamp(56px, 12vw, 120px)`，等宽避免跳动。
- 动效：状态变化 120ms ease-out；仅胜利/破纪录允许 300ms 一次性动效。**没有装饰性动画**。
- 对比度：比分文字对背景 ≥ 7:1（台球厅灯光昏暗 + 隔几米看）。
- 深浅双模式，深色为默认（夜场 / 球厅）。

**移动端计分台**

```
┌──────────────────────────────┐
│  比分区（顶部 40vh，超大数字）  │
│  张三  5  :  3  李四          │
│  RACK 3 · RACE TO 7          │
├──────────────────────────────┤
│  球号面板 / 得分面板（可滚动）  │
├──────────────────────────────┤
│ [ Undo ]  [  主计分  ]  [下一局]│  ← 固定底栏，height 64px + safe-area
└──────────────────────────────┘
```

- 触控目标 ≥ 48×48（主按钮 64px），按钮间距 ≥ 8px。
- 防误触：关键动作（结束比赛、认输、下一局）二次确认；连续点击 250ms 节流；`navigator.vibrate(10)` 触感反馈。
- 横屏自动切左右分栏（比分左 / 面板右）。

**桌面快捷键（重新设计，非照抄）**

| 键 | 动作 | 键 | 动作 |
|---|---|---|---|
| `1`–`7` | 红黄绿棕蓝粉黑 | `U` | Undo |
| `F4`–`F7` | 犯规 4/5/6/7 | `Y` | Redo |
| `Space` | End Turn | `M` | Miss |
| `E` | End Break | `F` | Free Ball |
| `W` | Frame Win | `R` | Re-Rack |
| `C` | Concede | `Esc` | 返回 / 取消 |

用 `Alt` 作为玩法无关的修饰前缀，避免与浏览器快捷键打架；所有键位集中在 `useKeyboard()` 一处，可配置、可关闭。

---

## 12. 风险点与对策

| # | 风险 | 影响 | 对策 |
|---|---|---|---|
| 1 | 斯诺克规则边界（free ball 后打彩球当红球、snookers required、re-spot） | 算错分 = 产品失信 | 引擎纯函数 + 表驱动单测；把「官方规则条文 → 测试用例」逐条对应；快照测试覆盖 147 全流程 |
| 2 | Undo 跨局语义歧义（上一局的架能撤吗？） | 数据错乱 | 明确策略：**默认可跨局撤销，直到 MATCH_END**；MATCH_END 后只允许「改判」并追加 `RULE_OVERRIDE` 事件；写进文档与 UI 提示 |
| 3 | iOS Safari IndexedDB（7 天驱逐、隐私模式、无痕不可用） | 历史丢失 | ① 活跃比赛**双写** localStorage（小）；② 首次进入提示「添加到主屏幕」；③ 提供 JSON 导出与定期备份提醒；④ 检测配额失败时明确报错而非静默 |
| 4 | 规则地区差异（国标八球 vs 地方规则；六球/四球口径不统一） | 用户说「你算错了」 | ruleSet 版本化 + 设置页可切换；六球/四球的计分口径做成显式可配选项（见 §14） |
| 5 | 范围膨胀（10+ 玩法、赛事、物理引擎） | 永远做不完 | 严格 Phase 门禁：每阶段 `npm test && npm run build` 通过才进下一个；新玩法只在前一玩法测试全绿后加 |
| 6 | core 被 UI/存储污染，Phase 9 无法上服务端 | 大规模返工 | ESLint import 边界在 CI 强制（§5.2） |
| 7 | 大屏长时间运行（球厅一整天）内存/定时器泄漏 | 现场崩 | 事件日志分页加载 + 上限裁剪；单一计时器源；E2E 加「连续运行 N 分钟」冒烟 |
| 8 | PWA 缓存旧版本卡死 | 用户永远看不到新功能 | 版本化 precache + 更新横幅 + `skipWaiting` 由用户触发 |
| 9 | 事件日志无限增长（一场斯诺克可上千事件） | 存储膨胀 | 单场事件超过 2000 条时对**已结束局**做「局摘要折叠」，保留可回放性 |
| 10 | 多人同步下的时钟不一致 | 回放/统计错乱 | 事件时间统一用**服务端 seq 顺序**，客户端时间戳仅作展示 |
| 11 | 「快速开始」被配置表单稀释 | 违背 Score First | 每个玩法提供「推荐配置」一键开始；高级设置折叠在「更多设置」 |

---

## 13. 测试策略

### 13.1 三层

| 层 | 工具 | 覆盖 |
|---|---|---|
| 单元 | Vitest | 每个 engine 的 `reduce` / `derive` / `serialize`；turn 轮换；race/bestOf 判定；undo 栈；统计派生；snookers required 公式 |
| 集成 | Vitest + `fake-indexeddb` | Repository 读写/事务/迁移；「保存 → 重开 → 恢复」往返；事件追加与 `since` 增量 |
| E2E | Playwright | 3 视口（390×844 / 834×1112 / 1440×900）× 关键场景 |

### 13.2 引擎必测清单（每个玩法）

```
score / foul / switch player / end turn / frame end / match end
undo / redo / 序列化 round-trip / 反序列化恢复
非法命令被拒绝（状态机守卫）
Race To 与 Best Of 两种目标各一例
```

### 13.3 斯诺克专项

```
147 满分流程（逐球校验 break、剩余分、阶段迁移）
Foul 4 / 5 / 6 / 7 各自判罚与换人
Free Ball（打彩球当红球，之后回到彩球）
Re-Spot / Re-Rack / Concede
Snookers Required 逐档验证（0、1、2、多颗，含罚分场景）
台面剩余分数在只剩彩球阶段的正确性
End Break 后 break 归零且不误判换人
```

### 13.4 E2E 关键场景（每个 Phase 结束跑）

1. 创建比赛 → 计分 5 步 → Undo 2 步 → Redo 1 步 → 比分正确
2. **刷新页面** → 比赛完整恢复（状态、比分、事件）
3. **关闭标签页再打开** → 首页出现「继续比赛」
4. 打完一整场 → 自动判定胜负 → 进入结束页 → 历史可见
5. 大屏 `/display/:id` 打开后随主端实时更新（BroadcastChannel）
6. 导出 JSON → 清空 → 导入 → 数据一致
7. 深色 / 浅色模式各跑一遍视觉基线截图

### 13.5 门禁

```bash
npm run lint      # 含 core 依赖边界检查
npm test          # Vitest（含 fake-indexeddb 集成）
npm run build     # 类型 + 构建
npm run test:e2e  # Playwright
```

任一不通过，**不进入下一 Phase**。

---

## 14. 开发 Phase（细化交付物与验收）

| Phase | 交付物 | 验收标准 |
|---|---|---|
| **0** | 本文档 | 你确认 |
| **1** | Vite+TS+Tailwind+Zustand+IndexedDB+PWA 骨架；design token；ESLint 依赖边界；空壳路由 | `build` 通过；PWA 可安装；lint 边界规则生效（故意违规会失败） |
| **2** | 首页 / 玩法选择 / 选手 CRUD / Match 创建 / 状态机骨架 / Repository | 能创建一场**通用**比赛并持久化；刷新可恢复 |
| **3** | 中式八球（简单+高级球号）+ 九球引擎与面板 | 两种玩法全流程单测 + E2E 场景 1–3 |
| **4** | 六球 + 四球引擎（配置化规则） | 同上；规则配置可切换 |
| **5** | 斯诺克引擎（重点） | §13.3 全部用例通过；147 快照测试 |
| **6** | Undo/Redo 通用栈、EventLog、持久化事务、崩溃恢复 | Undo/Redo 往返属性测试；关页恢复 E2E |
| **7** | 历史 / 详情 / 选手主页 / 统计 / H2H / 排行榜 | 统计与历史一致性校验测试 |
| **8** | 大屏 `/display/:id`、分享链接、二维码、BroadcastChannel 同步 | 双窗口同步 E2E；大屏只读性验证 |
| **9** | 房间、角色、WebSocket、服务端权威、断线重连 | 双客户端计分同步；断网重连 seq 补齐 |
| **10** | Venue 多桌、Tournament、OBS 优化 | 按届时需求排 |

**Phase 内节奏**：每个 Phase 先写 `core` 单测 → 再写 UI → 再跑 E2E → 更新 `docs/PHASE{n}-验收.md`。

---

## 15. 需要你拍板的 7 件事

| # | 问题 | 我的建议 |
|---|---|---|
| Q1 | Phase 1 是单仓单应用（目录隔离），还是 pnpm workspace 分成 `core` / `web` / `server` 三个包？ | **先单仓 + 目录隔离 + lint 边界**。拆包的成本在 Phase 9 付一次即可，现在拆会拖慢前 8 个 Phase |
| Q2 | 深色模式与浅色模式谁是默认？ | **深色默认**（球厅/夜场场景），浅色完整支持 |
| Q3 | **六球的计分口径**：是哪一种？（a）1–6 号球按球号计分、先到目标分（如 7 分）；（b）每球 1 分、先到目标分；（c）其它赛事规则 | 做成 ruleSet 可切换，第一版默认 **(b) 每球 1 分、目标分可配（默认 7）**，需要你确认 |
| Q4 | **四球的计分口径与犯规处理**：+1/+2/+3 自定义 + 犯规送分？犯规扣分还是对手加分？ | 默认「自定义加分 + 犯规时对手 +1」，配置化，需要你确认 |
| Q5 | 斯诺克是否需要「Golden Ball / 6 红球」等变体？ | 第一版只做标准 15 红；6-red 作为 ruleSet 变体预留 |
| Q6 | 统计是否允许匿名临时选手（未建档）计入？ | 建议计入，名字做「临时选手」标记，后续可合并到正式 Player |
| Q7 | 数据导出格式：JSON 是否够？要不要 CSV / 成绩单 PDF？ | Phase 7 给 JSON + CSV；PDF 成绩单放 Phase 10 |

---

## 16. 一句话总结

**CueScore 的技术支点只有一个：把规则做成纯函数的引擎（core），把变化做成 append-only 的事件，把存储做成可替换的 Repository。**
这三件事做对，Undo/Redo、回放、统计、大屏、多人、球厅，就都是从同一块地基上长出来的楼层，而不是六套各写一遍的系统。

---

*确认后进入 PHASE 1。未确认前不写业务代码。*
