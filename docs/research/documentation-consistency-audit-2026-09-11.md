# 文档一致性审计与重构（2026-09-11）

> **性质**：工程审计记录，非合同。与 docs/12–19 冲突时以 12–19 为准。
>
> **触发**：发布线推进到 1.3.1（ORD-BOOT-0 / ORD-BOOT-0.1）后，权威文档中仍存在大量"私有 baseline / user_version=2 / 四包 / 五包 / 首发前"口径的**当前态陈述**——它们描述的是 G1–G7 之前的世界，与已发布现实冲突。本次对全部 100 份文档做了一次系统扫描、分类与重构。
>
> **基线**：`main` = `073409b`（ordarium-v1.3.1 已发布，工作树干净）。

## 1. 审计方法

1. **机械扫描**：对 `--include=*.md` 全仓 grep 陈旧模式——`user_version`、`schema v1/v2/v3/v4`、`private v1`、`四包`、`五包`、`1.0.0/1.1.0/1.2.0`、`待实现`、`尚未`、`[当前缺口]`、测试计数；
2. **分类**：分为三类——(a) **当前态错误**（必须改）、(b) **历史记录**（保留原文，加日期化注记）、(c) **真实未实现项**（保留）；
3. **对代码求证**：对含糊条目回源码验证（`installOrdarium().dispose()` 冻结序、capability gate、reconcile-only、retention/GC、message kind、per-package `engines`），避免"看着像陈旧就改"；
4. **回归**：改后跑 `pnpm verify:docs`（链接/围栏/README 宣称）与全量门。

## 2. 发现的陈旧当前态主张（已修正）

| 位置 | 陈旧主张 | 处置 |
|---|---|---|
| `docs/13` 头部 | "状态：首个公开版本的目标运行合同。当前 private v1 实现与本合同的差距只记录在 14" | 改为"已交付并发布的运行合同"+ 历史注记 |
| `docs/13` §4 | "首个公开版本的目标为 `user_version=2`…当前 private v1 只能迁移一次" | 改为当前事实：record v2 未变、库版本 v1/v2/v3 → **v4** 前向迁移链 |
| `docs/14` §2 | "当前实现是 private baseline，不是已兑现的发布表面…必须按 G1–G5 原子切换" | 改为"该阶段已全部关闭"+ 当前线 1.3.1；§3 标题标注为历史计划 |
| `docs/14` §1 | 测试计数"25 文件 131 测试"、缺发布线行 | 更新为 35 文件 / 214 测试；新增"发布线"行 |
| `docs/14` §4 | "不要求用户理解内部四包" | 改为"内部包组装（内核四包 + 宿主叶包）" |
| `docs/15` §12.1 | "目标 `user_version=2`…当前 private v1" | 改为 v1/v2/v3→v4 迁移链 |
| `docs/15` §11.3 | "`dispose()` 只是 unregister 后立即 close，尚未实现 in-flight drain" | 改：G3 已实现冻结序 quiesce→unregister→drain→…→close（附源码指针） |
| `docs/15` §15（heartbeat） | "当前 v1 heartbeat…目标 v2 要求…" | 改为"历史缺口（已闭合 G2）"+ 保留"自动删除 operation 仍不做" |
| `docs/15` §20.2 状态表 | 14 行"…待实现/待切换/待补" | 逐行改为"已交付（Gx）"，附 G1 口径注记 |
| `docs/15` §20.3 状态表 | "v1 已实现，v2 待迁移"、"capability gate 待实现"、"diagnostic 待补" | 同上 |
| `docs/15` §24.2 | "尚无通用 migration runner/backup API/tombstone"、"decoder 只检查部分顶层字段" | 改为已交付（G1/G2），tombstone/GC 标注为冻结的"不做" |
| `docs/15` §25 错误表 | 缺发布后新增错误码；文末称 infra 错误族未冻结 | 补入 `LEDGER_*`/`STATE_*`/`HOST_CONTRACT_MISMATCH`/`INVALID_CURSOR`/`INPUT_TOO_LARGE`/`CONTRACT_DRIFT`，并以 docs/dev/04 为准 |
| `docs/15` §26 | "实现仍未达到发布完整度" + 整列未交付证明 | 逐行补当前证据；最终判定改为"已达发布完整度（1.0.0 首发门通过，当前 1.3.1）" |
| `docs/16` §0/§8.1/§9.2/§9.3 及 6 处节点 | `[发布门] 首发前必须补齐`、`schema v2`、`user_version = 2`、`[当前缺口]`×5、`SQLite v1` | 图例与节点改为"已交付/已闭合（Gx）"；§8.1 迁移图扩展为 v1→v2→v3→v4；§9.3 标注为历史投影 |
| `docs/17` §6.1 | "当前四包仍是 private workspace，没有已发布的公共兼容承诺" | 标注阶段结束 + 当前按 semver 承担外部兼容 |
| `docs/17` §6.3 | `COMPAT-DB-001` 仍写"schema v1 到目标" | 指向机器登记表并标注滚动更新到 v4 |
| `docs/12` 头部/§1/§5/§7 | "发布前必须…机器证明"、`[发布门]`、五包布局（缺 host-kit）、§7 清单未标状态 | 改为已完成口径；补 `@ordarium/host-kit` 叶包与叶包规则；§7 标注"已全部满足" |
| 根 `README.md` | 发布线 `1.1.0`、`ordarium-v1.1.0 随下一次分发执行`、五包、tarball `1.1.0`、缺 state/变更订阅面 | 改为 1.3.1 / 六包 / 六 tarball；新增"管理型 state 与变更订阅"章节；包表补 host-kit 与 host-kit 引擎分层修正 |
| `docs/README.md` | "两层文档（12–18）"、"G0–G9"、"十篇"、研究档案缺 ORD-BOOT-0/0.1 | 重写为三层完整索引（dev / 12–19 / research）+ 状态速览 + 阅读顺序 |
| `docs/dev/README.md` | "12–17"、"十一篇无索引表" | 重写：角色路由 + 完整索引表 + 状态速览 |
| `docs/dev/01` | tarball 与 pin 全为 `1.1.0/1.0.0`、五包 | 改为 1.3.1 / 六包（含 host-kit）+ 版本锚指针 |
| `docs/dev/06` | 能力表缺 state/feed；"迁移到 v3" | 补 `stateChangeFeed` 与 durability 差异；迁移目标改 **v4**；补自定义 ledger 的 feed 契约 |
| `docs/dev/09` | 未提 ledger/state conformance | 新增小节：`runStateLedgerConformance` + feed 可移植断言 |
| `docs/dev/11` | **完全缺变更订阅面**；"内核不提供订阅/推送"（易误读为也不提供 pull 观测）；迁移只写 v2→v3 | 新增"增量观测：StateChangeFeed"整节（cursor/limit/失败模型/局限）；边界重申精确化为"不提供推送/阻塞等待"；迁移改 v4；能力门补 `stateChangeFeed` |

## 3. 新增文档

| 文档 | 作用 |
|---|---|
| [`docs/19-release-history.md`](../19-release-history.md) | **发布事实台账**（此前缺失）：1.0.0→1.3.1 的档位、tag/commit/日期、头条交付、docs/18 五类消费者可见变化、证据指针；§1 当前线速览；§4 四层版本（包/宿主合同/库 schema/record schema）解耦说明；§5 历史可重建性 |
| 本文 | 审计方法与处置记录（可重复执行同一套扫描） |

同时把 `docs/README.md` 与 `docs/dev/README.md` 从"简短入口"重构为**完整索引**（含研究档案表、验证命令表、阅读顺序）。

## 4. 有意保留的历史（不回溯改写）

- `evidence/**` 全部证据包（Delta Sheet、design spec、exit report）——证据即证据；
- `docs/13`/`docs/14`/`docs/15`/`docs/16` 中 G1–G7 冻结期的**决策与清单原文**（"发布门""当前缺口"等），只加**日期化状态注记**指出其已闭合；
- `docs/research/ORD-BOOT-0-*` 的 1.3.0 语义原文（由 ORD-BOOT-0.1 文档以指针 supersede，见各自头部注记）；
- 发布 tag/Release 资产（`ordarium-v1.3.0` 不移动、不重打）。

## 5. 仍属真实的"未实现"（保留不动）

- 对话型 message kind（Stage 2，需求拉动）；
- G13/G14/G15/G17 休眠 spec（触发即实施）；
- retention/自动 GC/tombstone（**冻结的"不做"**：删除会重开重复副作用窗口）；
- 阻塞等待/long polling/SSE/WebSocket/IPC watcher；`ack`/consumer offsets/consumer registry/mailbox/delivery leases；
- cursor/数据库身份绑定（`LedgerIdentityBinding = DEFER`）；
- Palimpsest 适配面（属姊妹仓实验分支）。

## 6. 验证

改动为纯文档，但按仓库纪律跑完整门禁，**全绿**：

```text
pnpm verify:docs          passed（38 documents：36 → 38，新增 19 与本文）
pnpm verify:release       passed（check / architecture / integration / conformance / docs / package）
                          其中 check = 35 文件 / 214 测试全绿；architecture 快照与兼容登记零漂移
```

未在本次运行：`verify:matrix`（Docker 双腿）——本次不触及代码/依赖，最近一次全绿记录见 `evidence/ORD-BOOT-0.1/exit-report.md` §5。

## 7. 后续维护约定

1. **新增"当前态"陈述时，必须写清它属于哪个版本**；历史口径一律加日期化注记而非就地改写；
2. 每次发布后更新 `19`（只追加一行 + 明细小节）与根 README 的当前线；
3. 每批（Goal/ORD-BOOT）交付时同步：`13`（合同面）→ `14`（基线）→ `15`/`16`（结构投影）→ `17`（验收）→ `18`（发布沟通）→ `19`（发布事实）；
4. 任何 schema 版本推进同时更新：`13` §4、`14` 持久化行、`15` §12.1/§24.2、`16` §8.1/§9.2、`dev/06` 运维注意、`evidence/compatibility-register.md`。
