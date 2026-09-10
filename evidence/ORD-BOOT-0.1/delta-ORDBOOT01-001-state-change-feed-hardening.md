# Delta ORDBOOT01-001：StateChangeFeed 边界安全加固（limit 域 + 未来 cursor + 页大小上限）

- **变更分类（docs/17 §7.2）**：**B 加法定额**（`RESOURCE_LIMITS` 新增只读字段 `maxStateChangePageItems`，纯增）+ **输入域收紧（patch 级正确性/安全修复）**。**不属 C**：无 `StateRecord`/`Identity`/state 字段变化、无错误码改义（`INVALID_CURSOR` 含义"不是合法持久位置"未变，仅其触发域扩展）、无 API 形状删除、无默认值变化（默认页仍 100）。
- **影响面**：public API（仅 `RESOURCE_LIMITS` 增一字段）+ 语义（`changes` 的 `limit` 域与 cursor 语义校验）+ 内部（两 ledger 的校验函数）。schema、record codec、能力门、依赖图均不变。
- **目标结构与理由**：关闭三个边界缺陷——`limit=0` 确定性活锁；未来 cursor 静默饥饿；显式页大小无资源上限。理由与复现见 `docs/research/ORD-BOOT-0.1-state-change-feed-hardening-assessment.md`。
- **旧调用/旧数据的转换位置**：**无数据转换**。schema 保持 v4，无迁移、无新表/列。仅对 1.3.0 曾接受的两种退化/危险输入（`limit=0`、位置 > 高水位的 cursor）改为 fail closed。
- **旧路径删除时点**：无删除；普通 `changes(filter?, cursor?)` 用法与 `StateChangeFeed` 形状不变。
- **证明旧路径不再产生状态的测试**：`SCF-B01`（limit=0 拒绝）、`SCF-B05/B06/B08`（未来/还原低水位 cursor 拒绝）、`SCF-B02/B03/B04`（页大小域）、`SCF-B07/B09`（当前高水位可续读、全局校验）；conformance kit 增可移植断言。既有 SCF-A01..A10b 全绿不被削弱。
- **需要同步更新的文档（12–17）与 Mermaid**：`docs/13` §11（增量观测 bullet 追加 0.1 边界）、`docs/14` §1（State 变更订阅行追加 0.1）、`docs/17` §16.12 + 验收矩阵 State feed 行、`docs/dev/04-errors.md`（`INVALID_CURSOR` 语义 + 页大小域）。Mermaid 无变化。原 ORD-BOOT-0 spec/delivery 加**日期化后发布指针**，历史 1.3.0 语义原文保留。新增 `docs/research/ORD-BOOT-0.1-*`。
- **快照变化**：`snapshots/api/core/codec.d.ts`（`RESOURCE_LIMITS` 增 `maxStateChangePageItems`）、`snapshots/contracts.json`（六包版本 1.3.0→1.3.1）。其余 `.d.ts` 与 `snapshots/sqlite-v4.json` 预期零漂移（无 schema 变化）。
- **`HOST_CONTRACT_VERSION`**：保持 `1`（HostInvocationPort / 宿主握手 / 宿主侧构造默认值均未变）。
- **发布分类**：**patch 1.3.1**。论证见 `docs/research/ORD-BOOT-0.1-delivery-report.md` §2。
