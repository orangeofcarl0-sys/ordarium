# 19 · 版本与发布史（Release History）

> **地位**：发布**事实台账**。它回答"发了什么、什么时候、消费者看到什么变化"；[`18-release-compat-policy.md`](18-release-compat-policy.md) 回答"发布时必须说什么、消费侧 bump 时必须查什么"。与 docs/12–17 冲突时以 12–17 为准；兼容层的机器登记仍在 [`../evidence/compatibility-register.md`](../evidence/compatibility-register.md)。
>
> **修订纪律**：历史条目一经发布即为事实，**不回溯改写**（tag 不可移动、Release 资产不替换）；新版本永远指向新 commit。本文只追加。

## 1. 当前线

| 项 | 值 |
|---|---|
| 已发布版本 | **1.3.1**（tag `ordarium-v1.3.1`，见 §2） |
| 工作区版本 | **1.3.2**（已 bump、尚未发布；内容见 §5） |
| 版本锚 | git tag `ordarium-v1.3.1`（annotated）+ 同名 GitHub Release（六 tarball） |
| 分发渠道 | GitHub（仓库即包源；公共 npm 发布未执行，见 §3 的 1.0.0 条目） |
| 包集合 | 六包：`@ordarium/core`、`@ordarium/ledger-sqlite`、`@ordarium/dsh`、`@ordarium/testing`、`@ordarium/host-mcp`、`@ordarium/host-kit` |
| SQLite schema | **v4**（`application_id=ORDA`；v1/v2/v3 旧库打开时事务性前向迁移） |
| `HOST_CONTRACT_VERSION` | **1**（与包版本解耦，只在宿主可见合同语义变化时 +1） |
| Node 下限 | `ledger-sqlite` / `dsh` / `host-mcp` 为 `>=24.15.0`（携带 `node:sqlite` 的层）；`core` / `testing` / `host-kit` 为 `>=24.0.0` |

## 2. 发布序列（一览）

| 版本 | tag / Release | 日期 | 档位 | 头条交付 | 消费者可见变化（docs/18 §1 五类） | 证据 |
|---|---|---|---|---|---|---|
| `1.0.0` | `ordarium-v1.0.0`（`c61775e`） | 2026-08-17 | 首发 | G0–G7：架构冻结、四内核包 + MCP 第二宿主的公开线 | 首个公开线，无前序消费者 | `evidence/G7/release-candidate-report.md` |
| `1.1.0` | `ordarium-v1.1.0`（`c874985`） | 2026-08-29 | minor | G11 管理型 state kind（统一时间线第二 record kind）+ G16 打开退避 | ①默认值（打开退避，仅 BUSY）②存储迁移 v2→v3 ④新错误码 `STATE_REVISION_CONFLICT`/`STATE_REF_NOT_FOUND`；③⑤无 | `evidence/G11/`、`evidence/G16/` |
| `1.2.0` | `ordarium-v1.2.0`（`eee2741`） | 2026-09-06 | minor | G18 versioned Host Adapter 叶包 | ④新错误码 `HOST_CONTRACT_MISMATCH` + 新包面 `@ordarium/host-kit`（第六包）；①②③⑤无 | `evidence/G18/` |
| `1.3.0` | `ordarium-v1.3.0`（`a173453`） | 2026-09-11 | minor | ORD-BOOT-0 修订型 state 变更订阅（`StateChangeFeed`） | ②存储迁移 v3→v4 ④新错误码 `INVALID_CURSOR` + 新面 `StateChangeFeed`/`supportsStateChangeFeed`/`StateStore.changes`；①③⑤无 | `evidence/ORD-BOOT-0/` |
| `1.3.1` | `ordarium-v1.3.1`（`073409b`） | 2026-09-11 | patch | ORD-BOOT-0.1 变更订阅边界加固 | ①②③④⑤均无；**五类之外**：输入域收紧（`limit` → `1..1000`）+ `INVALID_CURSOR` 触发域扩展（未来/失效位置） | `evidence/ORD-BOOT-0.1/` |

## 3. 各版本明细

### 1.0.0 — 首发公开线（2026-08-17）

- 依据 `evidence/G7/`：manifest 成品化（`private:false`、`files`、MIT、`exports`）、五 tarball 消费 fixture、命令收敛、宣称审计；Docker Node 矩阵双腿闭环。
- 分发渠道决议改为 **GitHub**（DSH 插件生态惯例）：仓库即包源，tag 为版本锚。公共 npm 发布尝试因账号 2FA 被 403 拒绝，**零发布**、`@ordarium` scope 保持干净——因此 npm 至今不是分发渠道。
- 包集合：`core` / `ledger-sqlite` / `dsh` / `testing` / `host-mcp`。

### 1.1.0 — 管理型 state kind + 打开退避（2026-08-29）

- **G11（minor，B 类）**：`StateRecord` 合同、`createStateStore` 门面、端口五个 state 方法、`LedgerCapabilities.stateRevisions`、`OperationListFilter.scope`；SQLite **schema v2→v3 纯增表**迁移（`ordarium_state_revisions` + `ordarium_state_refs`）；testing `runStateLedgerConformance`；`@ordarium/dsh/advanced` 再导出（root façade 零漂移）。
- **G16（并入同一 minor）**：`SqliteLedger` 打开默认内置有界退避（5 次 × 100ms，仅 `LEDGER_BUSY`），`openRetry: { attempts: 1 }` 保留 fail-fast。这是**默认值变化**，按 docs/18 §1 ① 披露。
- 发布线决议见 `evidence/G11/delta-G11-002-release-line.md`。

### 1.2.0 — versioned Host Adapter（2026-09-06）

- **G18（minor，B 类）**：core `HOST_CONTRACT_VERSION = 1` + `assertHostContract` + `HostContractMismatchError`（exact-match fail-closed）；testing `runHostAdapterConformance`；新叶包 `@ordarium/host-kit`（curated 适配面 + 版本协商 + runner re-export）。架构门叶包规则扩一档：叶包可依赖 conformance kit。
- 六包自洽：`test:package` 扩至六包并改为离线自洽（编译器与 `@types/node` 取自仓内 pinned devDeps）。
- 姊妹仓 Palimpsest 按 docs/18 §2 核对单完成消费 bump，交付首宿主 conformance 案例（`PLMP-CONF-1`）。

### 1.3.0 — 修订型 state 变更订阅（2026-09-11）

- **ORD-BOOT-0（minor，B 类）**：`StateChangeFeed.changes(filter?, cursor?)` 跨主体按持久账本提交观测序增量读取已提交 state 修订；`supportsStateChangeFeed` 守卫；可选 `LedgerCapabilities.stateChangeFeed`；`OrdariumStateStore.changes` 委托；`INVALID_CURSOR` 错误码。
- SQLite **schema v3→v4**：新增定序元数据表 `ordarium_state_changes`（`change_seq INTEGER PRIMARY KEY AUTOINCREMENT` + 外键，零 payload 副本），与 state CAS **同事务**写入；v3 历史行按 `(namespace, key, revision)` 确定迁移序回填（明确非原始提交序）并断言计数守恒。
- `OperationLedger` 无必需新成员（源兼容）；`HOST_CONTRACT_VERSION` 不变。
- 规范、审计与验收：`docs/research/ORD-BOOT-0-*.md`、`evidence/ORD-BOOT-0/`。

### 1.3.1 — 变更订阅边界加固（2026-09-11，patch）

- **ORD-BOOT-0.1**：关闭三个边界缺陷——`limit=0` 确定性活锁、未来 cursor 静默饥饿、显式页大小无上限。
- `limit` 域收紧为 `1..RESOURCE_LIMITS.maxStateChangePageItems`（新单一资源真值，默认页仍 100）；语法合法但位置 **> 全局 high-water** 的 cursor 报 `INVALID_CURSOR`。
- schema **保持 v4**（无表/列/迁移）；`HOST_CONTRACT_VERSION` 不变。
- 已知局限（明确记录）：不提供 cursor/数据库身份绑定（`LedgerIdentityBinding = DEFER`）。
- 规范、复现与验收：`docs/research/ORD-BOOT-0.1-*.md`、`evidence/ORD-BOOT-0.1/`。

## 4. 版本、合同与快照的关系

```text
package version (semver)        →  消费面的加法/修复节奏（本文 §2）
HOST_CONTRACT_VERSION           →  宿主调用握手（只在宿主可见语义变化时 +1；当前 1）
SQLite user_version             →  库 schema（只前向迁移；当前 4）
record schemaVersion            →  OperationRecord v2 / StateRecord v1
```

四者**互相独立**：包版本 bump 不自动 bump 宿主合同版本或库 schema；库 schema 迁移会按 docs/18 §1 ② 在 release notes 披露。

## 5. 待发布：1.3.2（工作区已 bump，未发布）

| 决定日 | 事项 | 影响面 | 处置 |
|---|---|---|---|
| 2026-09-11 | `@ordarium/dsh` 叶包**冻结为 legacy**（文档叙事去 DSH 中心化；自建宿主为一等路径），并在**类型面**落地：32 处声明/再导出新增 `@deprecated` | release notes 的 docs/18 §1 **⑤ 弃用面**（首次披露）；`.d.ts` 注释；无运行时/形状/依赖变化 | 登记 `COMPAT-DSH-002`；Delta Sheet `evidence/delta-ARCH-003-dsh-legacy-freeze.md`；快照漂移仅 dsh 声明注释 + `contracts.json` 版本；**零 breaking**——包继续随线发布，既有消费者零改动；物理迁移仍受 docs/17 §16 第 6 项双条件约束并休眠 |

> 说明：本文 §1/§2 的生命周期是"已发布事实"；本节记录**已 bump 但尚未打 tag** 的版本，避免消费者可见变化在发布时被遗漏。1.3.2 的 release notes 按 docs/18 §1 逐类披露：①默认值无 ②存储迁移无 ③错误分类无 ④新错误码无 ⑤**弃用面：`@ordarium/dsh` 及其 `/advanced` 子路径冻结为 legacy**。

## 6. 历史可重建性

- 每个版本的**交付报告与 delta sheet** 落在 `evidence/<goal>/`，`ordarium-v1.3.0` 与 `ordarium-v1.3.1` 的规范文本分别保留 ORD-BOOT-0 与 ORD-BOOT-0.1 的原始语义（后者以日期化指针 supersede 前者的具体条款，不删除前文）。
- 快照（`snapshots/`）与 Delta Sheet 同批提交；`verify:architecture` 在无解释漂移时失败。
