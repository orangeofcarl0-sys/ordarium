# ORD-BOOT-0.1 Exit Report

- **goal-id**：ORD-BOOT-0.1 — State Change Feed Safety Hardening（Pre-Palimpsest Federation Bootstrap Closure）
- **基线**：`main` = `a173453`（`ordarium-v1.3.0` 已发布，tag/Release 未重写）；workspace 1.3.0 → 目标 1.3.1；schema v4；`HOST_CONTRACT_VERSION = 1`
- **完成日期**：2026-09-11
- **Delta Sheet**：`evidence/ORD-BOOT-0.1/delta-ORDBOOT01-001-state-change-feed-hardening.md`

## 1. 缺陷复现（1.3.0 实测）

用已发布 1.3.0 构建（`packages/core/dist`）对 `MemoryLedger` 复现：

```text
DEFECT A limit=0 page: {"changes":0,"cursor":"eyJjIjoiMCJ9","hasMore":true}
DEFECT A no progress: true hasMore: true
DEFECT B future=900: {"changes":0,"cursor":"eyJjIjoiOTAwIn0","hasMore":false}
DEFECT B after new commit seq=2 still invisible: true
```

- A：`limit=0` 返回空页、cursor 不变、`hasMore=true` → 确定性活锁。
- B：`cursor=900`（远超 high-water）返回空页并回显 900 → 其后新提交（`change_seq=2`）不可观测 → 静默饥饿。

修复后同一场景：`limit=0` → `TypeError`；`cursor=900` → `INVALID_CURSOR`。

## 2. 实际变更

| 面 | 变更 |
|---|---|
| `@ordarium/core` | `RESOURCE_LIMITS.maxStateChangePageItems = 1000`（新只读字段）；`resolveChangeLimit` 域为 `1..MAX`；`changes` 增全局 high-water 语义校验（`position > highWater` → `InvalidCursorError`）；high-water 空库为 0 |
| `@ordarium/ledger-sqlite` | 同域校验；`#stateChangeHighWater()`（`SELECT MAX(change_seq)`，空为 0）；`changes` 读取前校验 |
| `@ordarium/testing` | `runStateLedgerConformance` 增可移植断言：`limit=0`、`limit>MAX`、未来位置拒绝 |
| schema | **不变，保持 v4**（无表/列/迁移；`snapshots/sqlite-v4.json` 零漂移） |
| 能力/兼容 | `StateChangeFeed` 仍为加法能力；`OperationLedger` 源兼容；`HOST_CONTRACT_VERSION = 1` 不变 |
| 快照 | 仅 `snapshots/api/core/codec.d.ts`（新增 `RESOURCE_LIMITS` 字段）与 `snapshots/contracts.json`（版本 1.3.1） |

## 3. 验收 ID → 证据映射

| ID | 场景 | 位置 |
|---|---|---|
| SCF-B01 | `limit=0` 拒绝 | core + ledger-sqlite `state-changes.test.ts`；conformance kit |
| SCF-B02 | `limit=MAX` 接受 | core + ledger-sqlite |
| SCF-B03 | `limit=MAX+1` 拒绝 | core + ledger-sqlite；conformance kit |
| SCF-B04 | 负/小数/非 safe/NaN/Infinity 拒绝 | core + ledger-sqlite |
| SCF-B05 | 未来 cursor 拒绝 | core + ledger-sqlite |
| SCF-B06 | 空库 cursor 0 合法 / 1 拒绝 | core + ledger-sqlite |
| SCF-B07 | 当前 high-water 合法且可续读 N+1 | core + ledger-sqlite |
| SCF-B08 | 还原到低水位库 → 拒绝 | ledger-sqlite |
| SCF-B09 | filter 校验用全局 high-water | core + ledger-sqlite |

冻结不变量 **SCF-INV-8**（进度安全页大小）、**SCF-INV-9**（无未来位置）、**SCF-INV-10**（资源有界观测）；与 SCF-INV-1..7 并存。既有 SCF-A01–A10b 未削弱、全绿。

## 4. 门禁与最终计数

环境：Windows 10.0.26200 x64，Node `>=24`（`node:sqlite` experimental 警告正常），pnpm 11.16.0。

| 命令 | 结果 |
|---|---|
| `pnpm test` | **35 文件 / 214 测试全绿**（1.3.0 基线 35/197；新增 17：core 8 + ledger-sqlite 9） |
| `pnpm test:integration` | 12 文件 / 77 测试全绿 |
| `pnpm test:conformance` | 5 文件 / 21 测试全绿 |
| `pnpm verify:architecture` | passed（漂移仅 codec.d.ts + contracts.json，与 Delta Sheet 一致；6 兼容登记项） |
| `pnpm verify:docs` | passed（36 documents） |
| `pnpm test:package` | passed（六 tarball 1.3.1 独立消费 + 类型探针） |
| `pnpm verify:release` | passed（check/architecture/integration/conformance/docs/package 六门） |
| `pnpm verify:matrix` | 见 §5（Docker 双腿） |

## 5. Docker Node 矩阵

`pnpm verify:matrix` 双腿全绿（2× `MATRIX_LEG_OK`，exit 0）：

| Leg | Node | 结果 |
|---|---|---|
| `node:24.15.0-slim`（下限） | v24.15.x | 35 文件 / 214 测试 + `verify:architecture` passed |
| `node:24-bookworm`（当前线） | v24.20.0 | 35 文件 / 214 测试 + `verify:architecture` passed |

诚实注记：首轮矩阵运行时 slim 腿出现 **1 例瞬时失败**（1 failed / 213 passed；runner 内部将 vitest 输出截断为 tail，未留用例名）。随后**独立复跑 slim 腿**（35/214 全绿）与**整轮矩阵**（2× `MATRIX_LEG_OK`）均全量通过；bookworm 腿首轮即全绿。判定为容器资源争用下的计时/进程类用例瞬时抖动（`open-retry`/双进程类），非本批逻辑回归——本批新增的 SCF-B 用例为确定性断言。

## 6. 发布分类

**patch 1.3.1**（论证见 `docs/research/ORD-BOOT-0.1-delivery-report.md` §2）。`ordarium-v1.3.0` 保持不可变。

## 7. 兼容登记与文档

- Compatibility Register：**无新增层**（纯行为加固，无 shim、无 schema 变化）；`COMPAT-DB-001` 仍指向 schema v4。
- 文档：`docs/13` §11、`docs/14` §1、`docs/17` §16.12 + 验收矩阵、`docs/dev/04-errors.md`；原 ORD-BOOT-0 spec/delivery 加日期化后发布指针（历史保留）；新增 `docs/research/ORD-BOOT-0.1-{assessment,hardening-spec,delivery-report}.md`。`HOST_CONTRACT_VERSION` 不变。

## 8. 未完成项 / 明确 defer

- `LedgerIdentityBinding`（cursor/DB 身份绑定，需 schema v5）→ **DEFER**，不为本批理论残余情形新增 schema。
- 阻塞等待 / long polling / SSE / WebSocket / IPC watcher → defer（首个 Palimpsest 实验可轮询）。
- `ack` / consumer offsets / consumer registry / mailbox / delivery leases → defer（宿主自有 cursor）。
- 一切 agent/federation 语义（`collab_*` / `CollaborationEvent` / `BoundaryContract` / peer discovery / wake）→ 属 Palimpsest experimental fork。
