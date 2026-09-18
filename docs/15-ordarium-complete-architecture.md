# 15 · Architecture

本文描述 Ordarium **当前架构**，不再按历史 Goal 顺序讲解。

## 1. System boundary

```text
┌──────────────────────────── Host ────────────────────────────┐
│ Agent/Tool Pipeline · Approval · Credentials · Sandbox · UX │
└───────────────────────┬──────────────────────────────────────┘
                        │ HostInvocation
                        ▼
┌──────────────────────── Ordarium ────────────────────────────┐
│ Action contract                                              │
│ Runtime / effect authority                                   │
│ Operation ledger + recovery                                  │
│ Revisioned state + state change feed                         │
│ Operator/read surfaces                                       │
└───────────────────────┬──────────────────────────────────────┘
                        │ execute / reconcile / cancel
                        ▼
┌────────────────────── Provider ──────────────────────────────┐
│ external API / durable business system                       │
└───────────────────────────────────────────────────────────────┘
```

分工：

```text
Host
→ 决定调用什么、谁允许调用、凭据/会话/沙箱是什么

Ordarium
→ 决定声明过的副作用如何获得 durable identity、
   ownership、dispatch evidence 与 recovery

Provider
→ 决定外部事实，以及真正可提供的幂等/查询/取消能力
```

## 2. Package architecture

```text
                    @ordarium/core
                    /      |      \
                   /       |       \
      ledger-sqlite     testing    host leaves
             |             |        /      \
             |             +---- host-kit  host-mcp
```

依赖方向：

```text
host leaves → kernel
kernel -/→ host leaves
```

## 3. Normal execution path

```text
Host admission
   │
   ├─ stable identity
   ├─ authorization evidence
   ├─ provider principal?
   └─ AbortSignal?
   ▼
Input schema parse
   ▼
Ledger capability gate
   ▼
Operation identity / digests
   ▼
create / load durable Operation
   ▼
contract / authorization / principal consistency
   ▼
claim + live lease + fence
   ▼
persist dispatched
   ▼
Action.execute
   ▼
output parse / receipt
   ▼
succeeded | failed | cancelled | uncertain
```

Replay/recovery 会重新进入**同一个 Operation**，而不是默认创建新工作。

## 4. Semantic truth 与 liveness 分离

### Semantic OperationRecord

保存真正与执行事实相关的证据：

```text
state
semanticRevision
attempts
authorization
claim acquisition snapshot
result / receipt / error / uncertainty
```

### LiveLease

只保存当前执行所有权：

```text
owner
fencingToken
expiresAt
leaseRevision
```

Heartbeat 只更新 liveness。

```text
lease renewal
!=
semantic event
```

## 5. Recovery architecture

```text
existing dispatched / uncertain Operation
        │
        ▼
claim / takeover
        │
        ▼
有 reconcile？
   ┌────┴────┐
  yes       no
   │         │
query        operation key 可安全使用？
Provider          ┌───────┴───────┐
   │             yes              no
   ▼              │                │
evidence          ▼                ▼
           same-key redispatch   uncertain
```

Operator `reconcileOnly` 只走 query/evidence 路径。

## 6. Authorization architecture

Action execution：

```text
Host policy / human / admission
          │
          ▼
AuthorizationDecision
          │
          ▼
Ordarium Runtime
          │
          ▼
Durable Operation evidence
```

Operator surface：

```text
Trusted admin surface
      │
      ▼
OperatorAuthorization
      │
      ▼
Operations API
```

二者不可互换，也不可由 model/tool input self-grant。

## 7. State architecture

```text
(namespace, key)
      │
      ▼
revision CAS
      │
      ├─ value + digest
      ├─ identity
      ├─ authorization?
      └─ refs[]
      ▼
immutable revision chain
```

`refs` 只提供 structural typed pointer。

Ordarium 不解释 graph semantics。

## 8. Change-feed architecture

Ledger 声明 `stateChangeFeed` 后：

```text
state CAS transaction
      │
      ├─ StateRecord revision
      └─ change-order row / position
              │
              ▼
StateChangeFeed.changes(cursor)
```

Cursor 是 resume position，不是 authority。

SQLite 把 state revision 与 ordering row 放在同一 transaction。

## 9. SQLite physical model

当前 reference schema 逻辑上包含：

```text
ordarium_operations
ordarium_operation_events
ordarium_operation_leases

ordarium_state_revisions
ordarium_state_refs
ordarium_state_changes
```

当前：

```text
application_id = ORDA
user_version   = 4
```

Core 不依赖这些 table name。

## 10. Host adapter architecture

一个 Host Adapter 是 leaf：

```text
host protocol / tool event
      │
      ▼
adapter mapping
      │
      ├─ InvocationIdentity
      ├─ AuthorizationDecision?
      ├─ ProviderPrincipalRef?
      └─ AbortSignal?
      ▼
HostInvocationPort
      │
      ▼
OrdariumRuntime
```

`@ordarium/host-kit` 提供 curated contract 与 portable conformance。

## 11. Failure philosophy

Ordarium 宁可保留更小但真实的状态空间，也不通过猜测制造方便的答案。

```text
外部结果不明
→ uncertain

ledger 能力不足
→ dispatch 前 fail closed

principal mismatch
→ conflict

finite key 已过期
→ 不 redispatch

bad cursor
→ INVALID_CURSOR

host contract mismatch
→ fail closed
```

## 12. Higher-level consumers

例如 Palimpsest 可以在 Ordarium 之上拥有：

- Project state；
- Commitment；
- Monitor；
- Multi-Agent coordination；
- Verification；
- Scheduling；
- Cross-project federation。

这些语义继续属于上层。

这样 Ordarium 才能保持为可靠 effect/state substrate，而不是第二套 orchestration framework。
