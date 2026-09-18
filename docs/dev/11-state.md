# 11 · Management state & change feed

Operation 回答：

> 这项副作用 Action 发生了什么？

Management state 回答：

> 这个宿主定义的 subject 目前有哪些 durable revisions？

两者共享 ledger substrate，但语义完全不同。

## State subject

一个 subject：

```text
(namespace, key)
```

每次成功写入产生新的 immutable revision：

```ts
interface StateRecord {
  schemaVersion: 1;

  namespace: string;
  key: string;
  revision: number;

  value: JsonValue;
  valueDigest: string;

  refs: StateRef[];

  identity: InvocationIdentity;
  authorization?: AuthorizationRecord;

  writtenAt: string;
}
```

**value 的业务含义由宿主定义。**

Ordarium 不知道 `project/head`、`peer/optics`、`workflow/job-42` 分别意味着什么。

## 创建 StateStore

```ts
import { createStateStore } from "@ordarium/core";

const state = createStateStore({ ledger });
```

绑定 Runtime：

```ts
const state = createStateStore({ runtime });
```

后者会让 write 同样受 runtime quiesce / close gate 约束。

## Revision CAS

创建 revision 1：

```ts
await state.write({
  namespace: "workflow",
  key: "job-42",
  expectedRevision: 0,
  value: { phase: "queued" },
  identity,
});
```

从 revision 1 更新到 2：

```ts
await state.write({
  namespace: "workflow",
  key: "job-42",
  expectedRevision: 1,
  value: { phase: "running" },
  identity,
});
```

如果 current revision 已经改变：

```text
STATE_REVISION_CONFLICT
```

State 不使用 Operation 那套 lease/fence。

它的 arbitration 就是 revision CAS。

## StateRef

State revision 可以引用：

```ts
{
  kind: "operation",
  id: operationId,
}
```

或：

```ts
{
  kind: "state",
  id: "namespace/key@revision",
}
```

写入前会检查 target 是否存在。

不存在：

```text
STATE_REF_NOT_FOUND
```

这只是 structural guarantee。

Ordarium 不会自动：

- 传播 invalidation；
- 判断依赖关系；
- 把 ref 当 authority；
- 解释图语义。

## Read APIs

```ts
await state.get(namespace, key);

await state.history(
  namespace,
  key,
  cursor,
  limit,
);

await state.list(
  filter,
  cursor,
);

await state.listReferencing(
  ref,
  cursor,
  limit,
);
```

Cursor 是 opaque。

## Incremental StateChangeFeed

```ts
const page = await state.changes(
  {
    namespace: "workflow",
    limit: 100,
  },
  cursor,
);
```

返回：

```ts
{
  changes: StateRecord[],
  cursor: string,
  hasMore: boolean,
}
```

这里与普通分页不同：

```text
cursor 永远返回
```

即使已经读到末尾，它仍是“未来新 revision 从哪里继续”的 durable resume position。

## 顺序语义

Change feed 的顺序：

```text
ledger commit-observation order
```

不代表：

- causal order；
- 跨系统 wall-clock order；
- business priority；
- distributed global order。

SQLite v4 会在 state CAS transaction 中同时写入 `ordarium_state_changes` ordering row。

v3 以前没有保存全局提交顺序，所以 migration 对历史 revision 只能生成 deterministic synthetic order。

## Delivery model

更准确的心智模型：

```text
at-least-once observation
+
durable cursor
+
consumer 可以自己做 idempotency
```

Cursor 前进不等于业务 exactly-once processing。

## Limit 与 cursor

显式 `limit`：

```text
1..1000
```

默认：

```text
100
```

Malformed cursor 或位置大于当前 global high-water：

```text
INVALID_CURSOR
```

不会自动解释成“从头开始”或“目前没有数据”。

## 已知 cursor 边界

当前 cursor 没有与 database identity 绑定。

如果把另一份 ledger 的 cursor 拿到当前 ledger，而它的数值位置恰好合法，系统不一定能识别这是 foreign cursor。

因此 cursor storage 仍属于 consuming deployment 的 integrity boundary。

## Capability gate

Ledger 必须：

```text
capabilities.stateChangeFeed === true
```

并真正实现 `changes()`。

否则：

```text
LEDGER_CAPABILITY_REQUIRED
```
