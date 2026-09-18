# @ordarium/testing

Ordarium 的 fault injection 与 conformance 工具包。

主要入口包括：

```text
FaultInjector
ManualClock
fixedIdentity

HostAdapterHarness
runHostAdapterConformance

Provider conformance helpers
State / Ledger conformance helpers
```

适合 deterministic 验证：

```text
replay
crash
concurrency
lease expiry
recovery
```

例如：

```ts
const faults = new FaultInjector()
  .crashAt("after-dispatch");
```

见 [09 · Testing](../../docs/dev/09-testing.md)。
