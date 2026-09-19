# Tutorial · Provider has no safe recovery primitive

有些 Provider 就是：

```text
会产生副作用
但没有 stable idempotency key
也没有 authoritative query
```

这不是 Ordarium 无法支持的情况。

它意味着**恢复能力本来就有限**。

## Use `guarded()`

```ts
const send = defineAction({
  name: "legacy.message.send",
  version: "1",
  description: "Send one legacy message",
  input: schema.object({
    recipient: schema.string(),
    body: schema.string(),
  }),
  output: schema.object({
    providerId: schema.string(),
  }),

  effect: effects.guarded(),

  execute(input) {
    return legacyProvider.send(input);
  },
});
```

## Happy path

正常调用仍然可以：

```text
proposed
→ authorized
→ claimed
→ dispatched
→ Provider returns success
→ succeeded
```

## Hard failure path

真正的差异发生在：

```text
dispatched
→ Provider may have committed
→ local result is lost
```

此时没有证据支持：

```text
retry is safe
```

所以正确恢复结果是：

```text
uncertain
```

## Host 应该怎么处理 uncertain？

常见策略：

- 提示 operator；
- 等待外部人工确认；
- 通过另一个业务系统获得新 evidence；
- 保留 Operation，阻止自动 blind retry。

不要：

```text
catch OPERATION_UNCERTAIN
→ new callId
→ execute again
```

那只是绕过同一 Operation 的安全边界。

## `guarded` 的价值是什么？

它不是“保证不会重复”。

它保证的是：

```text
系统不会在证据不足时把 retry 假装成安全动作
```

这比“自动重试一切”更接近真实世界。

## 如果以后 Provider 增加恢复能力

- 新增 stable key → 考虑新 Action version + `idempotent`；
- 新增 authoritative query → 考虑新 Action version + `reconcilable`。

不要在同一个 Action version 下悄悄改变 effect contract。
