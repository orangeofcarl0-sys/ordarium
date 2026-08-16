# Delta G2-002：SQLite v2 平台（lease 表 / fence CAS / 分页 / infra 错误族 / 迁移 / engines）

- 变更分类（docs/17 §7.2）：C 破坏性合同变化（schema v2 + 错误族新增）
- 依据：`evidence/G2/design-spec.md` §3–§7；docs/13 §6.1/§7、docs/17 §10.3

## 目标结构与理由

1. **schema v2**：`ordarium_operations`（semantic_revision）、`ordarium_operation_events`、新表 `ordarium_operation_leases`（owner/fencing_token/expires_at/lease_revision）；`user_version=2`、`application_id=ORDA` 不变。
2. **事务性迁移**（G2-A01/A02）：打开 v1 库时 `BEGIN IMMEDIATE` → 边界浅校验 v1（`assertV1Record`，防"任意 JSON 盖 v2 章"）→ 转换（claim.expiresAt 拆入 lease、resumeFrom 仅保留于 claimed 态、推导 idempotencyMode；opId/digest/state/attempt/fence/outcome 原样）→ 经 core codec 校验 → 重建三表 → `user_version=2`；任何失败 ROLLBACK，库保持完整 v1，抛 `LEDGER_MIGRATION_FAILED`。
3. **CAS fence 验证**（G2-A04）：CAS 事务内校验 lease 行 `fencingToken === next.lastFencingToken`，旧 owner 终态写入原子拒绝；`next.claim === undefined` 同事务删 lease。
4. **轻量续约**（G2-A03）：`renewLease` 为单条 UPDATE（owner+fence 匹配），不触语义表。
5. **分页**：`(updatedAt DESC, operationId DESC)` keyset + opaque base64url cursor；history 按 semanticRevision；默认 limit 100 与 MemoryLedger 一致（G2-A06）。
6. **infra 错误族**：`LEDGER_OPEN_FAILED/NEWER_SCHEMA/MIGRATION_FAILED/BUSY/CORRUPT/CLOSED/FULL`；node:sqlite 无 code 的错误按 message 兜底映射（"database is locked" 等）；损坏记录读取包装为 `LEDGER_CORRUPT`（G2-A07）。
7. **engines 政策**：ledger-sqlite/dsh `>=24.15.0`，core/testing `>=24.0.0`（真机矩阵归 G7）。
8. 开发中修复两处真实缺陷：BEGIN 在 try 外绕过错误映射（已移入）；迁移边界缺 v1 身份校验（已补，A02 由无效输入证明回滚）。

## 证明测试（`packages/ledger-sqlite/test/g2.test.ts`）

A01 迁移保真（含 claim→lease 拆取）、A02 损坏回滚且 v1 完整、A03 心跳零语义写 + lease_revision 增长、A04 过期接管后旧 owner 终态被拒、A05 双 node 子进程单 claim（真实 spawn）、A06 分页双实现一致、A07 busy/closed/corrupt/newer/open、A08 WAL checkpoint 备份 reopen、A09 旧备份恢复后经 operation key 与 Provider 事实重收敛、A12 双宿主共账（业务键汇合/默认 identity 不折叠/source 可区分）。

## 快照变化

`sqlite-v2.json`（三表 schema + fixture + user_version=2）；`contracts.json`（+7 infra 错误码）。
