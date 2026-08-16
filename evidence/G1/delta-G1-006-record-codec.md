# Delta G1-006：完整 OperationRecord codec 与统一资源上限

- 变更分类（docs/17 §7.2）：B 加法（core 新导出）+ C（ledger 校验责任迁移；private 阶段允许）
- 影响面：public API（`decodeOperationRecord`、`RESOURCE_LIMITS`、`INPUT_TOO_LARGE`）/ 语义（损坏记录 fail closed、入口资源上限）/ ledger 实现
- 依据：docs/17 GOALS-3 §9.2.5、G1-A06/G1-A07；docs/15 §23（统一长度上限与 oversized-input 要求）

## 目标结构与理由

1. **codec 收归 core 独占**（docs/17 §5.2 单一事实源）：新建 `packages/core/src/codec.ts` 导出 `decodeOperationRecord`（TypeScript 形状、runtime decode、长度上限、跨状态不变量的唯一来源）。`MemoryLedger` 与 `SqliteLedger` 的全部读写路径（get/create/CAS/history/list/`#parseRecord`）改走该 codec；ledger-sqlite 的本地 `assertOperationRecord` 与状态/保证集合删除。Operations（G4）未来同样只消费它，不得另写校验。
2. **完整嵌套校验**：identity（字段长度、lineage ≤64 项）、authorization（decision/kind/source/reason/at）、claim（owner/fence≥1/expiresAt）、resumeFrom、result/receipt（JSON-safe）、SafeError（code 大写标识 ≤128、message ≤4096）、uncertainty、reconciliation、digest（64-hex）、时间戳与安全整数。
3. **跨状态不变量**（runtime 写入合同的形式化）：rev0⇒proposed；proposed 无授权；authorized⇒allow；denied⇒deny；claim 仅存在于 claimed/dispatched 且 fence=lastFencingToken；resumeFrom 仅 claimed；uncertainty 仅 uncertain 或（claimed 且 resumeFrom=uncertain 的恢复中）；succeeded⇒result；failed⇒error；reconciled⇒reconciliation 且 outcome 对应 result/error。违反即视为损坏而非可解释状态。
4. **统一资源上限 `RESOURCE_LIMITS`**（冻结常量）：identity 字段/lineage 条目 256、lineage ≤64、source 256、reason 4096、SafeError 128/4096、input ≤1 MiB canonical JSON。runtime `run()` 入口执行 input 字节数检查（新错误码 `INPUT_TOO_LARGE`）与 identity/lineage 上限检查，超限在 ledger 写入前拒绝。
5. 开发中发现并修正一处不变量过严：恢复 claim uncertain operation 时旧 `uncertainty` 合法保留（原因记载），精确化为"uncertain 或恢复中"。

## 旧调用/旧数据的转换位置

无 durable 迁移：既有合法记录全部通过新 codec（53 项测试回归证明）；损坏记录从"被浅校验放行"变为"读取即 fail closed"。

## 旧路径删除时点

本变更集内已完成：ledger-sqlite 本地校验器删除；MemoryLedger 不再是无校验通道。

## 证明旧路径不再产生状态的测试

- `packages/core/test/codec.test.ts`：15 类嵌套损坏 + 11 类跨状态不变量违规全部拒绝；恢复中的 uncertainty 合法；MemoryLedger 的 CAS/create 对损坏记录 fail closed；
- 资源上限：1 MiB+1 输入 → `INPUT_TOO_LARGE` 且 ledger 零写入零执行；257 字符 identity / 65 项 lineage 入口拒绝；
- `packages/ledger-sqlite/test/sqlite.test.ts`：用原生 SQLite 注入损坏 `record_json`（succeeded 无 result），reopen 后 `get`/`list` 均抛 Corrupt——Provider 不可能基于损坏记录被调用。

## 需要同步更新的文档

docs/14 §1（持久化/测试行）、docs/17 §2.1（移除"decoder 只深入检查部分字段"缺口）、§2.2 G1 状态、本 delta sheet。

## 快照变化

`snapshots/api/core/*`（codec.js 新导出）、`snapshots/api/ledger-sqlite/index.d.ts`（本地校验器删除）；`contracts.json`（errorCodes 增加 `INPUT_TOO_LARGE`）。
