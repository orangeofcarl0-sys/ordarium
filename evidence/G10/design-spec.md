# G10 Design Spec：面向开发者的文档（冻结）

> 依据：docs/12 §1（"面向开发者，Ordarium 必须表现为一个小表面……不需要先理解 ledger revision、lease、fencing"）、docs/12 §7 条款 9（"README golden path 不要求先阅读 12–17"）。2026-08-17 用户目标：作为 SDK 编撰详细易读的开发者文档。
> 权威边界不变：`docs/12–17` 仍是维护/审计合同；开发者文档是它们的**可读投影**，冲突时以 12–17 为准并回改文档。

## 1. 受众与阅读路径

| 受众 | 进入点 | 路径 |
|---|---|---|
| DSH 插件作者（主要） | 01 入门 | 01 → 02 概念 → 03 profile → 04 错误表（案头参考） |
| 框架/宿主作者 | 08 宿主 | 08 → 06 ledger → 02 |
| 运维/工具作者 | 07 运维面 | 07 → 04 → 02 |
| Action/adapter 测试作者 | 09 测试 | 09 → 03 |

## 2. 文档集（`docs/dev/`）

| 文件 | 内容底线 |
|---|---|
| `README.md` | 索引 + 按角色路径 |
| `01-getting-started.md` | 两种安装方式（同 workspace / Release 五 tarball）、首个 Action 完整可运行示例、golden path、一次调用内部发生什么、数据库位置 |
| `02-core-concepts.md` | 五对象（Action/Invocation/Operation/Attempt/External effect）、identity 推导、状态机图、uncertain 哲学、Secret 边界（ledger 存什么/不存什么） |
| `03-effect-profiles.md` | 五 profile 决策树 + 逐项详解（含 finite window 冻结语义）、profile↔Provider 能力配对 |
| `04-errors.md` | 全部 27 个错误码分组表：含义 + 调用者动作（来源：core/errors.ts + snapshots/contracts.json；`ACTION_EXECUTION_FAILED` 与 `SIMULATED_PROCESS_CRASH` 在表下注明） |
| `05-authorization.md` | 三类 evidence、DSH 默认准入、自定义 authorize、矛盾冲突语义、OperatorAuthorization 独立边界 |
| `06-ledgers.md` | LedgerCapabilities、SQLite 默认（路径解析）、MemoryLedger 合法用途、能力门、部署拓扑、备份注意 |
| `07-operations.md` | uncertain 可见性、createOperations、插件壳 createOrdariumPlugin + opt-in ops 工具、双视图脱敏、reconcile-only 与 recovery material |
| `08-hosts.md` | DSH 映射表/lifecycle；@ordarium/host-mcp stdio 服务器用法；自建宿主的 HostInvocationPort 合同 |
| `09-testing.md` | HostAdapterHarness、FaultInjector、ManualClock、Provider conformance 套件（七预设 + validator）、allowVolatileLedger 说明 |
| `10-lifecycle-and-recovery.md` | 五态生命周期 + dispose 顺序、崩溃检查点矩阵、恢复流程（reconcile-first/same-key/uncertain）、schema 自动迁移、Action 版本与 CONTRACT_DRIFT |

## 3. 准确性基线（硬规则）

1. 每个代码示例的模式取自**已验证的测试代码**（packages/*/test）；API 名称以 `snapshots/api/*.d.ts` 为准——不得发明不存在的导出或参数；
2. 错误码全集 = `snapshots/contracts.json` 的 `errorCodes`（27 项），逐项给"调用者动作"（对齐 docs/15 §25 风格）；
3. Node 版本陈述与 engines 一致（ledger-sqlite/dsh/host-mcp `>=24.15.0`；core/testing `>=24.0.0`）；
4. 宣称纪律与 README 相同：不出现无限定的 exactly-once/tamper-proof/强沙箱/完整 Harness 表述（否定式讨论允许）；
5. 中文行文、代码与标识符英文；每个文档 ≤ 一个核心 mermaid 图。

## 4. 验证

- `tools/verify-docs.mjs` 升级为**递归扫描** `docs/`（含 dev/）：链接解析、栅栏平衡、README 宣称审计不变；
- `pnpm check` 全绿（文档变更不得触碰代码/快照——预期零漂移）；
- 根 README 与 docs/README 增加开发者文档入口。

## 5. 非目标

- 不做 API reference 生成器（声明快照已机器化）；不做网站/文档框架；不改包 manifest（tarball 内容不动）。
