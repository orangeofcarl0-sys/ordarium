# Concept · Provider capabilities decide recovery

## The problem

同一个本地 crash，为什么有时能 retry，有时必须 query，有时只能停下？

因为 Ordarium 不能单方面决定外部 API 的语义。

## 30-second answer

Recovery capability 来自三方共同合同：

```text
Action declares profile
Provider actually supports capability
Ledger preserves durable evidence
```

少任何一个都不能凭空升级 guarantee。

## Four provider shapes

### A. No side effect

```text
query / pure compute
```

→ `readOnly`

### B. Side effect, no key, no query

```text
fire-and-forget legacy API
```

→ `guarded`

### C. Stable idempotency key

```text
same key safely denotes same external operation
```

→ `idempotent`

### D. Authoritative query

```text
stable business/external key
→ provider can tell succeeded/failed/absent/pending
```

→ `reconcilable`

Provider 同时有 C + D 时，可以组合 query-first + same-key fallback。

## Capability is not inferred from transport

Ordarium 不根据：

```text
HTTP PUT
HTTP POST
status code 500
request timeout
SDK method name
```

猜幂等/查询合同。

## Capability can expire

Provider idempotency may只有有限 window。

Ordarium 支持 finite deadline，就是为了避免：

```text
“这个 key 曾经安全”
被误写成
“这个 key 永远安全”
```

## Capability belongs in tests

你应该有 integration/conformance evidence 证明：

- same key 不产生 duplicate；
- reconcile result 真的 authoritative；
- absence semantics 确实支持 `retrySafe`；
- window 过期时 behavior 与 profile 一致。

## Start here

[Choose a profile](../start/choose-a-profile.md)
