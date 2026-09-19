# Recipe · Payments

Payment 是最典型的“不能靠普通 retry 猜”的副作用。

## Provider 有 stable idempotency key

首选：

```ts
effects.idempotent({
  window: { kind: "durable" },
})
```

或按真实 Provider 合同声明 finite window。

把：

```text
context.idempotencyKey
```

原样传给 Provider。

## Provider 支持按 merchant order / external reference 查询

可以考虑：

```ts
effects.reconcilable()
```

`reconcile()` 必须能权威区分：

```text
succeeded
failed
pending
absent
unknown
```

## Provider 两者都没有

使用：

```ts
effects.guarded()
```

Crash 后无法证明结果时保持 `uncertain`，交给 operator/human follow-up。

## 不要做

- timeout 后自动生成新 idempotency key；
- 把 HTTP 500 直接解释成“没扣款”；
- 用新 callId 绕开 uncertain Operation；
- 把非权威 transaction list search 当 reconcile truth。
