# How-to · Store and watch management state

场景：你的 Host / Project Runtime 需要保存：

```text
project head
peer inbox cursor
subscription state
coordination intent
configuration revision
```

这些不是 Action execution outcome，而是 Host 自己定义的 durable state。

## 1. Create StateStore

```ts
const state = createStateStore({ runtime });
```

绑定 runtime 时，write 会遵守 runtime quiesce/close gate。

## 2. Create one subject

```ts
const first = await state.write({
  namespace: "project",
  key: "head",
  expectedRevision: 0,
  value: { revision: "abc123" },
  identity,
});
```

## 3. Update with CAS

```ts
const next = await state.write({
  namespace: "project",
  key: "head",
  expectedRevision: first.revision,
  value: { revision: "def456" },
  identity,
});
```

如果别人已经写了新 revision：

```text
STATE_REVISION_CONFLICT
```

正确做法：reload → re-evaluate → 再决定是否提交。

## 4. Add structural refs

```ts
refs: [
  { kind: "operation", id: operationId },
  { kind: "state", id: "project/config@7" },
]
```

Ordarium 只保证 ref target 存在。

它不会自动解释：

```text
这个 ref 是依赖？
是 authority？
要不要级联 invalidation？
```

## 5. Watch changes

```ts
let cursor: string | undefined;

while (true) {
  const page = await state.changes(
    { namespace: "project", limit: 100 },
    cursor,
  );

  for (const record of page.changes) {
    await consume(record);
  }

  cursor = page.cursor;
  await persistCursor(cursor);

  if (!page.hasMore) break;
}
```

## 6. Consumer idempotency

Change feed 的设计目标是：

```text
at-least-once observation
+
durable resume cursor
```

Consumer 自己应该能够重复处理同一 revision，或用 `(namespace,key,revision)` 去重。

## 7. Cursor safety

不要：

```text
INVALID_CURSOR
→ silently reset to beginning
```

这会把 deployment/store mismatch 隐藏掉。

把 cursor reset 作为显式 operator policy。
