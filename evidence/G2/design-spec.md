# G2 Design Spec：Ledger、Lease 与平台基础（冻结）

> 依据：`ORDARIUM-GOALS-3`（docs/17 §10）、docs/13 §3/§6.1/§7、docs/15 §12/§24、docs/12 §8。
> 性质：G2 实现前的单一目标形状。与 12–17 冲突时以后者为准；本文不产生新权威，只把分散目标收敛为可实施、可验收的冻结设计。实现按 G2-001～005 原子切片推进，每个切片全绿提交。

## 1. Record v2（semantic OperationRecord）

```ts
interface OperationRecord {
  schemaVersion: 2;
  operationId: string;              // op_ + 40 hex
  actionName: string; actionVersion: string;
  contractFingerprint?: string;     // 64-hex（G1-008 已实现，v2 固化）
  inputDigest: string; logicalKeyDigest: string;   // 64-hex
  providerPrincipalDigest?: string; // 64-hex
  identity: InvocationIdentity;
  effectKind: "read-only" | "guarded" | "idempotent" | "reconcilable" | "unmanaged";
  idempotencyMode: "none" | "operation-key";
  idempotencyExpiresAt?: string;    // finite window 创建时冻结的绝对时间；不因重试/重启续期
  state: OperationState;
  semanticRevision: number;         // v1 `revision` 更名
  attempts: number; lastFencingToken: number;
  authorization?: AuthorizationRecord;   // 已分类（G1-003）
  claim?: { owner: string; fencingToken: number; acquiredAt: string;
            resumeFrom?: "authorized" | "dispatched" | "uncertain" };  // 语义获取快照；无 expiresAt
  result?: JsonValue; receipt?: JsonValue; error?: SafeError;
  uncertainty?: { reason: string; at: string };
  reconciliation?: { outcome: "succeeded" | "failed"; at: string };
  createdAt: string; updatedAt: string;  // updatedAt 只随语义变化
}
```

与 v1 的差异：`revision→semanticRevision`、`guarantee→effectKind`、新增 `idempotencyMode/idempotencyExpiresAt`、顶层 `resumeFrom` 移入 `claim.resumeFrom`、`claim.expiresAt` 移出（属 LiveLease）。codec v2 只接受 `schemaVersion: 2`；core 不接收 `v1|v2` union（v1 只存在于 SQLite migration 边界）。

跨状态不变量（v2 版）：rev0⇒proposed；authorization⇒非 proposed；authorized⇒allow、denied⇒deny；claim 仅 claimed/dispatched 且 fence=lastFencingToken 且 resumeFrom 仅随 claim 存在；uncertainty 仅 uncertain 或（claimed 且 claim.resumeFrom=uncertain）；succeeded⇒result、failed⇒error、reconciled⇒reconciliation 与 outcome 对应载荷。

## 2. LiveLease 与端口 v2

```ts
interface LiveLease { operationId: string; owner: string; fencingToken: number;
                      expiresAt: string; leaseRevision: number; }

interface ClaimRequest { owner: string; fencingToken: number; acquiredAt: string;
                         resumeFrom: "authorized" | "dispatched" | "uncertain"; }

interface OperationLedger {
  readonly capabilities: LedgerCapabilities;
  get(operationId): Promise<OperationRecord | undefined>;
  create(record): Promise<{ created: boolean; record: OperationRecord }>;
  compareAndSet(operationId, expectedRevision, next): Promise<boolean>;
  claim(operationId, expectedRevision, request: ClaimRequest,
        lease: { owner; fencingToken; expiresAt }): Promise<boolean>;
  lease(operationId): Promise<LiveLease | undefined>;
  renewLease(operationId, owner, fencingToken, expiresAt): Promise<boolean>;
  history(operationId, cursor?: string, limit?: number): Promise<OperationEventPage>;
  list(filter?: OperationListFilter, cursor?: string): Promise<OperationPage>;
  close?(): Promise<void> | void;
}
interface OperationPage { records: OperationRecord[]; nextCursor?: string; }
interface OperationEventPage { events: OperationEvent[]; nextCursor?: string; }
```

语义规则：

1. **claim**：一个事务内完成语义 CAS（semanticRevision+1、state=claimed、claim 快照、lastFencingToken=fence）与 lease upsert；若存在未过期且 owner 不同的 lease → 返回 false（busy）。
2. **renewLease**：仅当 lease 行 owner+fence 匹配时更新 `expiresAt` 与 `leaseRevision+1`；**不产生任何语义写入**——semanticRevision、语义 updatedAt、history、list 排序全部不变（G2-A03）。
3. **compareAndSet**：revision 匹配且 lease 缺失或 `lease.fencingToken === next.lastFencingToken` 才成功（G2-A04：旧 owner 终态写入被原子拒绝）；`next.claim === undefined` 时同事务删除 lease 行（终态/uncertain 清除 liveness）。
4. 执行期间 runtime 不再对 record 做任何 CAS——终态写入基于 dispatched 记录的 revision 一次完成。
5. MemoryLedger 在单 isolate 内以同步 Map 语义实现同一合同；SqliteLedger 以 `BEGIN IMMEDIATE` 事务实现。

## 3. SQLite schema v2 与迁移

```sql
PRAGMA application_id = 0x4F524441;  -- ORDA 不变
PRAGMA user_version = 2;

CREATE TABLE ordarium_operations (        -- 语义当前记录
  operation_id TEXT PRIMARY KEY,
  semantic_revision INTEGER NOT NULL,
  state TEXT NOT NULL,
  updated_at TEXT NOT NULL,               -- 语义排序时间
  record_json TEXT NOT NULL
) STRICT;

CREATE TABLE ordarium_operation_events (  -- 语义 revision 快照
  operation_id TEXT NOT NULL,
  semantic_revision INTEGER NOT NULL,
  state TEXT NOT NULL, at TEXT NOT NULL, record_json TEXT NOT NULL,
  PRIMARY KEY (operation_id, semantic_revision),
  FOREIGN KEY (operation_id) REFERENCES ordarium_operations(operation_id)
) STRICT;

CREATE TABLE ordarium_operation_leases (  -- 可覆盖的当前 liveness
  operation_id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  fencing_token INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  lease_revision INTEGER NOT NULL
) STRICT;

CREATE INDEX ordarium_operations_state_idx ON ordarium_operations(state, updated_at DESC);
```

迁移（打开时一次性、事务性、前向）：

- `user_version = 0`：直接建 v2 表并置 2；
- `user_version = 1`：`BEGIN IMMEDIATE` → 建 v2 表 → 逐条 decode v1 记录（G1-006 codec 的 v1 形状）→ 转换为 v2（`revision→semanticRevision`、`guarantee→effectKind`、推导 `idempotencyMode`、`claim.expiresAt` 拆入 lease 行、`resumeFrom` 移入 claim、`acquiredAt` 取原 `updatedAt`；**opId/digest/state/attempt/fence/outcome 不变**，G2-A01）→ 写三表 → `PRAGMA user_version = 2` → COMMIT；任一步失败 ROLLBACK，数据库保持完整 v1（G2-A02），抛 `LEDGER_MIGRATION_FAILED`；
- `user_version > 2`：`LEDGER_NEWER_SCHEMA`，fail closed；
- `application_id` 不匹配：`LEDGER_OPEN_FAILED`。

## 4. 分页合同

- 排序固定 `(updatedAt DESC, operationId DESC)`（history 按 `semanticRevision ASC`）；
- cursor 为 opaque（base64url 的排序键），不泄漏 offset 语义；
- 默认 limit 100（Memory 与 SQLite 一致），显式可调；数据集无并发变化时无遗漏/重复；并发变化只承诺 live-cursor 语义（G2-A06）。

## 5. Infrastructure error family

| 触发 | 错误码 |
|---|---|
| open 失败 / 异应用数据库 | `LEDGER_OPEN_FAILED` |
| `user_version` 高于支持 | `LEDGER_NEWER_SCHEMA` |
| 迁移事务失败 | `LEDGER_MIGRATION_FAILED` |
| SQLITE_BUSY / 锁超时 | `LEDGER_BUSY` |
| 记录损坏（codec 拒绝）/ SQLITE_CORRUPT | `LEDGER_CORRUPT` |
| 已关闭后使用 | `LEDGER_CLOSED` |
| SQLITE_FULL 等资源耗尽 | `LEDGER_FULL` |

全部为 `OrdariumError` 子类（稳定 code）；调用者按 code 决定动作，禁止解析 raw SQLite message（G2-A07）。durable open 失败与能力不足都 fail closed，绝不 fallback MemoryLedger。

## 6. Node 支持政策

`@ordarium/ledger-sqlite` 与 `@ordarium/dsh` 的 `engines.node >= 24.15.0`（`node:sqlite` RC 线）；`@ordarium/core`、`@ordarium/testing` 维持 `>= 24.0.0` 独立下限。真实版本矩阵跑在 G7（docs/12 §8）；本机 24.14.1 上的全绿属于开发验证而非矩阵证据。

## 7. 备份 / 保留策略（冻结）

- 无自动 GC：terminal operation 不自动删除（删除会重开重复副作用窗口）；tombstone/归档为未来扩展；
- 活跃库备份：`PRAGMA wal_checkpoint(TRUNCATE)` 后复制主文件，或全部连接关闭后复制文件集（G2-A08 fixture）；
- 恢复旧备份：丢失的 operation identity 使同一业务键重投成为新 operation；对可查询 Action，恢复后 replay 必须经 reconcile 由 Provider 事实证明，不得当作全新安全事实（G2-A09 fixture）。

## 8. 验收映射（docs/17 §10.4）

| ID | 切片 | 证据形式 |
|---|---|---|
| A01 迁移保真 | G2-003 | v1 fixture db → reopen 迁移 → 字段级断言 |
| A02 迁移故障 | G2-003 | 损坏 v1 记录触发回滚，库保持 v1 可再次尝试 |
| A03 心跳写放大 | G2-004 | ManualClock 长任务多心跳：history 长度/semanticRevision/updatedAt 不变，lease 持续有效 |
| A04 终态 vs 接管 | G2-004 | lease 到期接管后旧 owner 终态 CAS false，fence 单调 |
| A05 双进程 | G2-004 | 两个 node 子进程真实文件竞争，单 claim |
| A06 分页 | G2-004 | >100 记录分页无遗漏/重复，Memory=SQLite |
| A07 infra 错误 | G2-002 | busy/closed/corrupt/newer/open 真实触发 + code 映射单测 |
| A08 备份 | G2-004 | checkpoint 后副本含 WAL 已提交状态，reopen 一致 |
| A09 旧备份恢复 | G2-004 | 恢复后 replay 走 reconcile 闭环 |
| A10 Node 矩阵 | G2-002 | engines 字段 + 政策冻结；真机矩阵归 G7 |
| A11 能力矩阵 | 已完成（G1-007） | capability.test |
| A12 双宿主共账 | G2-004 | 两条连接/宿主共享 SQLite：业务键汇合、默认 identity 不折叠、claim 单 dispatch |
