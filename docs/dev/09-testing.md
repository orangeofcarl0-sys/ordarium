# 09 · 测试你的 Action 与适配器

`@ordarium/testing` 提供确定性夹具：无网络、无真实凭据、手动时钟。

## HostAdapterHarness：不写宿主就能测全合同

```ts
import { HostAdapterHarness } from "@ordarium/testing";

const harness = new HostAdapterHarness(runtime);   // 任意 OrdariumRuntime

// 同 callId 重放 → 汇合为一个 operation、单次执行
await harness.invoke(action, { sku: "a" }, { callId: "c1", authorization: allow });
await harness.invoke(action, { sku: "a" }, { callId: "c1", authorization: allow });

// 兄弟调用（同 rootCallId）→ 两个 operation
await harness.invoke(action, { sku: "a" }, { callId: "A1", rootCallId: "R", authorization: allow });
```

选项：`callId`/`rootCallId`/`actor`/`lineage`/`authorization`/`providerPrincipalRef`/`signal`——正是宿主要注入的全部。

## 崩溃注入与时钟

```ts
import { FaultInjector, ManualClock, fixedIdentity } from "@ordarium/testing";

const clock = new ManualClock("2026-01-01T00:00:00.000Z");
const runtime = new OrdariumRuntime({
  clock: clock.now,
  hooks: new FaultInjector().crashAt("after-dispatch"),  // 三个检查点之一
});
// ...触发调用 → SimulatedProcessCrash；记录诚实停在 dispatched/uncertain
clock.advance(60_000);  // 推进时间测租约到期/接管
```

检查点：`after-claim`（dispatch 前）、`after-dispatch`（Provider 前）、`after-reconcile`（查询后）。

测试托管行为时的两个实用项：`allowVolatileLedger: true`（MemoryLedger 上跑 managed 写）；`fixedIdentity()`（稳定身份）。

## Provider conformance

把你对 Provider 的**能力声明**变成可重复验证的证据：

```ts
import {
  ProviderFixture,
  assertEffectSupportedByDeclaration,
  providerBackedAction,
  providerDeclarations,
} from "@ordarium/testing";

const fixture = new ProviderFixture({ declaration: providerDeclarations.durableIdempotent() });
assertEffectSupportedByDeclaration(effects.idempotent(), fixture.declaration); // 配对即拒

const action = providerBackedAction(fixture, {
  name: "conf.reserve",
  effect: effects.idempotent(),
  keyOf: (input) => `sku:${(input as { sku: string }).sku}`,
});

fixture.loseResponseOnce();      // 效果已提交但响应丢失 → 恢复后业务效果仍恰为 1
await harness.invoke(action, { sku: "a" }, { callId: "c1", authorization: allow });
// fixture.calls / fixture.effectCount() 是你的断言基础
```

七个声明预设覆盖 conformance 矩阵：`opaque` / `durableIdempotent` / `finiteIdempotent` / `reconcilable` / `falseAbsence`（最终一致假 absent）/ `cancellable` / `fenced`。可切换故障：`loseResponseOnce()`、`eventualAbsenceOnce()`、`pendingOnce()`。

**断言业务效果计数而不是状态名**——`fixture.effectCount()` 才是"没有重复副作用"的直接证据。

## 官方套件参考

`pnpm test:conformance` 运行的 A01–A12 矩阵（同 key 复用、键冲突、响应丢失恢复、finite 边界、pending 收敛、假 absent、权威 absent 双模式、取消后查询、stale fence、换 principal、非法配对、deadline 不续期）就是你的测试可以照抄的模式库。
