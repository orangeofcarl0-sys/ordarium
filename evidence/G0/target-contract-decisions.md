# G0 目标合同决策单（target record / lease / surface freeze）

> 依据：`ORDARIUM-GOALS-2`（docs/17 §8.2.5–8.2.7、§8.3 G0-A06）
> 性质：本文件按引用合并 docs/12/13/17 已写明的设计决策，形成 G1/G2 实现前唯一 target 清单；不产生新权威，与 12–17 冲突时以后者为准。实现切换时点由 docs/17 §5.3 atomic slice 规则约束：本单冻结形状，G1 先收敛当前 codec 与 API，G2 才切 schema。

## 1. `@ordarium/dsh` 目标 export map（G1 切换，登记 `COMPAT-API-002`）

- 根入口 `@ordarium/dsh` 只保留：`defineAction`、`effects`、`schema`、`defineSchema`、`installOrdarium` 及作者必需类型（`Action`、`ActionDefinition`、`ActionSchema`、`EffectProfile`、`JsonValue`/`JsonObject`、`InvocationIdentity`、`AuthorizationDecision` 及 install 选项类型）。精确清单以 G1 的 API snapshot 为准。
- `/advanced` subpath 独占：`createDshOrdarium`、`asDshTool`、`registerActions`、per-action binding 类型（`DshActionOptions` 等）、custom ledger 注入、lifecycle tuning、Operations binding（G4 后）。
- 根入口不得重导出 Runtime、Ledger、raw record、migration；README golden path 与 tarball declarations 必须一致。
- 依据：docs/17 §3 不变量 8、§9.2.10、§9.4 G1-A08；docs/12 包布局。

## 2. EffectProfile 判别 union（G1，破坏性）

- 目标形状：`kind: "read-only" | "guarded" | "unmanaged"` 三种无参分支 + `"idempotent"`（必带 `window: { kind: "durable" } | { kind: "finite"; expiresAfterMs: number }`）+ `"reconcilable"`（可选 `idempotencyWindow`、`cancellable`）。
- 当前冗余布尔字段（`hasExternalSideEffect`、`requiresAuthorization`、`idempotency`）删除，由 `kind` 推导。
- `effects.idempotent()` 默认 durable window；finite 必须显式声明。
- 依据：docs/14 §3.A、docs/17 §9.2.4、docs/13。

## 3. 分类 authorization evidence（G1）

- `AuthorizationRecord` 增加 `kind: "host-admission" | "policy-decision" | "human-approval"`；kind 只接受受信 Host Adapter 注入，普通 input 伪造无效。
- 同 operation 首个 durable authorization 决定不可覆盖；后续矛盾证据返回 `AUTHORIZATION_CONFLICT`（新错误码），Provider 不被调用。
- `requiresAuthorization=false` 的 profile 的隐式 allow 合法，归类 `host-admission`、`source: "implicit:<kind>"`。
- DSH 的 tool-body admission 是 `host-admission`，不得伪装 human approval。
- 依据：docs/17 §9.2.2、§9.4 G1-A02、§13.2；docs/13。

## 4. Provider principal（G1）

- `ProviderPrincipalRef` 只在内存解析 credential；record 至多持久化稳定 `providerPrincipalDigest`。
- 同 operation 恢复时 principal digest 变化 → 稳定 conflict，Provider 不被调用。
- 依据：docs/17 §9.2.8、§9.4 G1-A11。

## 5. OperationRecord 目标 v2（G1 冻结形状，G2 原子切换）

新增/变更字段（其余语义保持 v1 含义）：

- `schemaVersion: 2`；
- `contractFingerprint`：Action metadata（name/version/input/output JSON Schema/effect/capability）的 deterministic digest，只用于漂移诊断，不替代 `name + version` 作者责任；
- `idempotencyExpiresAt?: string`：finite idempotency window 在 operation 首次创建时冻结的绝对时间；重启/重载/新 attempt 不得续期，过期后禁止 execute，只能 query 或保持 uncertain；
- `authorization.kind`：见 §3；
- `providerPrincipalDigest?: string`：见 §4；
- 不包含 Provider-specific payload、credential、raw stack。

存储分离（G2）：

- semantic record/history（`schemaVersion=2`、SQLite `user_version=2`、`application_id=ORDA` 不变）与高频 live lease renewal 分离：heartbeat 不增加 semantic revision、不追加 history snapshot、不改变语义排序时间；
- claim acquisition、fencingToken、resumeFrom 仍是可审计 semantic 事件；terminal CAS 必须原子验证 owner/fence；
- v1 → v2 为 ledger boundary 一次性事务 forward migration（`COMPAT-DB-001`），core 不接收 union。

依据：docs/17 §8.2.5、§9.2.3/9.2.5、§10.2/10.3；docs/13。

## 6. LedgerCapabilities port（G1 冻结合同，G2 全实现切换）

- 静态描述：`crashDurability: "volatile" | "durable"`、`semanticCas: boolean`、`liveLease: boolean`、`history: boolean`、`coordination: "single-isolate" | "single-process" | "local-multi-process"`。
- MemoryLedger 如实声明 volatile/single-isolate；SqliteLedger 声明 durable/local-multi-process；custom ledger 必须如实声明。
- managed write 在 create/dispatch 前由 core gate 检查能力覆盖 profile + 部署拓扑；不足或 durable open 失败 → `LEDGER_CAPABILITY_REQUIRED`（新错误码），不调用 Provider、不 fallback 到 MemoryLedger。禁止以实现类名/`instanceof` 推断。
- 依据：docs/17 §9.2.9、§10.2/10.3、§3 不变量 9；docs/13。

## 7. 分页（G2 冻结，G4 只消费）

- `list/history` 使用不透明 cursor（编码排序键与版本），统一 MemoryLedger 与 SQLiteLedger 语义；数据集稳定时无遗漏/重复，并发变化采用明确 live-cursor 语义。当前两实现默认 limit 不一致的现状在 G2 消除。
- 依据：docs/14 §3.B、docs/17 §10.3。

## 8. Public error family 增补（G1）

- 新增：`IDENTITY_REQUIRED`（managed side-effect direct run 无显式 identity，fail closed，不再随机生成）、`AUTHORIZATION_CONFLICT`、`LEDGER_CAPABILITY_REQUIRED`；
- 预告（G2/G3 冻结语义）：`RUNTIME_QUIESCING`、infrastructure family（busy/full/corrupt/newer-schema/migration-failed/open-failed 的稳定映射，不解析 raw SQLite message 重试）。
- 依据：docs/17 §9.2.1/9.2.6、§10.3；docs/14 §3.A。

## 9. Node 支持政策（G2 验证，G7 固化）

- `@ordarium/ledger-sqlite` 与 `@ordarium/dsh` durable-default 路径 engines 目标 `>=24.15.0`（`node:sqlite` RC）；
- core/testing 最低 Node 独立测定，不被 SQLite binding 抬高；当前基线在 Node 24.14.1 上可运行但会显示 experimental warning。
- 依据：docs/17 §10.3、§15.2；docs/14 §3.A。

## 10. 未决项

无。上列九项即 G1/G2 前必须冻结的全部结构决策；资源上限具体数值（identity/lineage/reason 等）属 G1 交付物而非 G0 未决项（docs/17 §9.3）。

## 11. `ORDARIUM-GOALS-3` 增补：宿主中立基石（delta-ARCH-001）

以下决策由 `delta-ARCH-001-host-neutral-cornerstone.md`（D 级，2026-08-16 批准）追加，与上文同等效力：

1. **HostInvocationPort 目标形状**：core 独立导出接口，字段为稳定 `InvocationIdentity`（必填）、可选分类 `AuthorizationDecision`、`AbortSignal`、invocation metadata；managed 副作用缺宿主 identity → `IDENTITY_REQUIRED`；DSH/MCP/模拟宿主只消费不定义。G1 冻结并进入 API snapshot（G1-A12）。
2. **多 agent identity 合同**：`source` 宿主隔离、`scope` agent/session、`callId` 单次调用；`rootCallId/lineage` 只作关联不作去重；transport 丢 callId 必须显式业务 key；共账 Action 用命名空间名称。合同文本与长度上限随 G1 冻结（docs/15 §14.1）。
3. **显式共账拓扑**：多 agent/进程/宿主共享同一本地 ledger 为受测试一等部署形态；协调靠 local-multi-process CAS/lease/fence；跨 agent 可见性走 Operations 双视图；同属一个 OS-user trust domain（docs/15 §14.2；G2-A12/G4-A11/G5-A13）。
4. **包布局修订**：内核四包不变；宿主适配叶包（首个 `@ordarium/host-mcp`，G5 交付）只允许依赖 core 与默认 ledger；宿主协议 SDK 只允许出现在叶包（docs/17 §3 不变量 1 修订版）。
5. **真实第二宿主进入发布门**：G5 交付 host-mcp + 真实 MCP 客户端 fixture + 双宿主共账 e2e（G5-A12/A13/A14）；MCP SDK 不稳时回退 headless CLI 宿主，合同不变。
