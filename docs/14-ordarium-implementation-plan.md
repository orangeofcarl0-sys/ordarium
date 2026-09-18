# 14 · Implementation map

> 文件名保留用于旧链接兼容。本文现在是**当前实现地图**，不再是未来开发计划。历史 Goal spec / exit report 保留在 `evidence/`。

## Package map

| Package | 当前职责 | 主要扩展点 |
|---|---|---|
| `@ordarium/core` | Contract / Runtime kernel | `Action`、`OperationLedger`、`HostInvocationPort` |
| `@ordarium/ledger-sqlite` | reference durable local ledger | 替换为 conformant custom ledger |
| `@ordarium/testing` | fault / conformance toolkit | provider / ledger / host fixtures |
| `@ordarium/host-kit` | third-party host adapter kit | 自建 host package |
| `@ordarium/host-mcp` | concrete MCP adapter | 自定义 authorization / principal mapping |

## Core module map

```text
action.ts
  Action definition
  contractFingerprint

effects.ts
  EffectProfile

host.ts
  HostInvocationPort
  HOST_CONTRACT_VERSION

runtime.ts
  execution state machine
  claim / dispatch
  recovery integration

recovery.ts
  pure recovery evaluator

ledger.ts
  MemoryLedger
  cursor primitives

state.ts
  revisioned state façade
  StateChangeFeed guard

operations.ts
  operator inspect/reconcile-only

codec.ts
  persisted record validation
  resource limits

errors.ts
  stable error classes/codes

types.ts
  durable records / ports

json.ts
  canonical JSON / schema / digest
```

## SQLite implementation

`@ordarium/ledger-sqlite` 当前承载：

```text
operations
semantic history
live leases
state revisions
state refs
state-change ordering
forward migrations
```

当前：

```text
user_version = 4
```

它是 reference implementation，不是 core 语义依赖。

## 扩展路径

### 新 Action / Provider

通常只需要实现：

```text
Action.execute
正确 EffectProfile
可选 reconcile / cancel / receipt
```

不需要 fork Ordarium package。

### 新 Durable Ledger

实现：

```text
OperationLedger
```

并诚实声明 `LedgerCapabilities`，通过 ledger/state conformance。

不要把 runtime recovery policy 搬进 ledger。

### 新 Host

依赖：

```text
@ordarium/core
@ordarium/host-kit
```

Host protocol/framework type 留在 leaf package。

通过 host conformance 后再宣称 compatibility。

### 新 Operations UI

基于：

```text
createOperations
sanitized projections
```

不要直接读写 SQLite tables。

### Higher-level Durable Runtime

可以使用：

```text
Operations
StateStore
StateChangeFeed
```

作为 substrate。

但 scheduling、commitment、invalidation、project semantics、multi-agent coordination 继续属于更高层系统。

## Compatibility-sensitive boundaries

以下变更需要兼容/发布流程：

- package export maps；
- Action / EffectProfile shapes；
- `HostInvocationPort`；
- `HOST_CONTRACT_VERSION`；
- stable errors/states/effects/checkpoints；
- LedgerCapabilities semantics；
- persisted record schemas；
- SQLite migrations；
- host-visible defaults。

处理流程见 [18](18-release-compat-policy.md)。


## 当前维护姿态

优先改进：

- conformance；
- observability；
- documentation；
- compatibility discipline；
- ledger robustness；
- real host integration evidence。

不要因为上层消费者需要 orchestration，就把 Ordarium 本身扩张成 orchestration framework。
