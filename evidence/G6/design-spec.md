# G6 Design Spec：Provider capability 与 conformance（冻结）

> 依据：`ORDARIUM-GOALS-3`（docs/17 §14）、docs/13 §1.1/§22、docs/15 §22。
> 性质：G6 实现前的单一目标形状；锚定现状（`IdempotencyWindow` 判别 union、`idempotencyExpiresAt` 持久化、G3 evaluator 消费 deadline）。

## 0. 当前落点

已有：五种 profile 的声明模型与定义期校验；`ReconcileResult` 五态；finite deadline 持久化。缺：把"声明"变成"可重复验证的能力证据"的 conformance 套件。

## 1. 声明与指纹

```ts
// @ordarium/testing
interface ProviderCapabilityDeclaration {
  provider: string;                        // 如 "stripe-like"
  idempotency: "none" | "durable-key" | "finite-key";
  query: "none" | "by-business-key";
  authoritativeAbsence: boolean;           // absent 非 eventual 假阴性
  cancellation: "none" | "best-effort";
  fencing: boolean;                        // Provider 校验单调 token
  principalNamespacing: boolean;
}
function providerCapabilityFingerprint(declaration): string;   // 进 fixture 断言
```

- 声明与 Action `effect` 的合法性由 validator 交叉检查（声明 `none` 却用 `effects.idempotent()` → 拒绝）；
- 声明不通过 conformance → Action 降级为已证明 profile（`guarded` 或仅 reconcile），不得一律标 idempotent（A11）。

## 2. ProviderFixture（确定性被测 Provider）

```ts
interface ProviderFixture {
  declaration: ProviderCapabilityDeclaration;
  calls: { execute: number; query: number; cancel: number };
  behavior: {
    loseResponseOnce?(): void;             // A03 响应丢失
    eventualAbsence?(): void;              // A06 假 absent
    rejectStaleFence?(): void;             // A09
  };
  execute(key: string, input: unknown, fence?: number): Promise<unknown>;
  query(key: string): Promise<"absent" | "pending" | { outcome: "succeeded" | "failed"; value?: unknown }>;
  cancel(key: string): Promise<void>;
}
```

七类内置夹具：opaque（无任何原语）、durable-idempotent、finite-window、reconcilable、false-absence、cancellable、fenced；全部确定性（ManualClock + 计数器，无网络、无真实 credential）。

## 3. Conformance 断言矩阵（每个声明能力 ↔ 必测行为）

| 声明 | 必测 |
|---|---|
| durable-key | 同 key 同输入响应复用（A01）；同 key 不同输入 conflict（A02）；响应丢失重放后业务效果计数=1（A03）；重启后 key 仍指同一效果 |
| finite-key | deadline 边界前可 same-key（A04 前）；边界后 Runtime 禁止 execute（A04 后 = G3-A05 复用）；**restart/reload/new attempt 不续期**（A12：持久 `idempotencyExpiresAt` 不变） |
| query | pending→terminal 收敛（A05）；只以最终 Provider fact 写 reconciled |
| authoritativeAbsence | true：absent+retrySafe 允许 normal redispatch（A07）；false/eventual：保持 pending/uncertain，禁止 redispatch（A06） |
| cancellation | cancel accepted 后仍查询最终事实（A08：reconciled 或 uncertain，不直接 cancelled） |
| fencing | stale token 被拒（A09）；不支持时 fixture 断言"仅本地诊断"路径 |
| principalNamespacing | 换 principal 拒绝继续原 operation（A10，复用 PRINCIPAL_CONFLICT）；业务 key 需含非敏感 namespace |

## 4. 与 Runtime 的接线

- 套件以 `HostAdapterHarness` 驱动真实 Runtime + ProviderFixture（规范可在 G1 后并行编写，最终验收依赖 G3 evaluator：deadline 强制与 reconcile-only 行为）；
- 每个夹具跑双模式：normal（redispatch 允许域）与 ops reconcile-only（execute spy 恒 0）；
- recipe 层：首批 1–2 个参考 adapter（如 mail-like / issue-like）作为示例，不建通用 HTTP client，不进 core。

## 5. 交付切片建议

- G6-001：声明模型 + validator + 指纹 + 七夹具骨架；
- G6-002：断言矩阵全量接线（A01–A12）+ 双模式；
- G6-003：参考 recipe + exit report。

## 6. 验收映射

即 §3 表的 A01–A12（与 docs/17 §14.3 一一对应），全部以确定性测试执行；任一能力缺证 → 该声明被 validator 拒绝或降级（A11）。
