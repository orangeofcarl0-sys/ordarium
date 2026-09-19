# How-to · Build a custom Ledger

只有在你已经有合适的 durable store、或 SQLite 不满足部署要求时才做这件事。

## 1. 实现 Port，不复制 Runtime

实现 `OperationLedger`：

```text
get / create / compareAndSet
claim / lease / renewLease
history / list
state CAS / history / refs / list
close?
```

如果支持 change feed，还要实现对应 capability/method。

不要在 Ledger 内重新实现一套 effect/recovery policy。

## 2. Capability 必须诚实

例如：

```ts
readonly capabilities = {
  durability: "crash-durable",
  coordination: "single-process-exclusive",
  semanticCas: true,
  liveLease: true,
  semanticHistory: true,
  stateRevisions: true,
  stateChangeFeed: false,
} as const;
```

如果后端不能证明 local-multi-process coordination，就不要声明它。

## 3. Claim 必须原子化

核心要求：

```text
semantic claim
+
live lease acquisition
```

必须作为一个不可分割的所有权决策。

否则两个 worker 可能都以为自己赢了。

## 4. Lease heartbeat 不得产生 semantic history

`renewLease()` 只更新 liveness。

不要：

```text
heartbeat
→ semanticRevision + 1
→ append business history
```

## 5. State CAS

`expectedRevision = 0`：创建；

`expectedRevision = n`：只有 current revision == n 才写 n+1。

Refs 必须在 commit 前保持 structural validity。

## 6. Cursor semantics

Pagination/change cursor 是 public behavior contract。

定义并测试：

```text
stable order
resume semantics
malformed cursor
future cursor
page limit
concurrent writes behavior
```

## 7. Run conformance

TypeScript 编译通过不算完成。

用 `@ordarium/testing` 的 ledger/state conformance 跑完整行为矩阵。

只有通过行为测试以后，才把你的 capability 声明当作真实 guarantee。
