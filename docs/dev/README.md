# Ordarium 开发者文档

面向使用者的可读指南。维护与审计合同在 [`../12–17`](../README.md)；两边冲突时以 12–17 为准（请顺手提 issue 修文档）。

## 按角色进入

**我是 DSH 插件作者，想让工具调用不怕崩溃/重放/并发**

→ [01 快速开始](01-getting-started.md) → [02 核心概念](02-core-concepts.md) → [03 选择 effect profile](03-effect-profiles.md)；出错了查 [04 错误码表](04-errors.md)。

**我要控制谁可以执行副作用** → [05 授权](05-authorization.md)

**我关心数据存在哪、换数据库** → [06 Ledger 选择](06-ledgers.md)

**我要看/处置不确定的操作（运维）** → [07 运维面](07-operations.md)

**我在写宿主适配（DSH 之外）或用 MCP** → [08 宿主](08-hosts.md)

**我在写测试** → [09 测试套件](09-testing.md)

**我想理解生命周期/崩溃后发生什么** → [10 生命周期与恢复](10-lifecycle-and-recovery.md)

## 一句话记住 Ordarium

> 你声明 Action，Ordarium 保证：同一项工作不会因为重放、崩溃或并发而被悄悄执行两次；证明不了时，它诚实地返回 `uncertain`，绝不盲重试。
