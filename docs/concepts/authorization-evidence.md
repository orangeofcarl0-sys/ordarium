# Concept · Authorization evidence

## The problem

“谁发起了这次调用”和“谁允许这次副作用执行”不是同一个问题。

```text
Identity
!=
Authority
```

如果把它们混在一起，replay / recovery 很容易悄悄改变执行权来源。

## 30-second answer

InvocationIdentity 回答：

```text
这是谁/哪条调用链投递的？
```

AuthorizationDecision 回答：

```text
这项 managed side effect 为什么被允许/拒绝？
```

OperatorAuthorization 又回答：

```text
谁有权 inspect / reconcile durable operations？
```

三者分开。

## Classified evidence

Action authorization kind：

```text
host-admission
policy-decision
human-approval
```

这不是 cosmetic label。

例如 Agent 发起 tool call：

```text
Host accepted the tool call
```

最多可以合理表示为 `host-admission`。

除非真实的人类审批流程发生过，否则不能写 `human-approval`。

## Durable consistency

同一个 Operation 一旦记录 allow/deny decision，后续矛盾 evidence 不会覆盖它：

```text
AUTHORIZATION_CONFLICT
```

## Operator boundary

Operations API 的 `OperatorAuthorization` 是独立 trusted input。

它不能从 Action input 或 model argument 里 self-grant。

## Common mistakes

- `identity.actor = "admin"` 就当成 authorization；
- model argument `{approved:true}` 直接变成 human approval；
- 用 Action authorization 调 `reconcileOnly`；
- replay 时重新走不同 approval 路径并覆盖原 decision。

## Reference

[Authorization](../dev/05-authorization.md)
