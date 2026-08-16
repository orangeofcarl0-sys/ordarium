# Delta G2-001：record/port v2 原子切换（core + MemoryLedger + runtime）

- 变更分类（docs/17 §7.2）：C 破坏性合同变化（按 §5.3 atomic slice：core 类型、双 ledger、runtime、全部 fixtures 一次切换，仓库内无旧形状残留）
- 影响面：public API（types/codec/port）/ 语义（lease 分离、执行期零语义写）/ 全部测试
- 依据：`evidence/G2/design-spec.md` §1/§2；docs/13 §3/§7、docs/17 §10.2

## 目标结构与理由

1. **OperationRecord v2**：`semanticRevision`（原 revision）、`effectKind`（原 guarantee）、新增 `idempotencyMode` 与 `idempotencyExpiresAt`（finite window 创建时冻结的绝对 deadline）、`resumeFrom` 移入 `claim`、`claim.expiresAt` 移出。codec v2 只接受 `schemaVersion: 2`，跨状态不变量随之升级。
2. **端口 v2**：`claim()`（语义 CAS + lease 创建同事务，busy 返回 false）、`lease()`、`renewLease()`（轻量续约：**零**语义写入）、`list(filter, cursor)`/`history(opId, cursor, limit)` 返回带 opaque cursor 的分页页。MemoryLedger 同步实现（claim/lease/续约/分页/默认 limit 100）。
3. **runtime 适配**：claim 走端口（busy 判定读 lease）；心跳只 `renewLease`（执行期不再对 record 做任何 CAS——终态写入基于 dispatched 记录一次完成）；CAS 在 `next.claim === undefined` 时清除 lease；创建时持久化 `idempotencyExpiresAt`（执行期强制属 G3）。
4. 全部测试一次性迁移到 v2 形状/分页 API；旧"心跳靠 revision 增长"断言反转为 v2 语义（revision 冻结、history 不增长、lease 消失）。

## 旧调用/旧数据的转换位置

v1 记录只存在于 SQLite 迁移边界（delta-G2-002）；core/runtime/MemoryLedger 不再有任何 v1 形状。

## 旧路径删除时点

本变更集内：v1 record 类型、通用-CAS 心跳、数组版 list/history 均不存在。

## 证明测试

runtime.test（lease 语义反转断言）、codec.test v2（19 损坏类 + 11 不变量）、全部 G1 回归 74 项绿。

## 快照变化

`api/core/*`、`api/*/index.d.ts`、`contracts.json`、`sqlite-v2.json`（原 sqlite-v1.json 删除）。
