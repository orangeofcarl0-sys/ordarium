# 07 · Operations & observability

`createOperations(...)` 提供 operator-facing 的 durable Operation 观察/恢复面。

它故意很小：

```text
inspect
list
history
reconcileOnly
```

没有：

```text
force execute
force retry
raw SQL mutation
```

## 创建

只读观察可以仅给 ledger：

```ts
import { createOperations } from "@ordarium/core";

const operations = createOperations({ ledger });
```

`reconcileOnly` 需要 runtime：

```ts
const operations = createOperations({ runtime });
```

## OperatorAuthorization

所有 Operations API 都需要可信 operator authorization：

```ts
const auth = {
  operator: "oncall@example.com",
  source: "admin-console",
  grantedAt: new Date().toISOString(),
  scope: "operations",
} as const;
```

`reconcileOnly` 需要：

```text
operations:reconcile
```

这份授权必须来自可信运维路径，不能由 model/tool input 自己构造。

## Inspect

```ts
const view = await operations.inspect(
  operationId,
  auth,
);
```

Operator view 包含：

- Action name/version；
- effect kind；
- state；
- attempts；
- semantic revision；
- fencing token；
- invocation identity；
- authorization；
- safe error/uncertainty；
- receipt；
- result digest reference。

不暴露 arbitrary raw Provider data。

## List

```ts
const page = await operations.list(
  {
    actionName: "ticket.create",
    state: "uncertain",
    scope: "session-42",
    limit: 100,
  },
  cursor,
  auth,
);
```

`nextCursor` 是 opaque contract，不要解析内部格式。

## History

```ts
const history = await operations.history(
  operationId,
  cursor,
  100,
  auth,
);
```

这里是 **semantic revision history**。

Lease heartbeat 不属于业务历史。

## `reconcileOnly`

这是 query-only recovery。

调用时必须重新提供能唯一复现 durable Operation 的材料：

- `operationId`；
- Action；
- input；
- InvocationIdentity；
- 可选 ProviderPrincipalRef。

Ordarium 会重新计算 identity/digest。

不一致：

```text
OPERATION_CONFLICT
```

关键保证：

```text
reconcileOnly 永远不调用 Action.execute()
```

即使 Provider 权威 query 返回 `absent + retrySafe`，operator query 本身也不会变成 redispatch。

## Model view

`projectModelView(record)` 比 operator view 更窄：

- 不返回 raw result；
- 不返回 receipt body；
- 不返回完整 authorization / identity lineage；
- uncertainty 只暴露有限 reasonCode。

调用者只拿自己真正需要的投影。

## Uncertain 的推荐运维流程

1. inspect；
2. 核对 Action/profile/Provider 能力；
3. 支持 reconcile 时执行 `reconcileOnly`；
4. 仍无法确定则升级 operator/human；
5. 保留原 Operation 证据。

不要通过生成新 callId 绕开 `uncertain`。
