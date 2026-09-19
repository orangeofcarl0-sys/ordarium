# Recipe · Issues and tickets

创建 issue/ticket 常见风险：

```text
Host retry
→ 创建两张重复工单
```

## 有 Provider idempotency key

直接按 Provider contract 使用 `idempotent`。

## 没有 key，但能按 stable external reference 查询

例如你的系统可以给每张工单带一个稳定 external reference，并且 Provider 能**权威**按它查询：

```ts
effects.reconcilable()
```

### Important

“全文搜索标题里有没有 `[order-42]`”通常不是足够强的 authoritative query，除非 Provider 明确保证唯一性/一致性。

## 两者都没有

使用 `guarded`。

如果 crash 后结果不明，不要自动创建第二张。

## Identity design

如果一个宿主 tool call 就对应一张 ticket：

```text
source + scope + callId
```

通常够用。

如果多个 session 都可能触发“同一个业务 ticket”，再考虑 Action `key()`。
