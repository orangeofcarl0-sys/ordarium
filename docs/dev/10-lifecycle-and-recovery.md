# 10 · Lifecycle & recovery

Ordarium Runtime lifecycle 单调前进：

```text
accepting
→ quiescing
→ draining
→ closing
→ closed
```

## Quiesce

```ts
await runtime.quiesce();
```

之后的新 invocation：

```text
RUNTIME_QUIESCING
```

已经在执行的工作不会立刻被 abort。

## Dispose

```ts
await runtime.dispose({
  drainMs: 5_000,
});
```

流程：

1. quiesce；
2. 有界 drain；
3. abort 剩余工作；
4. 对仍 in-flight 的 Operation 做 durable handoff；
5. 吸收 late callback；
6. close ledger；
7. lifecycle → `closed`。

如果工作还没 dispatch，可以 durable cancel。

如果外部副作用已经**可能** dispatch，则不能假装 abort 抹掉了外部世界的变化；handoff 会保留相应 uncertainty。

## Recovery 入口

下一次相同 Operation identity 到来时，不创建“另一项工作”，而是加载原记录并进入统一 recovery evaluator。

```text
有 reconcile()？
    yes
    → query Provider

    no
    → operation key 仍可安全使用？
         yes + normal mode + window 未过期
         → same-key redispatch

         no
         → stay uncertain
```

## Reconcile outcome

### `succeeded`

保存成功证据并返回 value。

### `failed`

保存 sanitized failure evidence。

### `pending` / `unknown`

保持不确定，等待未来证据。

### `absent`

Provider 说“没有这项外部结果”也不自动意味着可以重做。

只有：

```text
retrySafe = true
```

且其他条件（例如 finite idempotency window）仍满足时，normal runtime 才可能允许 redispatch。

## Finite idempotency deadline

`idempotencyExpiresAt` 在 Operation 第一次创建时计算并冻结。

以下操作都不会续期：

```text
replay
restart
takeover
reconcile
```

过期后 same-key redispatch 不再被视为安全。

## `reconcileOnly`

Operator recovery 使用同一个 evidence evaluator，但锁死为 query-only mode。

```text
reconcileOnly
→ 永远不 dispatch Action.execute()
```

这保证运维查询不会悄悄变成新的副作用执行入口。

## 并发恢复

Claim 使用：

- semantic revision CAS；
- live lease；
- monotonic fencing token。

所有权切换之后，旧 worker 不能继续以旧 fencing token 提交 semantic state。

## 为什么必须有 `uncertain`

外部 API 可能：

```text
已经 commit
→ response 丢失
→ 本地不知道
```

如果 Provider 没有可靠幂等或权威查询，系统无法诚实证明 succeeded，也无法证明 failed。

所以：

```text
uncertain
```

本身就是正确 durable state。

更高层宿主可以：

- 等待证据；
- 提示 operator；
- 进入人工复核；

但不应该通过新 callId 把未知结果“洗掉”。
