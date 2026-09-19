# Recipe · Email and message sending

“发消息”看起来简单，但 duplicate 很容易被用户直接看到。

## 先查 Provider 能力

可能出现三种情况：

### Provider 支持 client message key / dedupe key

```ts
effects.idempotent()
```

### Provider 能按稳定 message/business key 权威查询 delivery/create 状态

```ts
effects.reconcilable()
```

### Provider 只有 `send()`，没有可靠 dedupe/query

```ts
effects.guarded()
```

Response lost 后不要自动再发一封“同样的邮件”。

## Business key

如果“同一个通知”跨多个 host session 都应该视为同一业务工作，可以考虑 Action `key()`：

```ts
key: (input) =>
  `invoice-reminder:${input.invoiceId}:${input.kind}`
```

但这是业务语义决定，不是所有邮件都应该全局去重。

## Common mistake

```text
subject + recipient 相同
→ assume same Operation
```

通常过强。两个不同时间点的合法通知可能内容相同。
