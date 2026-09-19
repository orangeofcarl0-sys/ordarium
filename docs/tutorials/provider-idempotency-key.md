# Tutorial · Provider has an idempotency key

适用场景：Provider 明确承诺，同一个稳定 key 在其有效期内不会重复产生业务 effect。

典型思路：

```text
Ordarium Operation
      │
      └─ stable context.idempotencyKey
                 │
                 ▼
             Provider
```

## 1. 先确认 Provider contract

在写代码前，确认文档/接口合同至少回答：

```text
key 是否 durable？
同 key + 同 request 是否返回同一结果？
key 有效多久？
同 key + 不同 request 怎么处理？
```

如果你不知道 window，就不要随便假设 durable forever。

## 2. Durable window

```ts
const action = defineAction({
  // ...
  effect: effects.idempotent(),
  execute(input, context) {
    return provider.create(input, {
      idempotencyKey: context.idempotencyKey,
    });
  },
});
```

## 3. Finite window

如果 Provider 只保证 24 小时：

```ts
effect: effects.idempotent({
  window: {
    kind: "finite",
    expiresAfterMs: 24 * 60 * 60 * 1000,
  },
})
```

Ordarium 在 Operation 第一次创建时冻结 deadline。

```text
restart
replay
takeover
```

都不会延长它。

## 4. Stable invocation identity 仍然必需

Provider idempotency key 不是 Host invocation identity 的替代品。

Host 仍应提供：

```ts
identity: {
  source: "checkout-api",
  scope: cartId,
  callId: requestId,
}
```

Ordarium 使用 Operation identity 来判断“是不是同一项逻辑工作”，然后把稳定 `context.idempotencyKey` 交给 Provider。

## 5. Crash recovery

发生：

```text
persist dispatched
→ Provider commits
→ response lost / process crash
```

若没有 `reconcile()`，normal recovery 检查：

```text
operation key usable?
finite deadline still valid?
```

满足后才 same-key redispatch。

## 6. 必须测试

- same identity / same input replay；
- same identity / different input conflict；
- crash after dispatch；
- Provider 收到的 key 在 recovery 中完全相同；
- finite deadline 过期后不 redispatch；
- Provider 自己对 same key / different request 的冲突行为。

## 7. 不要这么做

### 每次 retry 生成一个新 key

这会直接破坏 Provider 侧去重。

### 用 Action input hash 临时当 Provider key，却没有稳定 Operation identity

你可能把本来不同的业务操作错误合并，也可能让 replay 无法汇合。

### Provider 只做“短时间缓存去重”，文档却写 `effects.idempotent()` 默认 durable window

如果 Provider window 有限，就显式建模 finite window。

## Next

想亲眼看 crash + same-key recovery：

[Failure Lab](../start/failure-lab.md)
