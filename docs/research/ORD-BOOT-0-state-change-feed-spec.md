# ORD-BOOT-0 规范：修订型 state 变更订阅（StateChangeFeed）

> **冻结设计**（实现前冻结，2026-09-11）。本文是实现 ORD-BOOT-0 的规范载体；与 docs/12–18 冲突时以 12–18 为准，本文只收敛该原语的形状与语义。审计与选型依据见 [`ORD-BOOT-0-state-change-feed-assessment.md`](ORD-BOOT-0-state-change-feed-assessment.md)，验收与实现证据见 [`ORD-BOOT-0-delivery-report.md`](ORD-BOOT-0-delivery-report.md) 与 `evidence/ORD-BOOT-0/`。

## 1. 目的

给已提交的管理型 state 修订加一个**通用系统原语**：

```text
durably commit revision
durably observe later revisions
resume after crash
resolve concurrent writes deterministically
```

宿主无需逐 `(namespace,key)` 轮询、无需自建重复变更日志，即可观测"durable position X 之后提交的 state 修订"。内核只观测 state 修订的存在与顺序；含义（消息/收件箱/契约/承诺/配置/计数器/控制状态）由宿主赋予。

## 2. 非目标

不实现：`ack(change)`、consumer offsets、durable subscription registry、delivery leases、mailbox、阻塞等待/long polling/条件变量/IPC 通知/WebSocket/SSE、网络传输/分布式共识/CRDT/全局事务、Palimpsest 适配面（`collab_*`、`CollabEvent`、`BoundaryContract`、peer discovery、attention scheduler、wake policy）。消费者游标归属（"消费者 A 在 X"）留在宿主。

## 3. 排序（ordering）

- 权威真相仍是 `ordarium_state_revisions`。feed 是它的**读取投影**。
- 新增 `ordarium_state_changes(change_seq INTEGER PRIMARY KEY AUTOINCREMENT, namespace, key, revision)`，`UNIQUE(namespace,key,revision)`，外键指向修订行；**无 payload 副本**，只作**定序/索引元数据**。
- `changePosition_i < changePosition_j` 定义**持久的账本提交观测序**；不蕴含因果、墙钟或业务优先级。
- `written_at` 仅元数据，不作协调时钟（多写者/独立时钟/等时戳/非单调墙钟）。隐式 `rowid` 不作公开身份（`VACUUM`/重建可重排）。序由存储引擎在提交事务内分配（`AUTOINCREMENT`），非 `Date.now()`/进程内计数器/UUID 排序/字典序。
- **查询形状与索引**：`WHERE change_seq > ? [AND namespace = ?] ORDER BY change_seq ASC LIMIT ?`。无过滤器时主键 B-tree（rowid 即 `change_seq`）直接升序定位；带 namespace 时用 `ordarium_state_changes_ns_idx(namespace, change_seq)`。两种形状都是有界索引扫描 + JOIN 回修订真值，无全表扫描。

## 4. 事务性与不变量

`ordarium_state_changes` 的插入与 state CAS 的修订/引用插入在**同一 SQLite 事务**内完成：

- `StateRevisionCommitted ⇔ 最终可经 feed 观测`（SCF-INV-1）；
- `FailedStateCAS ⇒ NoFeedChange`（SCF-INV-2；CAS 冲突在插入前返回，且 `sqlite_sequence` 随回滚复原）；
- 外键 + 同事务插入 + 迁移回填共同保证"修订 ↔ 定序行"一对一；读取用 LEFT JOIN，悬空定序行经 `#parseStateRecord` 以 `LEDGER_CORRUPT` fail closed，绝不静默跳过；
- feed **不是第二语义状态存储**（SCF-INV-5）：返回的是既有 `StateRecord` 真值，refs/identity/valueDigest 语义一字未改。

## 5. 游标（cursor）

- **不透明**：base64url(JSON `{"c":"<十进制位置>"}`)，校验为非负 safe integer；永不暴露实现字段。
- **缺省 cursor** = 从位置 0（起点）开始。
- **全局、与过滤器无关**（approach A）：位置空间与过滤器解耦；不同过滤器可复用同一 cursor，语义是"跳过 ≤ 该位置的全局一切"。
- **总是返回**：与既有 `nextCursor?` 不同，`StateChangePage.cursor` 在到达末尾时仍存在——消费者永久持有 resume 位点。空页返回的 cursor 等于输入的 cursor（未消耗任何匹配行）。
- 语义：`changes(filter, C)` 返回位置 > C 的匹配修订；返回 cursor = 本页最后一条匹配修订的位置，空页则为 C。
- **持久性**：序存于库，跨进程重启与 SQLite reopen 均有效（SCF-INV-3）。
- **失败模型**：畸形 cursor（非法 base64/JSON、字段缺失或类型错误、负数/非整数）抛 `INVALID_CURSOR`，fail closed，**绝不**当作"从零开始"。
- **越界**：cursor 指向当前存储之外（大于最大位置）是合法状态，返回空页并回显该 cursor。

## 6. 交付语义（delivery）

```text
AtLeastOnceObservation + DurableCursor + IdempotentConsumerPossible
```

不承诺分布式 exactly-once。消费者可读页→处理部分→崩溃→重读；正确持久化的 cursor 不会静默跳过已提交修订（SCF-INV-4 无缺口遍历：升序查询 + 有界分页）。

## 7. 过滤语义

- 仅 `namespace?: string`（最小通用面）。`keyPrefix` 等非必需谓词 defer。
- 过滤只影响**返回集合**，不改变全局位置空间（§5）。
- 输入校验：`filter` 为对象、`namespace` 为字符串、`limit` 为非负 safe integer；违反抛 `TypeError`。未知字段沿用 core 既有 filter 策略（忽略）。

## 8. 能力面（capability）

```ts
interface StateChangeFilter { namespace?: string; limit?: number }
interface StateChangePage { changes: StateRecord[]; cursor: string; hasMore: boolean }
interface StateChangeFeed { changes(filter?: StateChangeFilter, cursor?: string): Promise<StateChangePage> }

function supportsStateChangeFeed(ledger: OperationLedger): ledger is OperationLedger & StateChangeFeed;
```

- `OperationLedger` **本体不增任何必需成员**；feed 是加法能力，既有实现源兼容（SCF 兼容门）。
- `LedgerCapabilities.stateChangeFeed?: boolean`（**可选**，缺失即不支持）；`supportsStateChangeFeed` 要求"声明 + 实现 `changes`"二者同时成立（不靠类名推断）。
- `OrdariumStateStore.changes()` 委托给 ledger；不支持时 `LEDGER_CAPABILITY_REQUIRED`（复用既有能力门）。游标真相只属于 ledger，StateStore 不复制游标逻辑。
- `MemoryLedger` 与 `SqliteLedger` 均声明并实现；内存账本为 `volatile`，其序为进程内序（能力声明诚实反映这一点）。

## 9. 迁移语义

- `LEDGER_SCHEMA_VERSION` 3→4，纯增表；新库直接建 v4，v1/v2 迁移路径经同一 `createStateTables` 落到 v4。
- v3→v4 事务内：建 `ordarium_state_changes`，按 **`ORDER BY namespace, key, revision`** 升序用 `ROW_NUMBER()` 回填合成位置。该顺序是**确定的迁移序，明确不是恢复出来的原始提交序**（v3 从未记录它）。
- 回填后断言 `COUNT(changes) == COUNT(revisions)`，不等即 fail closed 并回滚；失败迁移保持 v3 库完整。
- 迁移完成后：**所有新提交都带真实持久库序**。历史行保留字节/语义（refs、digest、history、list 行为不变）。

## 10. 失败模型

| 情形 | 结果 |
|---|---|
| 畸形 cursor | `INVALID_CURSOR`（新错误码） |
| ledger 不支持 feed | `LEDGER_CAPABILITY_REQUIRED`（既有错误码） |
| 定序行指向不存在的修订（外部损坏） | `LEDGER_CORRUPT`（既有错误码） |
| migration 失败 | `LEDGER_MIGRATION_FAILED`，回滚保旧版完整 |
| 参数形状非法 | `TypeError` |

## 11. 兼容与版本

- 既有四类 cursor 与 `nextCursor?` 语义零改动（不引入回归，也不用 `INVALID_CURSOR` 改写既有失败语义）。
- `HOST_CONTRACT_VERSION` **保持 `1`**：本次不触及 HostInvocationPort 形状/语义、宿主可见错误族承诺或宿主侧构造默认值。新错误码 `INVALID_CURSOR` 属 ledger/state 面，不进宿主调用握手。
- 包版本 1.2.0→**1.3.0**（minor 加法面，按 docs/18 发布沟通纪律披露：②存储迁移 v3→v4、④新错误码 `INVALID_CURSOR`；①③⑤无）。
- 既有自定义 ledger 源兼容（无必需新成员；能力位可选）。既有 ledger 数据库打开即前向迁移，不自动 downgrade。

## 12. bootstrap 论证与依赖方向

```text
Ordarium core  →  generic state change capability
SqliteLedger   →  durable implementation
future host    →  interprets changes however it wants
```

禁止方向：Palimpsest 语义不得漏进 core。判据不是"Palimpsest 能用"，而是 **"一个完全无关的宿主也能用同一个 `StateChangeFeed`"**——若 API 必须用 Palimpsest 概念才能解释，即为设计失败。本批的宿主无关性由 `packages/ledger-sqlite/test/state-changes.test.ts` 与 `packages/core/test/state-changes.test.ts` 以中性 subject（`alpha/one`、`beta/two`）机器证明。

## 13. 冻结不变量

SCF-INV-1 提交可见 · SCF-INV-2 失败 CAS 无幽灵 · SCF-INV-3 持久 resume · SCF-INV-4 无缺口遍历 · SCF-INV-5 单一真值 · SCF-INV-6 host 中立 · SCF-INV-7 协调边界（跨独立本地 SQLite 客户端成立）。登记见 docs/17 §16.11。
