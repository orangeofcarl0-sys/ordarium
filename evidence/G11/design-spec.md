# G11 Design Spec：管理型 state kind——"一种时间线，三种墨水"（冻结）

> 依据：`docs/research/agent-landscape-2026-08/03-ledger-taxonomy.md`（方案 B：统一时间线、三种 record kind、准入门与落地次序）、`05-palimpsest-charter.md` §3/§5（责任宪章、Stage 1 首个需求方）、`02-ordarium-position.md` §4 命题二判据。
> 性质：RC 后追加的 Goal（docs/17 增补，随本 Goal 实施）。2026-08-29 会话决议冻结四项分叉：
> **① refs 为一等字段 + 反向查询；② 随本 Goal 修订 docs/14 §5"两个权威、两个存储"条款；③ 写并发 = 乐观 CAS 单原语（无 lease）；④ 完整性 = 每修订内容摘要（不上链）。**
> 已否决项：message kind 与保留类/TTL（Stage 2，需求拉动）；订阅/通知（账本≠总线）；全局跨 kind 序号；state 专用 lease/fence；内核解释引用语义或执行失效传播。

## 1. 合同骨架

```ts
// core/types.ts（草案；命名与字段细节以实施快照为准）
export interface StateRef {
  kind: "operation" | "state";
  /** operationId，或 state 修订的 "namespace/key@revision"。 */
  id: string;
}

export interface StateRecord {
  schemaVersion: 1;
  namespace: string;              // 宿主声明分区（共账拓扑下的隔离约定）
  key: string;                    // subject 键（可变槽位地址，非内容寻址）
  revision: number;               // 每 (namespace, key) 单调，首写 = 1
  value: JsonValue;               // 经 codec 全量校验 + 1 MiB 单值上限
  valueDigest: string;            // digestJson(value)，对齐 operations 的 digest 家族
  refs: StateRef[];               // 一等引用；写入期存在性校验，fail-closed
  identity: InvocationIdentity;   // 写者溯源——统一时间线关联（callId/lineage 成链）的载体
  authorization?: AuthorizationRecord | undefined;
  writtenAt: string;
}
```

OperationLedger 端口新增（MemoryLedger / SqliteLedger 同步实现）：

```ts
getState(namespace: string, key: string): Promise<StateRecord | undefined>; // undefined = 不存在（同 get/lease 先例）
compareAndSetState(namespace: string, key: string, expectedRevision: number, next: StateRecord): Promise<boolean>;
//                                                    ^^^^^^^^^^^^^^^^ 0 = 创建；false = 修订冲突（STATE_REVISION_CONFLICT 由门面抛出）
stateHistory(namespace: string, key: string, cursor?: string, limit?: number): Promise<StateRevisionPage>;
listStatesReferencing(ref: StateRef, cursor?: string, limit?: number): Promise<StateRecordPage>; // 反向查询（决议①）
listStates(filter?: { namespace?: string }, cursor?: string): Promise<StateRecordPage>;
```

决议落地对照：

| 会话决议 | 落地 |
|---|---|
| ① refs 一等 + 反向查询 | `refs` 必填数组；写入期校验被引对象存在（operation 经 `get`，state 经 `(namespace,key,revision)`）；`ordarium_state_refs` 反查表 + `listStatesReferencing` |
| ② 修订 docs/14 §5 | 修订文本见 §6，随本 Goal 走 Architecture Delta Sheet + goal revision |
| ③ 乐观 CAS 单原语 | `compareAndSetState` 一个原语覆盖创建与更新；无 lease/fence；写门槛 = 身份 + 授权证据 |
| ④ 每修订内容摘要 | `valueDigest` 必填；不引入 prevDigest 链式不变量 |

## 2. 门面与发布面

- `createStateStore({ runtime | ledger })`（core）：构造期检查 `LedgerCapabilities.stateRevisions`；bare ledger 可读，写路径能力不足 → `LEDGER_CAPABILITY_REQUIRED`，零写入（与 operations 能力门同款）。经 runtime 构建时尊重生命周期：quiescing → `RUNTIME_QUIESCING`，closed → `LEDGER_CLOSED`。
- 写请求携带 `identity`（溯源）与可选 `authorization`（host-admission 默认；**不复用** `OperatorAuthorization`——那是 operator 审计面）。value 经 codec：JSON 校验 + 1 MiB 上限（`PERSISTED_VALUE_TOO_LARGE`）。
- `@ordarium/dsh/advanced` re-export `createStateStore`；**root façade 19 curated exports 零漂移**；插件壳不加新工具面；host-mcp 本 Goal 不动（ordarium_state 只读工具推迟到需求拉动）。Palimpsest 以 `createStateStore({ runtime: plugin.runtime })` 消费共享实例，无需改壳。

## 3. 边界规则（重述）

1. **写门槛**：身份 + 授权证据表达"谁可写"；并发仲裁 = revision CAS（决议③）。不引入 lease——Palimpsest 的单写者是调度策略，不是它需要的机制。
2. **refs**：类型化指针 + 存在性校验，fail-closed；内核**只存不释**——失效传播、晋升、级联撤销全部留在宿主（Palimpsest 禁止令与 Ordarium 禁止令同时完好）。
3. **完整性**：append-only + 逐修订 `valueDigest`（决议④）。宣称纪律不变：不出现 tamper-proof 类无限定表述。
4. **kind 契约分立、存储不分家**：一套 revision/CAS、一条迁移故事；错误不对称性恰好正确——管理型与证据型同受 `LEDGER_FULL` fail-closed 保护，永不淘汰（淘汰属 Stage 2 对话型保留类）。
5. **namespace 是隔离约定**：共账拓扑下宿主只读写自己的 namespace；越界写权限由授权证据表达，内核不建第二套权限引擎。
6. **准入门复核**：本 Goal 零新并发机制（仅复用 revision/CAS），通过 03§5 门槛。

## 4. SQLite v3 schema

```sql
CREATE TABLE IF NOT EXISTS ordarium_state_revisions (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  revision INTEGER NOT NULL,
  value_digest TEXT NOT NULL,
  written_at TEXT NOT NULL,
  record_json TEXT NOT NULL,
  PRIMARY KEY (namespace, key, revision)
) STRICT;

CREATE TABLE IF NOT EXISTS ordarium_state_refs (
  ref_kind TEXT NOT NULL,          -- 'operation' | 'state'
  ref_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY (ref_kind, ref_id, namespace, key, revision),
  FOREIGN KEY (namespace, key, revision)
    REFERENCES ordarium_state_revisions(namespace, key, revision)
) STRICT;

CREATE INDEX IF NOT EXISTS ordarium_state_refs_ref_idx
  ON ordarium_state_refs(ref_kind, ref_id);
CREATE INDEX IF NOT EXISTS ordarium_state_revisions_ns_idx
  ON ordarium_state_revisions(namespace, written_at DESC);
```

- `user_version` 2 → 3：**纯增表**事务迁移，无数据变换；任一步失败回滚，库保持完整 v2（沿用 v1→v2 迁移模式）。`enableForeignKeyConstraints` 已开。
- 另：`OperationListFilter` 增 `scope?: string`（SQLite 侧 `json_extract(record_json, '$.identity.scope')`，与 actionName 同法）——兑现"预算即账本查询"（02§3 内核洞察一），不建新计数器。

## 5. 错误码（27 → 29）

| 新码 | 语义 | 调用者动作（docs/dev/04 同步） |
|---|---|---|
| `STATE_REVISION_CONFLICT` | expectedRevision 与当前不符（含 0=创建时已存在） | 重读当前修订，合并意图后以新 expectedRevision 重试；不得盲目覆盖 |
| `STATE_REF_NOT_FOUND` | refs 指向不存在的 operation / state 修订 | 先落被引对象，或移除悬空引用后重写 |

复用既有码：`LEDGER_CAPABILITY_REQUIRED`（能力门）、`PERSISTED_VALUE_TOO_LARGE`（上限）、`RUNTIME_QUIESCING`/`LEDGER_CLOSED`（生命周期）、`LEDGER_FULL`/`LEDGER_CORRUPT`/`LEDGER_BUSY`（基建族）。读路径（getState 缺席、空历史）返回 undefined / 空页，不设错误码。

## 6. docs/14 §5 修订文本（决议②，实施时定稿）

原句："Ordarium 不读取 Palimpsest Event Store，Palimpsest 也不直接修改 Ordarium ledger；两个权威、两个存储。"

修订为："管理型事件（计划修订、角色表、门禁注册表）自 G11 起经 Ordarium state 合同落 Ordarium 共账存储；Palimpsest 仍是其唯一语义权威（修订含义、失效传播、晋升门禁），Ordarium 只存不释。证据型 operation 合同不变；Palimpsest 不自写 CAS/fence/锁（宪章禁止令不变）。"

## 7. 验收矩阵

| ID | 场景 | 通过条件 |
|---|---|---|
| G11-A01 | CAS/创建竞态 | 两进程并发 `compareAndSetState` 同 (namespace, key) 恰一胜；expectedRevision=0 创建后重复创建 → `STATE_REVISION_CONFLICT` |
| G11-A02 | 修订链与分页 | `stateHistory` 单调、opaque cursor 分页；缺席 subject 返回空页 |
| G11-A03 | refs 校验与反查 | 悬空引用写入 → `STATE_REF_NOT_FOUND`；合法引用入反查索引；`listStatesReferencing` 恰确（operation 与 state 两种 ref_kind） |
| G11-A04 | 能力门 | `stateRevisions: false` 的 ledger 写入前 `LEDGER_CAPABILITY_REQUIRED`，零写入 |
| G11-A05 | LEDGER_FULL fail-closed | 满库时 state 写入拒绝，不静默降级 |
| G11-A06 | value 上限 | >1 MiB → `PERSISTED_VALUE_TOO_LARGE` |
| G11-A07 | 生命周期 | quiesce 后 state 写 → `RUNTIME_QUIESCING`/`LEDGER_CLOSED`；dispose 字面序不受影响 |
| G11-A08 | 表面治理 | root façade 19 curated 零漂移；exports.test 覆盖 /advanced 新导出；快照冻结 |
| G11-A09 | conformance | testing 包 state 组对 MemoryLedger + SqliteLedger 全绿；`verify:matrix` 复跑 |
| G11-A10 | 预算即查询 | `OperationListFilter.scope` 上线；按 scope 列表/计数可表达 agent_budget 派生视图 |
| G11-A11 | v2→v3 迁移 | 旧库打开自动升 v3，operation 数据逐字节保留；迁移失败回滚完整 v2 |

## 8. 实现切片

- G11-001：core——types / ledger port / errors(+2) / codec(state 校验) / createStateStore / MemoryLedger / scope 过滤；
- G11-002：ledger-sqlite——v3 schema、refs 反查表、v2→v3 迁移；
- G11-003：testing——ledger conformance state 组（A01–A06、A09 场景化）；
- G11-004：dsh——/advanced re-export + exports.test；
- G11-005：docs——docs/14 §5 修订、docs/15 新节、docs/13 合同扩展、docs/17 G11 增补、dev/04 错误表 +2、dev/06 三墨水导览、dev/11 新章（管理型 state 使用）；
- G11-006：Architecture Delta Sheet + `pnpm snapshots:update` + exit report + 全门绿 + 提交。

## 9. 承袭披露与非目标

- **Palimpsest 迁移是姊妹仓库里程碑**（命题二判据①载体）：本 Goal 交付内核、conformance 与合同修订；Palimpsest 收缩自建事件日志、焊 `OPERATION_UNCERTAIN` 接缝在其仓库落地。判据②（一次真实恢复案例成文）亦挂 Palimpsest 真实负载，本 Goal 不虚构。
- 非目标：message kind、保留类/TTL、订阅/通知、全局跨 kind 序号、state lease、host-mcp 工具面、root façade 变更、失效传播语义、跨 namespace 权限引擎。
