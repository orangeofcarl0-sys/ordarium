# Delta G6-001：Provider capability 声明与 conformance 套件

- 变更分类（docs/17 §7.2）：B 加法合同（`@ordarium/testing` 新模块导出）
- 依据：`evidence/G6/design-spec.md` §1–§4；docs/17 §14、docs/13 §22

## 目标结构与理由

1. **`packages/testing/src/provider.ts`**：
   - `ProviderCapabilityDeclaration`（provider/idempotency/query/authoritativeAbsence/cancellation/fencing/principalNamespacing）+ `providerCapabilityFingerprint`（canonical digest，同形稳定）；
   - `assertEffectSupportedByDeclaration`（A11 交叉校验）：profile 所需原语必须被声明背书——idempotent 需 operation-key、finite 窗口需 finite/durable-key、reconcilable 需 query 或 idempotency、cancellable 需 best-effort cancel；不满足即拒绝接线（降级为已证明 profile 是作者责任）；
   - `ProviderFixture`：确定性被测 Provider——execute/query/cancel 计数、按 key 的业务效果存储与输入冲突检测（`ProviderKeyConflictError`）、fence 单调与 stale 拒绝（`ProviderStaleFenceError`）、可切换故障（`loseResponseOnce`/`eventualAbsenceOnce`/`pendingOnce`）；行为严格受声明约束（声明无 query 则 query 抛错）；
   - `providerDeclarations` 七预设（opaque/durable/finite/reconcilable/falseAbsence/cancellable/fenced）；
   - `providerBackedAction`：参考适配器形状——execute 携带 `context.fencingToken`，reconcile/cancel 钩子仅按声明接线，query fact → `ReconcileResult`（absent 的 retrySafe = authoritativeAbsence）。
2. 场景驱动真实 Runtime + `HostAdapterHarness`（无 mock harness 层），A07 双模式（normal / `reconcileOnly`）断言 execute spy。

## 证明测试（`packages/testing/test/provider-conformance.test.ts`，14 项，映射 docs/17 §14.3 A01–A12）

A01 同 key 同输入单效果；A02 键冲突零第二效果（runtime `OPERATION_CONFLICT` + fixture 拒绝）；A03 响应丢失恢复后业务效果恰一；A04 边界前同 key 重发/过期后 `IDEMPOTENCY_EXPIRED` 且 execute 冻结；A05 pending→仅终态事实落 reconciled；A06 假 absent 不引发 redispatch（一致性收敛仍零额外 execute）；A07 权威 absent 仅 normal redispatch、reconcile-only spy=0；A08 cancel accepted 后以查询事实 reconciled（不落 cancelled）；A09 fence 2 接纳/fence 1 拒绝且效果单一；A10 换 principal `PRINCIPAL_CONFLICT`；A11 四类非法配对拒绝 + 指纹稳定性；A12 重启不续期（持久 deadline 字段逐次断言）；opaque 诚实 uncertain（无查询原语即拒绝盲重试）。

## 快照变化

`snapshots/api/testing/index.d.ts`（provider 导出面）；依赖图不变（testing → core）。

## 设计修正记录

场景开发中修正三处测试设计错误（非产品缺陷）：已提交效果的 absent 场景应改用 crash-after-dispatch（execute 未达）构造；eventual 一致性在真实事实到达时应收敛而非永久 uncertain；crash hooks 会在恢复期再次触发，恢复须换共享 ledger 的干净 runtime 并让 lease 过期。
