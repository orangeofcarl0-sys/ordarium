# Ordarium Developer Guide

这里是从“我有一个会产生副作用的工具”到“我正确接入 Ordarium”的最短路径。

**不需要先读 G0–G18 或 evidence 历史。**

| # | 指南 | 解决什么问题 |
|---|---|---|
| 01 | [Getting started](01-getting-started.md) | 安装、定义第一个 Action、运行 |
| 02 | [Core concepts](02-core-concepts.md) | Action / Invocation / Operation / Attempt / Ledger |
| 03 | [Effect profiles](03-effect-profiles.md) | 根据 Provider 能力选择恢复合同 |
| 04 | [Errors](04-errors.md) | 稳定错误码与调用者动作 |
| 05 | [Authorization](05-authorization.md) | Action authorization 与 operator authorization |
| 06 | [Ledgers](06-ledgers.md) | SQLite、MemoryLedger、capability、自定义 ledger |
| 07 | [Operations](07-operations.md) | inspect/list/history/reconcile-only |
| 08 | [Hosts](08-hosts.md) | 自建宿主、host-kit、MCP |
| 09 | [Testing](09-testing.md) | fault injection 与 conformance |
| 10 | [Lifecycle & recovery](10-lifecycle-and-recovery.md) | quiesce/drain/uncertain/reconcile |
| 11 | [Management state](11-state.md) | revisioned state、refs、CAS、change feed |

## 一个心智模型

```text
这是什么工作？
→ Action + InvocationIdentity
→ stable Operation

它现在允许执行吗？
→ authorization evidence + ledger capability gate

失败之后什么动作是安全的？
→ effect profile + durable evidence + Provider capabilities
```

Ordarium 不会用猜测把 `uncertain` 升格为成功或失败。

## 精确定义在哪里

- [Product baseline](../12-ordarium-product-baseline.md)
- [Action contract](../13-ordarium-action-contract.md)
- [Architecture](../15-ordarium-complete-architecture.md)
- [Acceptance contract](../17-ordarium-goals-and-acceptance.md)

发布事实见 [Release history](../19-release-history.md)。
