# 03 · Effect profiles

Effect profile 描述 **Action + Provider 真正具备的恢复能力**。

它不是成熟度等级，也不是“安全分数”。

## 快速选择

| Provider 能力 | 选择 |
|---|---|
| 无外部副作用 | `readOnly()` |
| 有副作用，但没有 durable idempotency，也无法权威查询 | `guarded()` |
| 真正接受稳定 operation key | `idempotent()` |
| 可以权威查询外部结果 | `reconcilable()` |
| 明确退出 managed crash/restart 语义 | `unmanaged()` |

原则：选择**与现实能力一致的最窄 profile**。

## `readOnly()`

```ts
effect: effects.readOnly()
```

适合纯计算/查询。

- Runtime 不要求 Action authorization；
- volatile ledger 可以合法使用；
- replay 可以重新执行；
- 不宣称任何 side-effect recovery。

不要为了绕过 durable gate 把 write 标成 read-only。

## `guarded()`

```ts
effect: effects.guarded()
```

适合：

```text
确实会产生外部副作用
+
Provider 无稳定幂等键
+
Provider 无权威结果查询
```

一旦已经可能 dispatch，而本地又无法证明结果：

```text
uncertain
```

这不是失败，而是正确状态。

此时 blind retry 反而是不安全行为。

## `idempotent()`

Durable window：

```ts
effect: effects.idempotent()
```

Finite window：

```ts
effect: effects.idempotent({
  window: {
    kind: "finite",
    expiresAfterMs: 15 * 60_000,
  },
})
```

只有 Provider 真正接受 `context.idempotencyKey` 时才使用。

Finite window 的 deadline：

- Operation 首次创建时冻结；
- restart 不续期；
- replay 不续期；
- takeover 不续期；
- reconcile 不续期。

过期后，Ordarium 不再把 same-key redispatch 当成安全路径。

## `reconcilable()`

```ts
effect: effects.reconcilable({
  cancellable: false,
})
```

必须实现 `reconcile()`：

```ts
async reconcile(input, context) {
  const external = await provider.lookup(context.operationId);

  if (external.done) {
    return { status: "succeeded", value: external.value };
  }

  if (external.failed) {
    return {
      status: "failed",
      error: {
        code: "PROVIDER_REJECTED",
        message: "Provider rejected operation",
      },
    };
  }

  if (external.absent) {
    return { status: "absent", retrySafe: true };
  }

  return { status: "unknown" };
}
```

允许的 reconcile outcome：

```text
succeeded
failed
absent { retrySafe }
pending
unknown
```

Recovery 先 query。

`absent` 只有在：

```text
retrySafe = true
```

且相应 idempotency window 仍有效时，才可能允许**正常 runtime path**重做。

### `reconcileOnly`

Operator 的 `reconcileOnly` 永远不 dispatch `execute()`。

即使 query 证明 absent + retrySafe，也只是返回 query-only 语义；真正 redispatch 仍由 normal runtime path 决定。

### 可选 idempotency window

```ts
effects.reconcilable({
  idempotencyWindow: { kind: "durable" },
})
```

### 可选 cancel

如果 Action 实现 `cancel()`：

```ts
effects.reconcilable({
  cancellable: true,
})
```

否则 Action 定义会被拒绝。

## `unmanaged()`

```ts
effect: effects.unmanaged()
```

这是显式 weak-mode / migration opt-out。

它不获得 managed crash/restart 保证，也不应该被文档宣传成“安全副作用模式”。

## Authorization

| Profile | Action authorization required? |
|---|---:|
| read-only | no |
| guarded | yes |
| idempotent | yes |
| reconcilable | yes |
| unmanaged | no |

## Ledger requirement

Managed write 需要 ledger 提供：

- crash durability；
- semantic CAS；
- live lease；
- semantic history；
- 覆盖部署拓扑的 coordination。

不足时在 Provider 调用之前返回：

```text
LEDGER_CAPABILITY_REQUIRED
```

## 常见错误

不要：

- 因为“重试通常没问题”就用 `idempotent`；
- Provider lookup 不是权威的，却用 `reconcilable`；
- dispatch 后 timeout 就写成 ordinary `failed`；
- restart 时延长 finite window；
- `guarded` 外面再套 host-level blind retry；
- 根据 HTTP method 猜 Provider guarantee。

Profile 是合同，不是愿望。
