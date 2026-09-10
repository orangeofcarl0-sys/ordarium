# ORD-BOOT-0 Exit Report

- **goal-id**：ORD-BOOT-0 — Host-Neutral Revisioned State Change Feed（Federation Bootstrap Substrate，Ordarium 侧）
- **目标 revision**：workspace 1.3.0（基线 1.2.0 / HEAD `6fb9e95`）；docs 权威面 = `docs/13` §11、`docs/15` §28、`docs/17` §16.11
- **完成日期**：2026-09-11
- **Delta Sheet**：`evidence/ORD-BOOT-0/delta-ORDBOOT0-001-state-change-feed.md`（B 加法合同 + forward schema migration + 新错误码）

## 1. 实际变更的 package / port / schema / API

| 面 | 变更 |
|---|---|
| `@ordarium/core` | 新 `StateChangeFeed`/`StateChangeFilter`/`StateChangePage`；`supportsStateChangeFeed` 守卫；`OrdariumStateStore.changes` 委托；`LedgerCapabilities.stateChangeFeed?`（可选）；新错误类 `InvalidCursorError`（`INVALID_CURSOR`）；`MemoryLedger.changes` 实现 + `stateChangeFeed: true` |
| `@ordarium/ledger-sqlite` | `SqliteLedger implements OperationLedger, StateChangeFeed`；`changes` 实现 + `stateChangeFeed: true`；`compareAndSetState` 同事务写入定序行；schema `user_version` 3→4（新表 `ordarium_state_changes` + 索引 `ordarium_state_changes_ns_idx`）；新 `migrateFromV3` + `#migrateFromV3` 包装 |
| `@ordarium/testing` | `runStateLedgerConformance` 增 feed 场景（声明即断言；签名不变） |
| `@ordarium/dsh` / `host-kit` / `host-mcp` | 零改动（feed 不入宿主调用握手；MCP 面不变） |
| port | `OperationLedger` 本体**零新成员**（加法接口，源兼容） |

## 2. 验收 ID → 证据映射

| ID | 场景 | 证据 |
|---|---|---|
| SCF-A01 | 基本有序观测 | `packages/ledger-sqlite/test/state-changes.test.ts`；core 同名用例 |
| SCF-A02 | 分页无缺口（limit=1，页大小不变性） | 同上 |
| SCF-A03 | caught-up 后新写可观测 | 同上 |
| SCF-A04 | restart-stable cursor（close/reopen） | 同上 |
| SCF-A05 | 双写者 | 同上：同路径两 `SqliteLedger` 实例 + 真实双进程变体（`fixtures/state-change-writer.mjs`） |
| SCF-A06 | CAS loser 无幽灵 | 同上（`STATE_REVISION_CONFLICT`）；core 同名用例 |
| SCF-A07 | namespace filter + 全局 cursor 复用 | 同上 |
| SCF-A08 | 畸形 cursor fail closed（`INVALID_CURSOR`） | 同上；core 同名用例 |
| SCF-A09 | 真实 v3 库迁移 + 回填序 + 回滚保 v3 | 同上（`createV3Database` 真实 v3 DDL）；v1→v4 `g2.test.ts`、v2→v4 `state.test.ts` |
| SCF-A10 | crash/reopen 完整性（committed 存活、rollback 不可见） | 同上（真实进程 crash 变体 + 原始事务 rollback） |
| SCF-A10b | 悬空定序元数据 = `LEDGER_CORRUPT`（不静默跳过） | 同上 |
| conformance kit | 声明即断言的便携 feed 场景 | `packages/testing/src/stateLedger.ts`；`MemoryLedger` 与 `SqliteLedger` 各跑一次 |

负面/故障覆盖：CAS 竞争（A06）、畸形 cursor（A08）、迁移失败回滚（A09 rollback）、悬空定序元数据（A10b）、未提交回滚（A10）、真实进程异常退出（A10）。不只有 happy path。

## 3. Compatibility Register 与文档同步

- Register：`COMPAT-DB-001` 滚动更新至 v4（open-time forward migration，含 v3→v4 回填计数守恒断言）；无新兼容层（纯增面，无 shim）。
- 文档：`docs/13` §11 增量观测 bullet；`docs/15` §28 Mermaid + 段注；`docs/17` §16.11 + 验收矩阵 State feed 行；`docs/14` §1 两行（持久化 v4 滚动 + State 变更订阅）；`docs/dev/04-errors.md`（`INVALID_CURSOR` + migration 描述）；`evidence/README.md` 快照名；新增三份 `docs/research/ORD-BOOT-0-*`。`HOST_CONTRACT_VERSION` 不变（`1`）。

## 4. 最终命令、环境与输出摘要

环境：Windows 10.0.26200 x64，Node `>=24`（`node:sqlite` experimental 警告正常），pnpm 11.16.0。

| 命令 | 结果 |
|---|---|
| `pnpm test`（build + vitest） | **35 文件 / 197 测试全绿**（基线 33/179） |
| `pnpm test:integration` | 12 文件 / 67 测试全绿 |
| `pnpm test:conformance` | 5 文件 / 21 测试全绿 |
| `pnpm verify:architecture` | passed（快照随 Delta Sheet 更新：`sqlite-v3.json`→`sqlite-v4.json`、contracts.json 版本 1.3.0 + `INVALID_CURSOR`；6 兼容登记项） |
| `pnpm verify:docs` | passed（33 documents） |
| `pnpm test:package` | passed（六 tarball 1.3.0 独立消费 + 类型探针） |
| `pnpm verify:release` | passed（check / architecture / integration / conformance / docs / package 六门） |
| `pnpm verify:matrix` | 见 §5（Docker 双腿） |

## 5. 未完成项 / 归属后续

- **发布外部化**：本批留 exact release-ready commit；tag `ordarium-v1.3.0` + GitHub Release（六 tarball）与 push 属外部动作，不在本环境执行。
- **Defer 到下一个 Palimpsest 实验**：`ack`/consumer offsets/durable subscriptions/delivery leases/mailbox、阻塞等待/long polling/IPC 通知/WebSocket/SSE、网络传输/分布式共识/CRDT、全部 `collab_*` 适配面。消费者游标归属留在宿主 state。

## 6. Docker Node 矩阵结果

`pnpm verify:matrix` 双腿全绿（`MATRIX_LEG_OK`，exit 0）：

| Leg | Node | 结果 |
|---|---|---|
| `node:24.15.0-slim`（下限） | v24.15.x（corepack pnpm） | 35 文件 / 197 测试 + `verify:architecture` passed |
| `node:24-bookworm`（当前线） | v24.20.0 / pnpm 12.3.4 | 35 文件 / 197 测试 + `verify:architecture` passed |
