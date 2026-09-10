# Delta ORDBOOT0-001：修订型 state 变更订阅原语（StateChangeFeed）

- **变更分类（docs/17 §7.2）**：**B 加法合同变化**——新增可选读取面（`StateChangeFeed.changes`）、可选能力位（`LedgerCapabilities.stateChangeFeed?`）、新错误码（`INVALID_CURSOR`）与一个新包版本（1.3.0）。既有 operation/state 语义、既有 cursor 语义、既有错误码含义与既有调用面零改动。SQLite schema 为**纯增表前向迁移**（v3→v4），旧库打开即迁移、失败回滚保 v3 完整。
- **影响面**：public API（core 增接口/守卫/StateStore 方法/错误码；ledger-sqlite 实现 `changes` 与 v4 schema）+ 文档 + 测试。record schema（`StateRecord`/`OperationRecord`）不变。
- **目标结构与理由**：为"跨主体、按持久提交序增量观测已提交 state 修订"提供宿主中立原语。既有 `stateHistory`（单主体）、`listStates`（现值视图）与 `written_at`/隐式 `rowid` 都不能给出可持久、可复现、restart-stable 的全局提交序。选型见 `docs/research/ORD-BOOT-0-state-change-feed-assessment.md` §3（Option B：最小定序表 + 外键 + 零 payload 副本 + 读取 JOIN 回唯一真值）。
- **旧调用/旧数据的转换位置（一次性 canonical 转换发生在哪个边界）**：仅在 `SqliteLedger` 打开边界。`user_version=3` 的事务内创建 `ordarium_state_changes` 并按 `(namespace, key, revision)` 升序回填合成位置；v1/v2 迁移路径经同一 `createStateTables` 直接落到 v4。core 不接收 v3 库。
- **旧路径删除时点**：无删除。既有 cursor（`LEDGER_CORRUPT` 失败语义）与既有方法保持原样，仅供新 feed 使用 `INVALID_CURSOR`。
- **证明旧路径不再产生状态的测试**：`packages/ledger-sqlite/test/g2.test.ts`（v1→v4）、`state.test.ts`（v2→v4、v4 DDL）、`state-changes.test.ts` SCF-A09（真实 v3→v4、真实历史行保留、回滚保 v3）。既有 33 文件 / 179 测试在迁移到 v4 后全绿。
- **需要同步更新的文档（12–17）与 Mermaid**：`docs/13` §11（state kind 增增量观测面与 v4）、`docs/15` §28（时间线图注：v3/v4 纯增表）、`docs/17` §16.11（ORD-BOOT-0 登记 + SCF-INV）、`docs/dev/04-errors.md`（`INVALID_CURSOR`）、`docs/14` §5（消费面现状引用，如涉及）。新增 `docs/research/ORD-BOOT-0-*`。
- **快照变化**：`snapshots/api/core/{errors,index,ledger,state,types}.d.ts`（新错误类、新接口、MemoryLedger 能力与 `changes`）、`snapshots/api/ledger-sqlite/index.d.ts`（`SqliteLedger implements StateChangeFeed`）、`snapshots/contracts.json`（六包版本 1.2.0→1.3.0；`errorCodes` 增 `INVALID_CURSOR`）、`snapshots/sqlite-v4.json`（取代 `sqlite-v3.json`：user_version 4、新表 `ordarium_state_changes`、新索引 `ordarium_state_changes_ns_idx`、`stateChanges: []` 基线）。无其他漂移。
- **HOST_CONTRACT_VERSION**：保持 `1`（HostInvocationPort 形状/语义未变；本次不入 host 调用握手）。
