# ORD-BOOT-0.1 交付报告：StateChangeFeed 边界安全加固

> 交付日期 2026-09-11；目标 revision = workspace **1.3.1**（基线发布 `ordarium-v1.3.0` / commit `a173453`，不重写、不重打 tag）。规范见 [`ORD-BOOT-0.1-state-change-feed-hardening-spec.md`](ORD-BOOT-0.1-state-change-feed-hardening-spec.md)，复现/分类见 [`assessment`](ORD-BOOT-0.1-state-change-feed-hardening-assessment.md)，机器证据见 `evidence/ORD-BOOT-0.1/`。

## 1. 三个缺陷与最小修复

| 缺陷 | 复现（1.3.0 实测） | 修复 |
|---|---|---|
| A `limit=0` 活锁 | `changes({limit:0})` → `{changes:0, cursor 不变, hasMore:true}`；再请求 cursor 不变、`hasMore` 仍 true | `limit` 域收紧为 `1..RESOURCE_LIMITS.maxStateChangePageItems`，`0`/负/小数/非 safe/超限 → `TypeError` |
| B 未来 cursor 静默饥饿 | `cursor=900`（高位）→ `{changes:0, cursor:900, hasMore:false}`；之后再提交 `change_seq=2` 仍不可观测 | 语法解析后做语义校验：`position > 全局 high-water` → `InvalidCursorError`（`INVALID_CURSOR`） |
| C 页大小无上限 | 显式 `limit` 仅要求 `>=0`，可请求任意大页 | 单一资源真值 `RESOURCE_LIMITS.maxStateChangePageItems = 1000`；默认页仍 100 |

复现脚本证据与冻结不变量见 assessment §2–§4；修复后行为由 SCF-B01–B09 机器证明。

## 2. 发布分类裁决（§32/§33）

**裁决：patch —— 1.3.0 → 1.3.1。** 论证：无 schema 迁移、无默认值变化、无新错误码、无 API 形状变化、无弃用面；`INVALID_CURSOR` 的含义（"不是合法持久位置"）未变，只是其触发域扩展；被拒绝的两个输入（`limit=0`、未来位置）在实践中要么不前进、要么静默饥饿，没有正确消费者程序会依赖它们。按 docs/17 §7.2，C 级要求"record 字段/error code 改义"——本批均不涉及，故不触发 minor。**不 bump major。**

消费者可见变化（docs/18 §1 五类清单）：

| # | 类别 | 变化 |
|---|---|---|
| ① | 默认值变化 | 无（默认页仍 100） |
| ② | 存储迁移 | 无（schema 保持 v4，无迁移） |
| ③ | 错误分类变化 | 无（transient/busy/terminal 归属不变） |
| ④ | 新错误码 | 无 |
| ⑤ | 弃用面 | 无 |

**五类之外的消费者可见变化（显式登记）**：

- **输入域收紧**：`changes` 的显式 `limit` 由 `>= 0` 收紧为 `1..RESOURCE_LIMITS.maxStateChangePageItems`（默认 100）；`limit=0` 现为 `TypeError`。
- **既有错误码触发域扩展**：`INVALID_CURSOR` 现在也覆盖"语法合法但位置超出本账本全局 high-water"（未来位置 / 库还原或替换后的失效位置），不再静默返回空页。

## 3. 测试

| ID | 场景 | 端 |
|---|---|---|
| SCF-B01 | `limit=0` 拒绝 | Memory + SQLite + conformance |
| SCF-B02 | `limit=MAX` 接受 | Memory + SQLite |
| SCF-B03 | `limit=MAX+1` 拒绝 | Memory + SQLite + conformance |
| SCF-B04 | 负/小数/非 safe/NaN/Infinity 拒绝 | Memory + SQLite |
| SCF-B05 | 未来 cursor 拒绝（max=3, cursor=4） | Memory + SQLite |
| SCF-B06 | 空库 `cursor=0` 合法、`cursor=1` 拒绝 | Memory + SQLite |
| SCF-B07 | 当前 high-water 合法可续读，写 `N+1` 后可观测 | Memory + SQLite |
| SCF-B08 | 高水位库 cursor 用于低水位（还原/替换）库 → 拒绝 | SQLite |
| SCF-B09 | filter 校验用全局 high-water（alpha max=4, cursor=8 合法），后续 alpha 变更可观测 | Memory + SQLite |

conformance kit 增可移植断言（`limit=0`/`limit>MAX` 拒绝、未来位置拒绝）；`MemoryLedger` 与 `SqliteLedger` 共用同一套。既有 SCF-A01–A10b **全部保留、未削弱、全绿**。

## 4. 最终命令与环境

见 `evidence/ORD-BOOT-0.1/exit-report.md` §4（含最终计数与门禁输出摘要）。

## 5. 发布

1.3.1 版本线与六 tarball 资产的发布动作见 exit report §5；`ordarium-v1.3.0` 保持不变。若本环境授权，发布 `ordarium-v1.3.1`（新 commit）；否则留 exact release-ready commit 并报告 publication 外部化。

## 6. 明确非目标（未做）

schema v5 / ledger UUID / database epoch / cursor 身份绑定（`LedgerIdentityBinding = DEFER`）；阻塞等待/long polling/WebSocket/SSE/IPC watcher；`ack`/consumer offsets/consumer registry/mailbox/delivery leases；一切 agent/federation 语义（`Agent`/`Peer`/`CollaborationEvent`/`BoundaryContract`/`collab_*`/peer discovery/wake）。全局 filter unknown-key 策略未收紧。
