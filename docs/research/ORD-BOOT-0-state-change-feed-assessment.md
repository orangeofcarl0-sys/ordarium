# ORD-BOOT-0 评估：修订型 state 的增量观测缺口

> **研究评估，不是合同**——与 docs/12–18 冲突时以 12–18 为准。本文在实现前冻结 ORD-BOOT-0（host-neutral revisioned state change feed）的审计结论与选型依据；实现后的规范权威落在 [`ORD-BOOT-0-state-change-feed-spec.md`](ORD-BOOT-0-state-change-feed-spec.md)。
>
> 审计基线：`main` = `6fb9e95`（工作树干净），workspace `1.2.0`，ledger schema `user_version=3`，`pnpm test` 33 文件 / 179 测试全绿。

## 1. 缺口（mission）

Ordarium 已经能读"某个 `(namespace,key)` 的当前值"（`getState`）、"某个主体的修订链"（`stateHistory`）、"某主体的所有 subject 现值"（`listStates`）、"引用某对象的修订"（`listStatesReferencing`）。缺的是**一个跨主体、按持久提交顺序增量前进的读取面**：

> "给我 durable position X 之后提交的 state 修订。"

没有它，宿主只能：反复枚举 subject；对每个已知 subject 轮询 history；自建重复变更日志；或用应用专用 mailbox/event 表。四者都错在抽象边界。ORD-BOOT-0 只补这一个通用系统原语，不引入任何多智能体语义。

## 2. 审计问题逐项冻结

审计对象：`packages/core/src/{state,types,codec,ledger,index}.ts`、`packages/ledger-sqlite/src/{index,migrations}.ts`、`packages/{testing,host-kit,host-mcp}/`、`docs/`、`snapshots/`、`tools/verify-*.mjs`。

1. **是否已有可用于 state 修订的持久全局定序原语？** 没有。operation 侧没有全局序——`ordarium_operation_events` 以 `(operation_id, semantic_revision)` 为主键，`history` 只在单 operation 内按 `semantic_revision` 排序；`list` 的排序键是 `(updated_at, operation_id)`，`updated_at` 也是元数据。state 侧同样没有。
2. **state 修订当前是否在任何地方被全局定序？** 没有。`ordarium_state_revisions` 只有 `PRIMARY KEY(namespace,key,revision)`；`stateHistory` 是单主体内按 `revision`；`listStates` 是 `(namespace,key)` 现值视图。跨主体无任何已知顺序。
3. **能否复用现有 cursor 类型而不改变其语义？** 不能。现有四种 cursor（operation history `{r}`、operation list `{u,o}`、state list `{s}`、state ref `{s,r}`）各自绑定到既有排序键与既有"仅在还有下一页时返回 `nextCursor?`"语义。feed 需要"到达末尾仍返回可持久 resume 位点"，与 `nextCursor?` 语义冲突，不能复用。
4. **SQLite 隐式 `rowid` 是否强到可作公开的 restart-stable cursor？** 不够。当前表没有显式 `INTEGER PRIMARY KEY`，`rowid` 是隐式实现细节；`VACUUM` 可重排无显式 `INTEGER PRIMARY KEY` 表的 rowid，表重建迁移同样会重排。不能把它冻成公开身份。
5. **`written_at` 能否在多写者/独立时钟下安全定义顺序？** 不能。进程间存在 clock skew、等时戳、固定/mock 时钟、非单调墙钟，`writtenAt_i < writtenAt_j` 不蕴含 `commit_i < commit_j`。`written_at` 保持元数据，不作协调时钟。
6. **是否需要 schema v4？** 需要。既无全局序原语，又不能暴露 rowid，唯一诚实的路径是让持久存储在提交事务内分配一个显式全局序。故 `LEDGER_SCHEMA_VERSION` 3→4。
7. **feed 能否直接从 state 修订真相投影，而非双写第二张语义真值表？** 能。选定 Option B（§3）：新增的只是一张**定序/索引元数据**表，只含 `(change_seq, namespace, key, revision)` 与指向修订行的外键，**不含任何 payload 副本**；读取时 JOIN 回 `ordarium_state_revisions` 取唯一真值。
8. **最小公开接口变更？** 新增 `StateChangeFeed` 接口（单方法 `changes`）+ `StateChangeFilter`/`StateChangePage`；`LedgerCapabilities` 增一个**可选**布尔 `stateChangeFeed?`；新增 `supportsStateChangeFeed` 类型守卫；`OrdariumStateStore` 增一个委托方法 `changes`；新增一个错误码 `INVALID_CURSOR`。`OperationLedger` 本体**不增任何必需方法**。
9. **`OperationLedger` 是否必须变大，还是加法能力/接口？** 加法接口。`changes` 不进入 `OperationLedger`，既有实现无需改动即可继续满足 `OperationLedger`；feed 是 `OperationLedger & StateChangeFeed` 的交集能力。
10. **`HOST_CONTRACT_VERSION` 是否需要变更？** 不需要，保持 `1`。该常量只覆盖 HostInvocationPort 形状/语义、宿主可见错误族承诺、宿主侧构造默认值；本次不触及 host 调用握手（§26 冻结见 spec §8）。
11. **既有第三方/自定义 ledger 是否保持源兼容？** 是。`OperationLedger` 无新增必需成员；`LedgerCapabilities` 新增字段是**可选**的（`?`），既有实现的对象字面量无需补字段即可编译。声明 `stateChangeFeed: true` 的实现才会被 `supportsStateChangeFeed` 接受。
12. **v3 历史修订的迁移语义？** v3 从未记录过真实全局提交序，迁移**不得**假装恢复它。v3→v4 为历史行分配**确定的迁移序**（`ORDER BY namespace, key, revision` 的合成位置），并明确标注"非原始提交序"。迁移后：**所有新提交都带真实持久库序**——这是本批要兑现的保证。

## 3. 选型比较（docs 提示的 Option A/B/C）

| 选项 | 形状 | 评估 |
|---|---|---|
| A：修订行上显式序列列 | 给 `ordarium_state_revisions` 加 `change_seq` | 需要给既有 STRICT 表加 NOT NULL 列并回填，SQLite 需整表重建；非 PK 列没有 DB 原生自增，仍需一张计数器表才够诚实。改动面更大、迁移风险更高。否决。 |
| B：最小定序表（选定） | `ordarium_state_changes(change_seq INTEGER PRIMARY KEY AUTOINCREMENT, namespace, key, revision, UNIQUE(namespace,key,revision), FK→ordarium_state_revisions)` | 纯增表；DB 在提交事务内分配单调序；`sqlite_sequence` 随事务回滚（失败 CAS 不产生位置）；外键保证一对一；无 payload 副本；读取 JOIN 回唯一真值。满足 docs §10 Option B 四条件。**选定。** |
| C：复用既有更强全局原语 | —— | 不存在这样的原语（§2.1/2.2）。否决。 |

选 B 的理由：它是"最小正确"——DDL 纯增、回滚安全、自增由存储引擎保证（非 `Date.now()`/进程内计数器/UUID 排序/字典序）、且把序写成**提交修订的序元数据**而非读取时合成（符合 §55）。

## 4. 冻结不变量

- **SCF-INV-1 提交可见**：`StateRevisionCommitted ⇔ 最终可经 feed 观测`。定序行与修订行在**同一 SQLite 事务**内写入。
- **SCF-INV-2 失败 CAS 无幽灵**：`FailedStateCAS ⇒ NoFeedChange`。CAS 冲突在插入前返回；AUTOINCREMENT 的 `sqlite_sequence` 亦随回滚复原，不消耗位置。
- **SCF-INV-3 持久 resume**：cursor 在进程/数据库 reopen 后仍有效（序存于库，不依赖进程内状态）。
- **SCF-INV-4 无缺口遍历**：从有效 cursor 顺序翻页不会静默跳过匹配的已提交修订。
- **SCF-INV-5 单一真值**：feed 不是第二语义状态存储；定序表只有坐标，无 payload。
- **SCF-INV-6 host 中立**：core/ledger 面不含任何 agent/应用协作语义。
- **SCF-INV-7 协调边界**：正确性跨独立本地 SQLite 客户端成立，不只在一个 JS 对象内。

## 5. 交付语义

冻结为 `AtLeastOnceObservation + DurableCursor + IdempotentConsumerPossible`：不承诺分布式 exactly-once；消费者可读页→处理部分→崩溃→重读；正确持久化的 cursor 不会静默跳过已提交修订。

## 6. 明确非目标（本批不实现）

`ack(change)`、consumer offsets、durable subscription registry、delivery leases、mailbox、阻塞等待/long polling/条件变量/IPC 通知/WebSocket/SSE、网络传输/分布式共识/CRDT、Palimpsest 适配面（`collab_*`、`CollabEvent`、`BoundaryContract`、peer discovery、wake policy 等）。消费者游标归属（"消费者 A 在 X"）留在宿主侧。

## 7. 后续

选型细节（cursor 语义、过滤语义、错误模型、迁移序、能力面）冻结于 [`ORD-BOOT-0-state-change-feed-spec.md`](ORD-BOOT-0-state-change-feed-spec.md)。验收与实现证据见 [`ORD-BOOT-0-delivery-report.md`](ORD-BOOT-0-delivery-report.md) 与 `evidence/ORD-BOOT-0/`。
