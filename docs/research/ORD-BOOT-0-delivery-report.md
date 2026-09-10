# ORD-BOOT-0 交付报告：修订型 state 变更订阅

> 交付日期 2026-09-11；目标 revision = workspace 1.3.0（基线 1.2.0 / HEAD `6fb9e95`）。规范见 [`ORD-BOOT-0-state-change-feed-spec.md`](ORD-BOOT-0-state-change-feed-spec.md)，审计见 [`assessment`](ORD-BOOT-0-state-change-feed-assessment.md)，机器证据见 `evidence/ORD-BOOT-0/`。

## 1. 逐题回答

1. **state 观测的确切缺口是什么？** 没有"给我 durable position X 之后跨主体提交的 state 修订"的读取面。既有四个读取面（`getState`/`stateHistory`/`listStates`/`listStatesReferencing`）都无法增量观测全局提交流。
2. **为什么 `stateHistory` 解决不了？** 它只读**单个** `(namespace,key)` 的链；跨主体观测需要对每个主体各poll一次，主体集合本身还要另行枚举。
3. **为什么 `listStates` 解决不了？** 它是**现值投影**（每主体仅最新修订），丢弃历史提交，且按 `(namespace,key)` 而非提交序排列。
4. **选定的持久定序机制？** 新增定序元数据表 `ordarium_state_changes`，主键 `change_seq INTEGER PRIMARY KEY AUTOINCREMENT`；序由 SQLite 在 state CAS 的**同一事务**内分配（`sqlite_sequence` 随回滚复原）。
5. **`written_at` 与隐式 rowid 为何不足/足够？** `written_at` 不足：多写者独立时钟、等时戳、mock 时钟、非单调墙钟使 `writtenAt_i < writtenAt_j ⇏ commit_i < commit_j`。隐式 rowid 不足：当前表无显式 `INTEGER PRIMARY KEY`，`VACUUM`/表重建可重排。显式 `AUTOINCREMENT` 序列足够：单调、不复用、事务内分配、随库持久。
6. **是一个 state 真值还是两个？** **一个**。`ordarium_state_revisions` 仍是唯一语义真值；`ordarium_state_changes` 只含 `(change_seq, namespace, key, revision)` 与外键，**零 payload 副本**，读取 JOIN 回真值。
7. **发生了什么 schema 变化？** `user_version` 3→4；新增 `ordarium_state_changes` 表与索引 `ordarium_state_changes_ns_idx`。纯增表，未改既有表/列。
8. **v3 历史行迁移后如何排序？** 按确定迁移序 `ORDER BY namespace ASC, key ASC, revision ASC` 用 `ROW_NUMBER()` 赋合成位置。这是**确定的迁移序，明确不是恢复出来的原始提交序**（v3 从未记录它）。回填后断言计数守恒，不等即回滚。
9. **cursor 究竟是什么意思？** 不透明 base64url(JSON `{"c":"<位置>"}`)；语义 = "返回位置 > C 的匹配修订"。全局（与 filter 无关）、缺省为起点 0。
10. **是否跨 reopen 存活？** 是。序存于数据库；SCF-A04 在同一路径关闭/重开后从旧 cursor 续读，无重放、无丢失。
11. **caught-up 语义？** 返回 `{changes: [], cursor: <输入位置>, hasMore: false}`——空页但**保留** resume 位点；之后新提交的修订经同一 cursor 可观测（SCF-A03）。
12. **分页语义？** 升序、有界 `limit`（非负 safe integer，缺省 100）、`LIMIT bound+1` 探测 `hasMore`；limit=1 全量遍历无缺口无重复且与更大页一致（SCF-A02）。
13. **过滤语义？** 仅 `namespace`；只收窄返回集合，不改变全局位置空间；cursor 可跨 filter 复用（approach A，SCF-A07 显式断言）。
14. **CAS 冲突时发生什么？** 失败 CAS 在插入定序行之前返回（或在事务内回滚，`sqlite_sequence` 复原）——feed 中恰无该项（SCF-A06：A 成功 B 失败，仅一条 `alpha/one@2`）。
15. **畸形 cursor 时发生什么？** `INVALID_CURSOR` fail closed，绝不"从零开始"；覆盖非法编码、形状、类型、负数/非整数（SCF-A08）。
16. **能力/接口变了什么？** 新增 `StateChangeFeed`（`changes`）、`StateChangeFilter`/`StateChangePage`、`supportsStateChangeFeed`、`OrdariumStateStore.changes`、可选 `LedgerCapabilities.stateChangeFeed?`、错误码 `INVALID_CURSOR`。`OperationLedger` 无必需新成员。
17. **`HOST_CONTRACT_VERSION` 变了吗？为什么？** **没有，保持 `1`**。它只覆盖 HostInvocationPort 形状/语义、宿主可见错误族承诺、宿主侧构造默认值；本次是 core/ledger 观测能力，不入宿主调用握手。
18. **旧自定义 ledger 是否源兼容？** 是。无新增必需方法；能力位可选（缺失即不支持，`StateStore.changes` 报 `LEDGER_CAPABILITY_REQUIRED`）。既有 33 文件 / 179 测试在改动后全绿。
19. **refs/identity/state 语义是否未变？** 未变。feed 返回既有 `StateRecord` 真值；refs 存在性校验、`identity` 溯源、`valueDigest` decode 不变量一字未改（core 与 conformance kit 断言）。
20. **两个独立 SQLite handle 是否通过？** 通过。SCF-A05（同路径两 `SqliteLedger` 实例）+ 进程变体（两个真实 node 进程并发写入，reader 两项全见）。
21. **v3→当前迁移是否通过？** 通过。SCF-A09 用真实 v3 DDL + 真实修订/引用构造旧库，迁移后 user_version=4、记录/refs/digest/history/list 语义保留、回填序确定、迁移后新提交续序；SCF-A09 rollback 证明失败时保持 v3 完整。v1→v4（`g2.test.ts`）与 v2→v4（`state.test.ts`）同绿。
22. **最终测试计数？** **35 文件 / 197 测试**（基线 33/179；新增 core `state-changes.test.ts` 5 项、ledger-sqlite `state-changes.test.ts` 13 项）。`test:integration` 12 文件/67 测试、`test:conformance` 5 文件/21 测试全绿。
23. **架构/文档/矩阵/包门？** 全部通过：`verify:architecture`（快照随 Delta Sheet 更新）、`verify:docs`（33 文档）、`test:package`（六 tarball 1.3.0）、`verify:release`（六门）、`verify:matrix`（Docker 双腿 `node:24.15.0-slim` / `node:24-bookworm`，各 35 文件/197 测试 + 架构门全绿）。详见 `evidence/ORD-BOOT-0/exit-report.md` §4/§6。
24. **是否适合完全无关的宿主？** 是。API 只用通用 `(namespace, key)` 与不透明 cursor 表达；全部验收用中性 subject（`alpha/one`、`beta/two`、`gamma/three`），不依赖任何 Palimpsest 概念。若必须用宿主概念才能解释即为设计失败——本批不成立。
25. **明确 defer 到 Palimpsest 实验的是什么？** `ack(change)`、consumer offsets、durable subscription registry、delivery leases、mailbox、阻塞等待/long polling/IPC 通知/WebSocket/SSE、网络传输/分布式共识/CRDT、以及一切 `collab_*`/`CollabEvent`/`BoundaryContract`/peer discovery/wake policy 适配面。消费者游标归属（"消费者 A 在 X"）留在宿主 state。

## 2. 发布面（docs/18 §1 五类清单）

| 类别 | 变化 |
|---|---|
| ① 默认值变化 | 无 |
| ② 存储迁移 | **有**：SQLite schema v3→v4（打开即事务迁移；仅新增 `ordarium_state_changes` 定序表 + 确定迁移序回填；失败回滚保 v3 完整；v1/v2 旧路径落到 v4） |
| ③ 错误分类变化 | 无（既有错误码归属不变） |
| ④ 新错误码 | **有**：`INVALID_CURSOR`（仅新 feed 面；既有 cursor 失败语义不变） |
| ⑤ 弃用面 | 无 |

版本：1.2.0→**1.3.0**（minor 加法合同）。`HOST_CONTRACT_VERSION` 不变。

## 3. 最终命令与环境

见 `evidence/ORD-BOOT-0/exit-report.md` §4（含输出摘要）。发布锚为 git tag + 同名 GitHub Release（六 tarball），按本报告 §2 五类清单发 notes——**本环境不执行 tag/push，publication 外部化**（§50：留 exact release-ready commit）。
