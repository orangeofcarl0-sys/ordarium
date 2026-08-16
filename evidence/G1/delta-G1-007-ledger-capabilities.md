# Delta G1-007：LedgerCapabilities 合同与 eligibility gate

- 变更分类（docs/17 §7.2）：C 破坏性合同变化（`OperationLedger` 新增必填 `capabilities`；managed-on-volatile 默认从可用变为 fail closed）
- 影响面：public API（types/errors/runtime options）/ 语义（dispatch 前能力准入）/ 双 ledger 实现 / dsh 默认拓扑
- 依据：docs/13 §6.1、docs/17 GOALS-3 §9.2.9、G1-A10；evidence/G0/target-contract-decisions.md §6

## 目标结构与理由

1. `LedgerCapabilities`（docs/13 §6.1 冻结形状）成为 `OperationLedger` 必填只读字段：`durability: volatile | crash-durable`、`coordination: single-isolate | single-process-exclusive | local-multi-process`、`semanticCas: true`、`liveLease`、`semanticHistory`。实现如实声明：MemoryLedger = volatile/single-isolate；SqliteLedger = crash-durable/local-multi-process。
2. runtime 在 parse 之后、任何 ledger 写入之前执行 eligibility gate：managed（guarded/idempotent/reconcilable）要求 crash-durable + liveLease + semanticHistory，且 ledger coordination 覆盖度 ≥ 部署声明拓扑（覆盖排名 single-isolate < single-process-exclusive < local-multi-process）；不足抛新错误码 `LEDGER_CAPABILITY_REQUIRED`，operation 不创建、Provider 零调用。read-only 与 unmanaged 不受限。
3. `OrdariumRuntimeOptions` 新增 `deploymentCoordination`（默认 `single-isolate`，dsh managed 默认路径声明 `local-multi-process`）与 `allowVolatileLedger`（默认 false；测试/嵌入式弱模式的**显式** opt-in，无 crash/restart 保证）。生产 managed 写不再可能静默落在 volatile ledger 上——这是本切片的语义收紧。
4. 禁止 `instanceof` 推断：gate 只读 capabilities 声明（测试用委托 wrapper 伪造声明验证 gate 行为，证明与实现类无关）。

## 旧调用/旧数据的转换位置

无 durable 数据。仓库内 22 处测试构造点一次性更新：managed-on-memory 显式加 `allowVolatileLedger: true`（每个使用点可见弱模式承认）；sqlite 路径无需变更。

## 旧路径删除时点

本变更集内已完成：无 capabilities 的 OperationLedger 实现不再可类型构造；"managed + MemoryLedger 默认可用"路径不存在。

## 证明旧路径不再产生状态的测试

`packages/core/test/capability.test.ts`（6 项，映射 G1-A10）+ sqlite 能力声明测试：

- managed + volatile 无 opt-in → `LEDGER_CAPABILITY_REQUIRED`，ledger 零记录、execute 零调用；
- read-only / unmanaged + volatile 合法；
- 显式 `allowVolatileLedger` 后 managed 可运行（弱模式承认）；
- durable 但 coordination 不覆盖部署拓扑（single-isolate ledger vs local-multi-process 声明）→ 拒绝；覆盖时通过；
- durable 但缺 liveLease 或 semanticHistory → 拒绝；
- Memory/SQLite capabilities 声明逐字段如实践证。

## 需要同步更新的文档

docs/14 §1（持久化行）、docs/17 §2.1（移除 capability 缺口）、§2.2 G1 状态、本 delta sheet。

## 快照变化

`snapshots/api/core/*`（types/ledger/runtime/errors 声明）、`snapshots/api/ledger-sqlite/index.d.ts`、`snapshots/api/dsh/advanced.d.ts`；`contracts.json`（errorCodes 增加 `LEDGER_CAPABILITY_REQUIRED`）。
