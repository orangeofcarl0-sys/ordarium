# Concept · `uncertain`

## The problem

外部系统已经可能发生副作用，但本地没有足够证据确定结果。

经典窗口：

```text
persist dispatched
→ Provider commits
→ response lost / process crash
→ no local terminal record
```

## 30-second answer

`uncertain` 的意思是：

> 当前 durable evidence 不足以证明 succeeded，也不足以证明 failed；因此 Runtime 不能安全决定下一次 side-effect action。

它不是：

```text
failed 的别名
retry later 的别名
异常处理没写完
```

## Why not just mark failed?

因为：

```text
local response missing
!=
external effect did not happen
```

把 unknown 写成 failed，会让后续 retry 看起来合理，从而可能重复产生副作用。

## Why not just retry?

是否能 retry 取决于 Provider capability：

```text
stable idempotency key?
→ maybe same-key redispatch

authoritative query?
→ reconcile first

neither?
→ stay uncertain
```

## What the Host should do

根据业务选择：

- 自动 reconcile；
- 等待 Provider 异步状态；
- operator inspection；
- human confirmation；
- 保持 blocked。

Ordarium 不替 Host 定义业务 escalation policy。

## How uncertainty gets resolved

可能通过：

```text
Provider reconcile says succeeded
Provider reconcile says failed
Provider says authoritative absent + retrySafe
```

或由更高层系统/人工获得新的可信 evidence。

## Common mistake

```ts
try {
  await run();
} catch (e) {
  if (e.code === "OPERATION_UNCERTAIN") {
    return runAgainWithNewCallId();
  }
}
```

这通常等于绕过安全边界。

## See it happen

[Failure Lab](../start/failure-lab.md)
