# 06 · Ledgers

Runtime 依赖的是：

```text
OperationLedger
+
LedgerCapabilities
```

不是 SQLite 类名。

SQLite 是 reference durable implementation，而不是 Action 语义的一部分。

## Capability contract

```ts
interface LedgerCapabilities {
  durability:
    | "volatile"
    | "crash-durable";

  coordination:
    | "single-isolate"
    | "single-process-exclusive"
    | "local-multi-process";

  semanticCas: true;
  liveLease: boolean;
  semanticHistory: boolean;
  stateRevisions: boolean;
  stateChangeFeed?: boolean;
}
```

Runtime 按 capability fail closed，不会根据 implementation 名字猜能力。

## `SqliteLedger`

默认的本地 managed deployment 选择。

提供：

- crash-durable Operation/State records；
- semantic CAS；
- atomic claim + lease；
- live lease renewal；
- 本机多进程 coordination；
- Operation history；
- revisioned state；
- state refs；
- durable state-change ordering/cursor；
- forward migration。

当前：

```text
SQLite user_version = 4
```

## `MemoryLedger`

适合：

- 单元测试；
- single-isolate read-only；
- 明确的 volatile experiment；
- conformance harness。

它实现相同 logical port，但 capability 明确声明：

```text
durability = volatile
coordination = single-isolate
```

因此不能拿它证明 restart durability。

## Managed write gate

在创建 managed Operation 之前，Runtime 会检查：

```text
Action 要求
+
deploymentCoordination
+
LedgerCapabilities
```

能力不足：

```text
LEDGER_CAPABILITY_REQUIRED
```

Provider 不会被调用。

SQLite 打不开时，也**不会**自动 fallback 到 `MemoryLedger`。

## Deployment topology

```ts
new OrdariumRuntime({
  ledger,
  deploymentCoordination: "local-multi-process",
});
```

Direct embedded core 默认：

```text
single-isolate
```

声明的 deployment requirement 不能超过 ledger capability。

## SQLite migrations

Reference ledger 负责前向迁移。

当前历史：

```text
private v1 → current
v2 → v4
v3 → v4
```

v4 增加 durable state-change ordering。

v3 历史 revision 当时没有记录全局 commit order，因此 migration 只能按确定性规则生成 synthetic backfill order；不能把它描述成原始历史提交顺序。

打开未来 schema：

```text
LEDGER_NEWER_SCHEMA
```

Migration 失败：

```text
LEDGER_MIGRATION_FAILED
```

并保持事务 rollback。

## 自定义 Ledger

只“实现了接口”还不等于拥有相同保证。

至少必须正确实现：

- revision CAS；
- atomic claim + lease；
- monotonic fencing；
- heartbeat 与 semantic history 分离；
- pagination/cursor；
- state revision CAS；
- ref existence；
- truthful capability declaration。

使用 [`@ordarium/testing`](09-testing.md) conformance suite 验证行为。

## 部署边界

SQLite 是 local embedded reference store。

把 SQLite 文件放到 network filesystem **不会自动获得分布式多主机 authority / consensus**。
