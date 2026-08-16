# Delta ARCH-001：宿主中立的多 agent harness 基石

- 变更分类（docs/17 §7.2）：**D 边界变化**（产品定位与包布局修订；经架构审议与所有者批准后执行）
- 影响面：public API（阶段二新增 HostInvocationPort）/ 包布局不变量 / 宿主映射 / 文档权威（12/15/16/17）
- 日期：2026-08-16　批准：仓库所有者（计划模式审批通过）

## 目标结构与理由

Ordarium 定位从“DSH-first Safe Action SDK”提升为“多 agent harness 的公共基石”。结构链重排为四层：

```text
L3 作者表面   @ordarium/dsh 根 façade + /advanced；各宿主适配包自己的安装入口
L2 宿主适配   @ordarium/dsh（DSH 首宿主）；@ordarium/host-mcp（MCP 第二宿主，发布门）；未来其他
L1 持久化     @ordarium/ledger-sqlite（默认 durable）；MemoryLedger；custom（LedgerCapabilities 准入）
L0 语义内核   @ordarium/core：HostInvocationPort / ActionPort / OperationLedgerPort+Capabilities / OperationsPort
横切         @ordarium/testing：crash 注入、Provider conformance、宿主适配 conformance harness
```

配套决定：

1. **HostInvocationPort 冻结为 core 一等端口**（当前是 dsh 适配器内的事实形状）；managed 副作用缺宿主 identity → `IDENTITY_REQUIRED`。
2. **多 agent identity 合同**：`source/scope/callId` 传播、`rootCallId/lineage` 只作关联不作去重、transport 丢 callId 必须显式业务 key、Action 命名空间约定。
3. **显式共账拓扑**：多 agent/多进程/多宿主共享同一本地 ledger 成为受测试的一等部署形态（local-multi-process CAS/lease/fence + 命名空间隔离 + 跨 agent 审计可见性）。
4. **包布局不变量修订**：内核运行时四包不变；宿主适配器以独立叶包加入 workspace（首个为 `@ordarium/host-mcp`），依赖只允许 core(+ledger-sqlite)；外部宿主协议 SDK（如 MCP SDK）只允许出现在宿主叶包。
5. **真实第二宿主进入发布关键路径**（G5）：host-mcp + 宿主 conformance harness 双重证明中立性。若 MCP SDK 实现时不稳定，回退为 headless CLI 宿主，本变更的合同不变。
6. **非目标保持**：无调度器、无编排引擎、无 daemon、无远程权威。多 agent 协作安全通过 identity 与共账合同提供，不通过 Ordarium 调度实现。

理由：轻量化与开发者易用性不靠缩小合同，而靠把复杂度压进默认安全路径；基石角色靠结构（端口一等、依赖方向、双宿主证明）而非功能面变宽实现。

## 旧调用/旧数据的转换位置

无 durable 数据迁移。public API 变化（HostInvocationPort、IDENTITY_REQUIRED）按首发前 clean break 政策直接切换，仓库内调用者一次性更新（阶段二）。

## 旧路径删除时点

- “第二宿主 = 发布后扩展”的旧目标排序：本变更集内从 docs/15 §18、docs/16、docs/17 G8 移除；
- “首发只有四个包”的旧表述：本变更集内改为“四个内核运行时包 + 宿主适配叶包”；
- dsh 适配器内的事实 host 形状：阶段二被 core 的 HostInvocationPort 替代后，dsh 适配器只做映射，不再拥有合同。

## 证明旧路径不再产生状态的测试

阶段二交付：HostAdapterHarness conformance（testing）+ HostInvocationPort 进入 API snapshot + IDENTITY_REQUIRED 负面测试。共账拓扑与 host-mcp 的验收 fixture 分属 G2/G5，届时以 Goal 验收 ID 落地。

## 需要同步更新的文档

docs/12（PRODUCT-3）、docs/15（ARCH-3）、docs/16（ATLAS-3）、docs/17（GOALS-3）、根 README、ordarium/README、evidence/G0/target-contract-decisions.md（增补第 11 节）。

## 快照变化

阶段一（本变更集）：**代码零变化**；唯一预期漂移为 `snapshots/contracts.json` 的 `goalRevision` 字段由 `ORDARIUM-GOALS-2` 更新为 `ORDARIUM-GOALS-3`（tools/verify-architecture.mjs 常量同步）。阶段二：`snapshots/api/core.d.ts`、`testing.d.ts` 与 `contracts.json`（errorCodes 增加 `IDENTITY_REQUIRED`）按 delta G1-001 更新。
