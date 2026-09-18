# 09 · Testing

`@ordarium/testing` 用来验证那些 happy-path unit test 最容易漏掉的故障边界。

## Fault injection

```ts
import { FaultInjector } from "@ordarium/testing";

const faults = new FaultInjector()
  .crashAt("after-dispatch");

const runtime = new OrdariumRuntime({
  ledger,
  hooks: faults,
});
```

Runtime checkpoints：

```text
after-claim
after-dispatch
after-reconcile
```

它们适合验证：

```text
进程在某一步消失以后
durable Operation 到底停在哪里
下次恢复允许做什么
```

## ManualClock

```ts
import { ManualClock } from "@ordarium/testing";

const clock = new ManualClock();
clock.advance(30_000);
```

用于稳定测试：

- lease expiry；
- finite idempotency window；
- recovery timing；
- authorization/state timestamp。

## Fixed identity

```ts
import { fixedIdentity } from "@ordarium/testing";

const identity = fixedIdentity({
  scope: "case-42",
  callId: "invoke-1",
});
```

Replay test 只有在 identity 真正稳定时才有意义。

## HostAdapterHarness

`HostAdapterHarness` 是 `HostInvocationPort` 上的 deterministic host stand-in。

可以传递：

- identity；
- authorization；
- provider principal；
- lineage；
- AbortSignal。

适合在不启动完整 LLM/宿主进程的情况下测试 adapter。

## Conformance suites

`@ordarium/testing` 提供：

- Provider conformance；
- Ledger / State conformance；
- Host adapter conformance。

`@ordarium/host-kit` 再导出正常的 host conformance 入口。

**TypeScript interface 能编译 ≠ 行为具备同等 guarantee。**

自定义 ledger/host/provider 必须用行为测试证明。

## Managed Action 最小测试矩阵

至少覆盖：

1. happy path；
2. 同 identity + 同 input replay；
3. 同 identity + 不同 input conflict；
4. authorization allow / deny / conflict；
5. 多 worker 并发；
6. crash after claim；
7. crash after dispatch；
8. cancellation；
9. input/result/receipt size limit；
10. Provider principal mismatch（适用时）；
11. profile-specific recovery。

### Guarded

证明：

```text
dispatch 后不确定
→ uncertain
→ 不 blind retry
```

### Idempotent

证明：

- 重做时仍使用同一个 Provider key；
- finite window 过期后不 redispatch。

### Reconcilable

覆盖：

```text
succeeded
failed
absent retrySafe=true
absent retrySafe=false
pending
unknown
```

并证明：

```text
reconcileOnly
→ execute spy 始终为 0
```

## Repository gates

```text
pnpm check
pnpm test:integration
pnpm test:conformance
pnpm test:package
pnpm verify:architecture
pnpm verify:docs
pnpm verify:release
pnpm verify:matrix
```
