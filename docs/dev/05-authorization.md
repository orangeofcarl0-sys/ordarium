# 05 · Authorization

Ordarium 明确区分：

```text
Action authorization
!=
Operator authorization
```

它们回答的是两个不同问题，不能互相替代。

## Action authorization

Managed write 需要：

```ts
type AuthorizationDecision = {
  decision: "allow" | "deny";

  kind:
    | "host-admission"
    | "policy-decision"
    | "human-approval";

  source: string;
  reason?: string;
};
```

分类本身就是合同的一部分。

“宿主收到了一次 tool call”可以证明 `host-admission`，但**不自动等于** `human-approval`。

Authorization 可以：

- 在每次 invocation 中传入；
- 或由 runtime-level `authorizer` 产生。

`read-only` / `unmanaged` 不要求 managed Action authorization。

## Authorization 是 durable evidence

Operation 一旦保存 authorization decision，后续 replay 不能改写这段 authority history。

矛盾 decision：

```text
AUTHORIZATION_CONFLICT
```

这防止相同 Operation 在不同 replay 中被悄悄换成另一套授权语义。

## 宿主负责什么

宿主决定 authorization 的来源：

- admission pipeline；
- policy engine；
- 人工审批；
- 组织权限系统。

Ordarium 只接收**分类后的 decision**，不实现宿主的 Approval 产品。

禁止把 model/tool input 中的：

```text
approved: true
role: admin
humanApproved: true
```

直接转成可信 authorization。

## Provider principal continuity

Recovery 有时要求“仍然是同一个 Provider account / installation / tenant”。

宿主可以传：

```ts
providerPrincipalRef: {
  namespace: "github",
  subject: "installation:1234",
}
```

Ordarium 只持久化 digest。

同一 Operation 后续恢复到不同 principal：

```text
PRINCIPAL_CONFLICT
```

这是 continuity evidence，不是 credential storage。

## Operator authorization

Operations API 使用另一类可信对象：

```ts
interface OperatorAuthorization {
  operator: string;
  source: string;
  grantedAt: string;

  scope?:
    | "operations"
    | "operations:reconcile";
}
```

规则：

- 它不是 Action authorization；
- model/tool input 不能 self-grant；
- `inspect/list/history` 需要 `operations`；
- `reconcileOnly` 需要 `operations:reconcile`。

见 [07 · Operations](07-operations.md)。

## Checklist

发布 managed Action 前确认：

1. replay 时 identity 稳定；
2. authorization kind 分类正确；
3. 只有可信宿主路径能构造授权证据；
4. denial 对该 Operation 是 durable 的；
5. operator authorization 走独立可信通道；
6. recovery 依赖 Provider account 时显式建模 principal continuity。
