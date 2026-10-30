# CueScore — PHASE 2 交付报告

> 阶段目标：把 PHASE 1 的工程地基连成一个**可打开、可创建比赛、可选球种、可添加球员、可进入比赛、可保存、可恢复、可查看状态的真实可用产品骨架**。
>
> 本阶段严格未实现任何球种的具体计分规则（八球/九球/四球/六球/斯诺克规则全部留给 PHASE 3+），未引入 WebSocket / 云同步 / 登录 / 后端 / 锦标赛 / 支付。
>
> **状态：PHASE 2 已完成，按要求停止，未进入 PHASE 3。**

---

## 1. 实际修改文件

### core（零框架依赖层）

| 文件 | 变更 |
|------|------|
| `src/core/types/match.ts` | `Match` 新增 `shareCode` / `engineStateVersion` / `eventSeq` / `schemaVersion`；`FrameResult` 新增 `winnerPlayerIndex`（匿名选手也能定位胜者）；新增 `MatchPlayerInput`（UI → service 的输入契约）；新增 `MATCH_SCHEMA_VERSION` |
| `src/core/types/player.ts` | `Player` 新增 `archived`（软删除）与 `lastUsedAt`（最近使用排序） |
| `src/core/types/template.ts` | 新增 PHASE 2 球种门禁：`PHASE2_PLAYABLE` / `isGamePlayable()` / `COMING_SOON_LABEL` |
| `src/core/match/stateMachine.ts` | 新增 `UNFINISHED_STATUSES` / `isUnfinished()`（首页"继续比赛"判定） |
| `src/core/match/replay.ts` | **重写**：新增 `effectiveEvents()`，让 EventLog 重放正确尊重 UNDO/REDO；`MATCH_CREATED` 映射到 `READY` |
| `src/core/util/shareCode.ts` | **新增**：6 位分享码生成（排除 0/O/1/I/L 易混字符）+ 校验 |
| `src/core/engine/registry.ts` | 类型收敛（去 `any`） |

### data（持久化层）

| 文件 | 变更 |
|------|------|
| `src/data/repository.ts` | `PlayerRepository` 新增 `listPlayers({ includeArchived })`、`deletePlayer()` |
| `src/data/indexeddb/idbRepository.ts` | 实现上述方法；列表按 `lastUsedAt` → `updatedAt` 排序 |
| `src/data/recovery.ts` | **重写**：EventLog 重放现在能重建 `frames` / `currentFrame` / `eventSeq`，并遵守 UNDO/REDO |

### app（编排层）

| 文件 | 变更 |
|------|------|
| `src/app/services/matchService.ts` | `createMatch()` 改为接受 `MatchPlayerInput[]` + 可选 `{ target, displayName }`；补全 `shareCode`/版本字段；`FRAME_WON` 事件携带胜者信息；新增 `FRAME_STARTED` 事件；`eventSeq`/`engineStateVersion` 递增；`recover()` 顺序改为「快照 → EventLog 重放 → 记录」 |
| `src/app/services/playerService.ts` | **新增**：Player CRUD（create/update/archive/unarchive/remove/get/list/recent/touch） |
| `src/app/stores/playerStore.ts` | **新增**：Player 的 zustand store |
| `src/app/stores/matchStore.ts` | `create()` 支持新签名；`dispatch()` 改为 async；新增 `lastError` 错误反馈 |
| `src/app/hooks/useUnfinishedMatch.ts` | **新增**：查询最近一场未完成比赛 |

### ui（展示层）

| 文件 | 变更 |
|------|------|
| `src/ui/pages/HomePage.tsx` | **重写**：产品化首屏 + 继续比赛卡片 + 三入口 + 最近比赛 |
| `src/ui/pages/NewMatchPage.tsx` | **重写**：三步流程（球种 → 模板 → 球员/目标）+ PHASE 3 门禁 |
| `src/ui/pages/MatchPage.tsx` | **重写**：完整比赛工作台（顶部/比分板/固定底部操作区/更多面板） |
| `src/ui/pages/HistoryPage.tsx` | **重写**：状态筛选（全部/进行中/已完成/已取消）+ 计数 |
| `src/ui/pages/PlayersPage.tsx` | **重写**：完整 CRUD（搜索/新建/编辑/归档/最近使用） |
| `src/ui/pages/DisplayPage.tsx` | 改为显示真实帧胜数与分享码 |
| `src/ui/components/Page.tsx` | 新增 `hideNav`（比赛页全屏工作台） |
| `src/ui/components/Container.tsx` | 新增 `wide`（大屏比分板并排） |
| `src/ui/components/Input.tsx` | **新增**：`Input` + `EmptyState` |
| `src/ui/components/ActionBar.tsx` | **新增**：固定底部操作区（48px / 64px 触控 + Safe Area） |
| `src/ui/components/Card.tsx`、`NotFoundPage.tsx` | 小修（`onClick`、未使用导入） |
| `src/index.css` | 新增 `.tnum`（表格数字，防比分跳动） |

### 测试与配置

| 文件 | 变更 |
|------|------|
| `tests/data/repository.test.ts` | 扩展为 13 项（含完整生命周期、非法转换、纯 EventLog 恢复、append-only 验证） |
| `tests/unit/playerService.test.ts` | **新增** 7 项 Player CRUD 测试 |
| `tests/unit/phase2Gating.test.ts` | **新增** 8 项（未完成判定 / 分享码 / 球种门禁） |
| `tests/unit/replay.test.ts` | **新增** 6 项（UNDO/REDO 重放语义） |
| `tests/e2e/smoke.spec.ts` | 重写为 6 项真实业务流 |
| `tests/e2e/capture.spec.ts` | **新增**：三分辨率截图工具（`CAPTURE=1` 触发） |
| `playwright.config.ts` | `capture.spec.ts` 改为按需运行 |

---

## 2. 新增模块

| 模块 | 职责 |
|------|------|
| `core/util/shareCode.ts` | 分享码生成与校验（纯函数） |
| `app/services/playerService.ts` | Player 域服务：CRUD + 归档 + 最近使用 |
| `app/stores/playerStore.ts` | Player 状态管理 |
| `app/hooks/useUnfinishedMatch.ts` | 未完成比赛查询 |
| `ui/components/Input.tsx` | 输入框与空状态 |
| `ui/components/ActionBar.tsx` | 移动端固定底部操作区 |

---

## 3. 页面与路由

| 路由 | 页面 | 状态 |
|------|------|------|
| `/` | 首页 | ✅ 产品化首屏 |
| `/new` | 新建比赛 | ✅ 三步流程 |
| `/match` / `/match/:id` | 比赛工作台 | ✅ 完整 |
| `/history` | 比赛历史 | ✅ 状态筛选 |
| `/players` | 球员管理 | ✅ 完整 CRUD |
| `/stats` | 统计 | 🚧 占位（PHASE 7） |
| `/leaderboard` | 排行榜 | 🚧 占位（PHASE 7） |
| `/settings` | 设置 | ✅ 主题切换 |
| `/display/:id` | 大屏展示 | ✅ 基础只读（PHASE 8 完善） |
| `*` | 404 | ✅ |

---

## 4. Match 创建流程

```
选择球种（8/9 球可创建；6/4/斯诺克显示"即将支持 · Coming in PHASE 3"）
  ↓
选择模板（Race To 7 等推荐配置）
  ↓
添加/选择球员（已有球员 / 临时球员 / 最近使用快选）
  ↓
设置比赛目标（3 / 5 / 7 / 9）
  ↓
创建比赛 → 写入 EventLog + Snapshot + Match 记录
  ↓
跳转 /match/:id
```

**创建时生成字段**（全部已落地）：`id` / `shareCode` / `gameType` / `ruleSetSnapshot`（冻结）/ `matchFormat` / `players` / `target` / `status` / `createdAt` / `updatedAt` / `schemaVersion` / `engineState` / `engineStateVersion` / `eventSeq`。

**事件序列**：`MATCH_CREATED` →（开始比赛时）`MATCH_STARTED` + `FRAME_STARTED`。

---

## 5. Player CRUD

| 能力 | 实现 |
|------|------|
| 创建 | ✅ `PlayerService.create()`，姓名必填、自动 trim |
| 编辑 | ✅ `update()`，改名不影响历史比赛 |
| 删除 | ✅ 软删除 `archive()`（默认从列表隐藏，历史比赛仍可解析）+ 硬删除 `remove()` |
| 搜索 | ✅ 前端按姓名/昵称过滤 |
| 最近使用 | ✅ `lastUsedAt` 排序，创建比赛时自动 touch |
| 新建比赛选已有球员 | ✅ 每席位可展开"从已有球员选择" |
| 新建临时球员 | ✅ 直接输入姓名，标记 `isAnonymous` |

**Q6 决策落实（关键验证）**：`MatchPlayer.displayName` 在创建时冻结。测试 `freezes displayName so later renames never rewrite history (Q6)` 已覆盖——改名后历史比赛仍显示旧名。

---

## 6. MatchState

严格复用 PHASE 1 状态机，UI **不允许**直接改 `status`。

```
SETUP → READY → PLAYING ⇄ PAUSED
                  ↓
              FRAME_END → PLAYING（下一局）
                  ↓
              MATCH_END
任何活动态 → CANCELLED
```

**非法转换被拒绝**：`PLAYING → MATCH_END` 直接抛错，测试 `rejects an illegal transition` 已覆盖。UI 侧收到拒绝会显示 toast「操作不被允许」。

---

## 7. Command

PHASE 2 只实现通用生命周期命令，**未提前编写任何球种假业务逻辑**（无 `BALL_POTTED` / `FOUL` / `PUSH_OUT` / `FREE_BALL`）。

| Command | 状态流转 | 事件 |
|---------|----------|------|
| `START_MATCH` | READY/FRAME_END → PLAYING | `MATCH_STARTED` + `FRAME_STARTED` |
| `PAUSE_MATCH` | PLAYING → PAUSED | `MATCH_PAUSED` |
| `RESUME_MATCH` | PAUSED → PLAYING | `MATCH_RESUMED` |
| `SWITCH_PLAYER` | 不变 | `PLAYER_SWITCHED` |
| `COMPLETE_FRAME` | PLAYING → FRAME_END | `FRAME_WON`（带 `winnerPlayerIndex`） |
| `COMPLETE_MATCH` | FRAME_END → MATCH_END | `MATCH_WON` |
| `CANCEL_MATCH` | READY/PLAYING/PAUSED → CANCELLED | `MATCH_CANCELLED` |
| `UNDO` / `REDO` | 快照栈回退/前进 | `UNDO` / `REDO`（仅追加审计） |

---

## 8. EventLog / Snapshot

架构原则**未被破坏**：

- **EventLog = 事实源**：只追加，永不删除、永不修改
- **Snapshot = 恢复缓存**：可丢失，丢失后由 EventLog 重放恢复

**恢复顺序**（`MatchService.recover`）：

```
1. Snapshot（快路径）
2. EventLog 重放（权威回退）
3. Match 记录（最后兜底，如日志被裁剪）
```

**本阶段修复的一个真实缺陷**：原先 `reconstructMatchFromEvents` 只重放状态，不重建 `frames`/`currentFrame`，且不识别 UNDO。现已修复为 `effectiveEvents()` + 帧重放，测试 `rebuilds frames + currentFrame from the EventLog alone (no snapshot)` 与 `tests/unit/replay.test.ts` 6 项覆盖。

---

## 9. IndexedDB

Schema 保持 PHASE 1 结构（`DB_VERSION = 1`，无破坏性变更）：

| Object Store | Key | 用途 |
|--------------|-----|------|
| `matches` | `id` | 比赛记录（历史列表） |
| `players` | `id` | 球员档案 |
| `events` | `id`，索引 `by-match` | 追加式事件日志 |
| `snapshots` | `matchId` | 恢复缓存 |

UI 层**没有任何一处**直接操作 IndexedDB，全部经 `app` 层服务 → `data` 层 Repository。

---

## 10. Undo / Redo

- 采用 PHASE 1 的 `past / present / future` 三栈（O(1) 撤销）
- EventLog **不删除事件**，只追加 `UNDO` / `REDO` 审计事件
- 重放时 `effectiveEvents()` 按 UNDO/REDO 计算有效事件流，保证「撤销后的重放」与快照一致
- 测试 `keeps the EventLog append-only through undo/redo` 验证：撤销/重做后旧事件全部仍在

---

## 11. History

- 状态筛选：**全部 / 进行中 / 已完成 / 已取消**（带实时计数）
- 显示：球种、球员、比分（帧胜数）、状态徽章、创建时间、当前局、Race To
- 未实现复杂统计（按要求留给 PHASE 7）

---

## 12. 移动端适配

| 项 | 实现 |
|----|------|
| 触控面积 | 普通按钮 ≥ 48px（`min-h-touch`），主操作 ≥ 64px |
| Safe Area | `pb-safe`（`env(safe-area-inset-bottom)`），底部操作区不遮挡 |
| 单手操作 | 操作按钮固定在底部，主操作居中且最大 |
| 比分数字 | `.tnum` 等宽数字，避免跳动 |
| 断点 | 390×844 单列堆叠；≥640px 双人比分板并排；≥1024px 内容放宽至 `max-w-4xl` |
| 误触保护 | 「取消比赛」需二次确认 |

**三分辨率截图已生成**（`screenshots/`，共 30 张）：`390×844`、`834×1112`、`1440×900`。

---

## 13. 测试结果

```
Test Files  8 passed | 1 skipped (9)
Tests       52 passed | 16 skipped (68)
Duration    ~80s
```

| 测试文件 | 数量 | 覆盖 |
|----------|------|------|
| `tests/unit/stateMachine.test.ts` | 6 | 状态机合法/非法转换 |
| `tests/unit/history.test.ts` | 5 | past/present/future 栈 |
| `tests/unit/ruleset.test.ts` | 5 | RuleSet 版本化与冻结 |
| `tests/unit/serialization.test.ts` | 2 | 深拷贝与序列化 |
| `tests/unit/playerService.test.ts` | 7 | **新增** Player CRUD |
| `tests/unit/phase2Gating.test.ts` | 8 | **新增** 球种门禁/分享码/未完成判定 |
| `tests/unit/replay.test.ts` | 6 | **新增** UNDO/REDO 重放语义 |
| `tests/data/repository.test.ts` | 13 | 持久化 + 完整生命周期 + 纯日志恢复 |
| `tests/rules/snooker/snooker.spec.ts` | 16 skipped | PHASE 5 斯诺克脚手架（原样保留） |

**未删除任何 PHASE 1 测试**；`snooker.spec.ts` 的 16 个 `it.skip` 原样保留。

---

## 14. lint / build / e2e

| 命令 | 结果 |
|------|------|
| `npm run lint` | ✅ **0 error / 0 warning** |
| `npm test` | ✅ **52 passed / 16 skipped** |
| `npm run build` | ✅ **成功**（99 modules，`dist/assets/index-*.js` 222.56 kB / gzip 71.27 kB，PWA `sw.js` + `manifest.webmanifest` + 11 precache） |
| `npm run test:e2e` | ✅ **6 passed**（chromium，22.8s） |

**关于此前的 Environment Blocked**：PHASE 1 收尾时 build / e2e 曾被沙箱 `SAFE_DELETE_BULK_GUARD_ERROR` 拦截。本次复跑**均已恢复正常**，无需修改任何项目逻辑来"凑过"验证。

E2E 覆盖的真实业务流：

1. 外壳渲染 + 深色主题 + PWA manifest
2. 受限球种（斯诺克）显示 "Coming in PHASE 3" 且无法创建
3. 创建八球比赛 → 开始 → 暂停
4. 结束本局 → 记录帧 + 局数推进到第 2 局
5. **刷新页面 → 从 IndexedDB 恢复比赛**
6. **首页显示「继续上一场比赛」并可点击恢复**

---

## 15. 已知问题

| # | 问题 | 影响 | 计划 |
|---|------|------|------|
| 1 | 八球/九球无真实计分，`COMPLETE_FRAME` 的胜者是"当前击球方" | 骨架可用，比分不代表真实球局 | PHASE 3 由引擎接管 |
| 2 | `COMPLETE_MATCH` 的 `winnerPlayerId` 仍是占位逻辑 | 仅影响终局胜者字段 | PHASE 3 |
| 3 | 比分为"帧胜数"，尚无单局内得分（如斯诺克单杆分） | PHASE 2 范围内属预期 | PHASE 3/5 |
| 4 | 设置页文案仍写着 "PHASE 1 地基" | 文案滞后 | 下一阶段顺手更新（不属 PHASE 2 硬性要求） |
| 5 | 大屏 DisplayPage 为最简只读版 | 可用但非最终形态 | PHASE 8 |
| 6 | 归档球员目前无法在 UI 中恢复（服务层已支持 `unarchive`） | 功能未暴露 | 下一阶段补入口 |
| 7 | Stats / Leaderboard 仍为占位页 | 按指令本阶段不做 | PHASE 7 |

---

## 16. PHASE 3 建议

1. **八球引擎**（优先）：`EightBallEngine` 实现 `GameEngine<EightBallState>`，落地开球/分组/犯规/黑八判定，注册替换 `NoopEngine`。
2. **九球引擎**：顺序击球、Push Out、9 号球判定。
3. **计分面板 UI**：在工作台底部操作区上方接入引擎驱动的球按钮（此时才允许出现 `BALL_POTTED` 等命令）。
4. **快照策略**：随事件量增长引入「每 N 事件一个快照」，避免全量重放变慢。
5. **引擎状态重放**：目前 EventLog 重放只恢复生命周期与帧，PHASE 3 需让 `reconstructMatchFromEvents` 也重放 `engineState`（可复用引擎的 `reduce`）。
6. **两处小修**：设置页文案更新、归档球员恢复入口。

---

## 附：验收清单对照

### A. 功能

- [x] 首页可用
- [x] 新建比赛可用
- [x] 八球可以创建比赛
- [x] 九球可以创建比赛
- [x] Player CRUD 可用
- [x] Match 可持久化
- [x] 刷新可以恢复
- [x] EventLog 可以恢复
- [x] Snapshot 可以恢复
- [x] History 可用
- [x] Undo/Redo 可用
- [x] Pause/Resume 可用
- [x] Cancel 可用

### B. 架构

- [x] core 无框架依赖（ESLint `no-restricted-imports` 强制，0 warning）
- [x] UI 不直接操作 IndexedDB
- [x] EventLog append-only
- [x] Snapshot 非事实源
- [x] MatchPlayer displayName 冻结
- [x] RuleSet snapshot
- [x] MatchFormat 保留
- [x] Match Template 生效

### C. UX

- [x] 390×844 验证
- [x] 834×1112 验证
- [x] 1440×900 验证
- [x] 移动端可单手完成：打开 → 新建 → 选球种 → 选球员 → 开始

### D. 工程验证

- [x] `npm run lint` 通过
- [x] `npm test` 通过
- [x] `npm run build` 通过
- [x] `npm run test:e2e` 通过

---

**PHASE 2 完成，按要求停止，等待人工确认后再进入 PHASE 3。**
