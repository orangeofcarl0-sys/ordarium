# Developer Reference

`docs/dev/` 是 **compact developer reference**，不是 Ordarium 的首要 onboarding 入口。

第一次使用请先完成：

1. [5-minute Quickstart](../start/quickstart.md)
2. [Failure Lab](../start/failure-lab.md)
3. [Choose a profile](../start/choose-a-profile.md)

然后按需要查这里。

| # | Reference | 什么时候查 |
|---|---|---|
| 01 | [Getting started](01-getting-started.md) | 安装、Action 基本形状 |
| 02 | [Core concepts](02-core-concepts.md) | Action / Invocation / Operation / Attempt |
| 03 | [Effect profiles](03-effect-profiles.md) | profile 精确定义 |
| 04 | [Errors](04-errors.md) | 稳定 error code 与 caller action |
| 05 | [Authorization](05-authorization.md) | Action / Operator authorization |
| 06 | [Ledgers](06-ledgers.md) | capabilities、SQLite、自定义 ledger |
| 07 | [Operations](07-operations.md) | inspect/list/history/reconcileOnly |
| 08 | [Hosts](08-hosts.md) | HostInvocationPort、host-kit、MCP |
| 09 | [Testing](09-testing.md) | fault injection / conformance |
| 10 | [Lifecycle & recovery](10-lifecycle-and-recovery.md) | quiesce/drain/recovery evaluator |
| 11 | [Management state](11-state.md) | revision CAS / refs / change feed |

## 一句话心智模型

```text
这是什么工作？
→ stable Operation identity

它允许执行吗？
→ authorization + ledger capability

失败后允许做什么？
→ Provider capability + durable evidence
```

没有足够证据时，Ordarium 不猜：

```text
uncertain
```

完整规范见 [13 · Action contract](../13-ordarium-action-contract.md)。
