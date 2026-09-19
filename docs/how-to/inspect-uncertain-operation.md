# How-to · Inspect and resolve an uncertain Operation

你已经在生产上看到：

```text
OPERATION_UNCERTAIN
```

这页只回答：现在怎么处理。

## 1. 创建 Operations service

```ts
import { createOperations } from "@ordarium/core";

const operations = createOperations({ runtime });
```

如果只需要 inspect/list/history，可以只绑定 ledger。

## 2. 准备可信 OperatorAuthorization

```ts
const auth = {
  operator: "oncall@example.com",
  source: "admin-console",
  grantedAt: new Date().toISOString(),
  scope: "operations:reconcile" as const,
};
```

不要从 model/tool input 构造这个对象。

## 3. Inspect

```ts
const view = await operations.inspect(
  operationId,
  auth,
);
```

重点看：

```text
actionName / actionVersion
effectKind
state
attempts
identity
authorization
uncertainty
receipt
```

## 4. 如果 Action 支持 reconcile

```ts
await operations.reconcileOnly({
  operationId,
  action,
  input,
  identity,
  authorization: auth,
  providerPrincipalRef,
});
```

注意：

```text
reconcileOnly NEVER executes Action.execute()
```

它只获取/持久化外部 evidence。

## 5. 如果仍然 uncertain

这不是 API 调用失败，而是外部事实仍不足。

此时可做：

- 人工确认 Provider 后台；
- 等待外部系统新 evidence；
- 记录 operator resolution；
- 保留原 Operation 作为审计链。

不要通过新 callId 自动再做一遍副作用。

## 6. 查历史

```ts
const history = await operations.history(
  operationId,
  undefined,
  100,
  auth,
);
```

用它判断 Operation 曾经到达：

```text
authorized?
claimed?
dispatched?
uncertain?
reconciled?
```

LiveLease heartbeat 不会污染 semantic history。
