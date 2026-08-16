# Ordarium 当前实现与计划

> Implementation revision：`ORDARIUM-IMPLEMENTATION-2`  
> 状态：当前实现快照与初始缺口清单。阶段依赖、进入/退出条件、架构一致性检查和正式验收以 `17-ordarium-goals-and-acceptance.md` 为最高权威；本文第 3–4 节不再单独决定执行顺序。

## 1. 已完成基线

当前 TypeScript 工作区已经从完整 Harness 重切为四个包：

| 能力 | 实现 |
|---|---|
| 开发者 API | `defineAction()`、`schema` builder、自定义 `defineSchema()`；`EffectProfile` 已是 `kind` 判别 union（idempotent 带 durable/finite window，reconcilable 带 cancellable/idempotencyWindow，冗余布尔删除，派生助手公共化，delta-G1-004）；`@ordarium/dsh` 根入口已切换为精选 author façade（六个值导出 + 作者类型），低层 binding/lifecycle 位于 `/advanced` subpath（delta-G1-002） |
| Identity | canonical JSON、SHA-256 operation/input/key digest、冲突拒绝；`contractFingerprint` 持久化并在同 name+version 漂移时 `CONTRACT_DRIFT` 诊断失败（delta-G1-008） |
| Host 边界 | core 拥有的 `HostInvocation`/`HostInvocationPort`（`OrdariumRuntime.invoke`）；managed 副作用无宿主 identity 稳定返回 `IDENTITY_REQUIRED`（delta-G1-001） |
| 权威状态 | proposed → authorization → claim → dispatched → terminal/uncertain/reconciled；授权证据强制分类（`host-admission`/`policy-decision`/`human-approval`），首个 durable 决定不可覆盖，矛盾证据稳定 `AUTHORIZATION_CONFLICT`（delta-G1-003） |
| 并发 | 本地 in-flight 合并、ledger revision CAS、owner lease、执行期 heartbeat、claim-lost abort、fencing token |
| 恢复 | read-only、Provider idempotency key、reconcile-first、absent-safe-retry、拒绝盲重试；统一 recovery evaluator + **`runtime.reconcileOnly` 查询专用入口**（A11 调用方级：execute spy 恒零）+ finite deadline 强制（`IDEMPOTENCY_EXPIRED`）+ accepting→closed 生命周期（`RUNTIME_QUIESCING`/`RUNTIME_CLOSED`、有界 drain、durable handoff、dsh dispose 字面序 quiesce→unregister→drain）（G3 exit 见 `evidence/G3/exit-report.md`） |
| 持久化 | **schema v2 交付**：`semantic_revision`/lease 表分离（heartbeat 零语义写）、fence 验证 CAS、轻量续约、opaque cursor 分页（Memory=SQLite，默认 100）、事务性 v1→v2 迁移（失败回滚保 v1）、稳定 infra 错误族（`LEDGER_BUSY/CORRUPT/...`）、engines `>=24.15.0`；`ORDA`/`user_version=2`（G2 exit 见 `evidence/G2/exit-report.md`） |
| Secret 边界 | 不保存原始 input/key/异常文本；显式安全 receipt/error；默认 1 MiB output/receipt 上限 |
| Principal 边界 | 瞬态 `ProviderPrincipalRef`（内存、入口校验）；record 只存 canonical digest；同 operation 换 principal 或绑定后缺失稳定 `PRINCIPAL_CONFLICT` fail closed（delta-G1-005） |
| 运维闭环 | **`OrdariumOperations` 已交付**（core 内 `operations.ts`：inspect/list/history 只读 + reconcileOnly 查询处置；双视图同一 projector；`OperatorAuthorization` 独立权限 + `OPERATOR_AUTHORIZATION_REQUIRED`；recovery material 预验 fail closed，delta-G4-001，exit 见 `evidence/G4/exit-report.md`）；DSH 侧受权工具注册归 G5 |
| DSH | 结构兼容 ToolDefinition、call/root/session identity、AbortSignal、output renderer、注册/dispose helper；`asDshTool` 消费 `HostInvocation` 端口类型；**结构化 ContentBlock**（自定义 renderer 不受 text-only 限制）、`providerPrincipalRef` 瞬态绑定、`recoveryMaterial` 会话绑定（delta-G5-001；真实 DSH 包 fixture 携至 G7） |
| 第二宿主 | **`@ordarium/host-mcp` 已交付**：MCP stdio 协议子集服务器（零外部依赖）、identity/evidence/错误映射、ops 默认不注册（opt-in 受 OperatorAuthorization 保护）、停止走 G3 生命周期；verifier 叶包规则生效（运行时依赖仅 core+ledger-sqlite） |
| 测试 | G1–G6 全量回归与平台 fixture（25 文件 131 测试）：迁移保真/回滚、心跳零语义写、终态-接管竞争、双进程真实竞争、分页双实现一致、infra 错误族、WAL 备份/旧备份重收敛、双宿主共账、**官方 MCP SDK client 往返**、生命周期/恢复/取消/时钟矩阵、Operations A01–A11、**Provider conformance A01–A12**（声明交叉校验 + 七类 fixture + 双模式 spy 断言）；**Docker Node 矩阵**（`pnpm verify:matrix`：24.15.0 下限 + 24.19 当前线，见 `evidence/G7/node-matrix-report.md`）；各 Goal exit 见 `evidence/G<goal>/exit-report.md` |

旧实现中的 contracts/persistence/provider/agent-loop/runtime/harness/worker/runner-client/host/resource-authority 包、Rust crates 和 Worker fixtures 已删除。不是暂时禁用，而是产品职责撤销。

## 2. 当前验收命令

```powershell
Set-Location ordarium
pnpm install
pnpm check
pnpm verify:architecture
```

一次通过必须同时满足 TypeScript composite build 与全部 Vitest。SQLite 测试使用真实文件 reopen，不以 mock 代替 durability。

`pnpm verify:architecture`（G0 交付）机器校验包依赖图与禁止边、public API 快照、错误码/状态 union、SQLite schema 基线与 Compatibility Register；快照位于 `ordarium/snapshots/`，证据与决策单位于 `ordarium/evidence/`（G0 报告见 `evidence/G0/baseline-report.md`）。任何漂移必须先附 Architecture Delta Sheet，再以 `pnpm snapshots:update` 解释。

当前实现是 private baseline，不是已经兑现的发布表面。产品与合同已经在 `12/13` 收敛出的 clean-break target 包括：精选 `@ordarium/dsh` 根入口、`@ordarium/dsh/advanced` subpath、判别式 EffectProfile、分类 authorization evidence、provider principal digest、LedgerCapabilities、semantic record/live lease 分离、schema v2、quiesce/drain 与最小 Operations。它们必须按 `17` 的 G1–G5 顺序原子切换，本文不能因为列出 target 就把它们计为已实现。

## 3. 近期完善顺序

### A. 发布前合同硬化

- 增加两个独立 Node 子进程竞争同一 operation 的系统夹具（当前已有双连接、双 Runtime CAS 测试）；
- 评估可选脱敏 projector；若无法保证 replay 返回值仍满足 output schema，则不引入伪安全模式；
- 冻结 public error code、state 与 schema export surface；
- 把 `@ordarium/dsh` 根入口收敛为精选 author façade；移除对整个 core 与 `SqliteLedger` 的宽重导出，把高级 binding/lifecycle/Ops 放入同包 `/advanced` subpath；
- 将当前冗余布尔 EffectProfile clean break 为 `kind` 判别 union，并实现 durable/finite idempotency window 与一次性 deadline snapshot；
- 建立 `host-admission/policy-decision/human-approval` 分类 evidence，以及独立 OperatorAuthorization；
- 为多 Provider principal invocation 增加 transient principal ref 与持久 digest conflict；
- 为 OperationLedger 增加 capability descriptor/gate：managed write 不得在 volatile ledger 上 dispatch，也不得在 SQLite 打开失败后静默降级到内存；
- 增加 Action contract metadata digest 与版本漂移诊断；digest 只发现 schema/effect 意外变化，不替代 `name + version` 的作者责任；
- 冻结生态 Action 的命名空间约定，避免多个插件共享 ledger 时发生名称碰撞；
- 把 SQLite busy/full/corrupt/migration failure 映射为稳定 infrastructure error family；
- 加入 wall-clock 前后跳变、event-loop stall 与 heartbeat/CAS 失败夹具；
- 冻结无自动 GC、WAL 一致性 backup/restore、前向 migration 与未来 tombstone 的 ledger 生命周期策略；
- 将高频 lease heartbeat 与语义 revision history 分离，避免每次 heartbeat 追加完整 record snapshot；
- 用单一完整 codec 校验 OperationRecord 的嵌套字段、长度与跨字段状态不变量；
- 为 input/identity/lineage/authorization metadata 建立资源上限，并记录 deterministic digest 的 equality/dictionary 泄露边界；
- managed side-effect direct run 缺少显式 identity 时返回稳定 `IDENTITY_REQUIRED`，不再静默生成新 operation；检测同 operation 的矛盾 authorization evidence；
- 按已冻结政策验证 Node 内置 `node:sqlite`：SQLite/DSH durable default 最低目标 Node 24.15.0，接受 release-candidate 状态换取零 native runtime dependency；若真实矩阵失败才在 ledger 边界重审 binding，不改变 core；同时完成四包从 `private` workspace 到可发布 package 的 manifest/exports/files 策略。

### B. DSH 插件成品化

- 在 DSH 当前正式 plugin manifest/lifecycle 上做一份薄安装包，而不是 fork Cordis；
- 让 `installOrdarium(ctx, { actions })` 成为根入口唯一 README golden path；高级构造、per-action binding 与 Ops registration 只从 `/advanced` 暴露；
- 验证 root call、code-mode nested dispatch、parallel tool call 与 session restart 的真实 integration fixture；
- 把 DSH approval/policy 结果显式映射为 Ordarium authorization evidence；
- 提供 operation inspect/list/history 与 reconcile-only 工具；reconcile-only 不得因 `absent` 隐式 dispatch，也不让模型任意强制重试 `uncertain`；
- 从 DSH session invocation 或调用者重新提交中解析 recovery material，重新校验 action/version/identity/input digest；取不到原输入时只允许 inspect；
- 为模型视图与 operator 审计视图定义不同脱敏范围，并由 DSH 权限保护 Operations Port；
- 为 inspect/list/history 定义 bounded cursor pagination，消除 MemoryLedger 与 SQLiteLedger 默认 list limit 不一致；
- 用 DSH 正式公开 ContentBlock/lifecycle 类型验证 adapter；默认 text renderer 保留，但高级 renderer 不被当前 text-only 私有类型限制；
- 统一零配置 action 注册与包含 render/timeout/concurrency/actor/lineage 的 per-action binding；
- 增加 Runtime quiesce/drain：HMR dispose 必须停止新调用、abort 或有界等待 in-flight、再关闭 ledger，不能 unregister 后立即 close。

### C. Provider adapter 生态

- 定义小型 conformance suite：幂等键持续期、query consistency、business key uniqueness、cancel 语义；
- finite idempotency 必须在 operation 首次创建时持久化唯一绝对 `idempotencyExpiresAt`；deadline 前才可 same-key redispatch，过期后只能 query 或保持 uncertain，重启/重载/新 attempt 不得续期；
- `absent + retrySafe` 必须证明 absence authoritative，不能把 eventual-consistency 假阴性当作可重试证据；
- 多 tenant/provider account Action 的业务 key 必须包含非敏感 principal namespace，并验证恢复 credential 的 principal 连续性；
- 首批只做少量高价值 adapter 示例，不建立通用 HTTP client 或模型 Provider 层；
- adapter 必须公开其可证明 guarantee，不允许一律标为 idempotent。

### D. 其他宿主与 subagent

- 抽取稳定 `HostInvocationAdapter`，证明第二个类 DSH 宿主可以不改 core 接入；
- 远程 subagent 只定义 identity propagation 与 operation ownership，不实现调度系统；
- 若 transport 不能保留 call identity，则只允许显式业务 key，不能退化成随机重复操作。

## 4. 发布门

第一个可发布版本必须满足：

1. 一条 DSH 安装路径，不要求用户理解内部四包；
2. 示例 Action 在进程崩溃、SQLite reopen 和同 call replay 后不重复业务副作用；
3. opaque Provider 的未知结果稳定停在 `uncertain`；
4. 两进程竞争时只有一个 claim 能进入 dispatch，长任务不会因 lease 失效形成双执行；
5. ledger 中不存在原始 input、credential、raw stack；
6. DSH 原生 approval/guard/session/result pipeline 仍完整经过；
7. `uncertain` 可以被 inspect，并可在 Action 支持查询时执行 reconcile-only；
8. 同一 Action `name + version` 的 HMR/restart 恢复语义有 conformance 覆盖；
9. reconcile-only 能取得并验证原 invocation input；若取不到则 fail closed，且永不隐式 execute；
10. Provider durable/finite idempotency window、authoritative absence、cancel 与可选 fencing 已有 conformance 证据；
11. ledger 无自动 GC，backup/restore、schema migration 与基础设施错误语义已经冻结；
12. OperationRecord 完整 codec 能拒绝嵌套字段损坏和非法跨字段状态；
13. HMR dispose 对 in-flight Action 有 quiesce/drain 证明，`node:sqlite` 支持政策与 package publish 配置已经决定；
14. managed direct run 没有 identity 会 fail closed；矛盾 authorization evidence 不会覆盖首次持久决定；
15. heartbeat 不再无限追加完整 history snapshot；DSH renderer/binding surface 通过正式类型集成；
16. 多租户部署按数据库/OS 权限隔离，`scope` 不被描述成 ACL；
17. volatile/custom/SQLite ledger 的能力被机器验证；managed write 遇到能力不足或 durable ledger 打开失败会 fail closed，不 fallback；
18. 文档不使用无条件 exactly-once、强沙箱、tamper-evident audit 或完整 Harness 等虚假表述。

## 5. 与 Palimpsest 的关系

Palimpsest 当前保持 Phase 0–2 快照，不参与以上发布门。**已批准的复兴方向（2026-08-17 会话决议，G9 冻结重申）：Palimpsest 以 DSH 插件形态复兴、进程内消费 `@ordarium/dsh`（或 Ordarium 官方插件壳的共享实例），承担 Goal Compiler/Task DAG/Context Compiler/预算/证据等编排层；其全部外部副作用经 Ordarium Action invocation，消费 terminal/uncertain 结果。** versioned Host Adapter 缝仅在 Palimpsest 保持独立运行时（如 Python 侧）时启用。Ordarium 不读取 Palimpsest Event Store，Palimpsest 也不直接修改 Ordarium ledger；两个权威、两个存储。旧 Python Runtime 的合同与教训（canonical schema、单一 replay fixture、一次性前向 migration）在复兴插件时移植，代码不移植。
