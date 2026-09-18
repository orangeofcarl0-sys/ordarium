# Ordarium 开发者文档

面向使用者的可读指南。维护与审计合同在 [`../12–19`](../README.md)（发布事实台账见 [`../19`](../19-release-history.md)）；两边冲突时以 12–19 为准（请顺手提 issue 修文档）。

当前发布线 **1.3.1**、六包、SQLite schema v4。

## 按角色进入

**我是 DSH 插件作者，想让工具调用不怕崩溃/重放/并发**

→ [01 快速开始](01-getting-started.md) → [02 核心概念](02-core-concepts.md) → [03 选择 effect profile](03-effect-profiles.md)；出错了查 [04 错误码表](04-errors.md)。

**我要控制谁可以执行副作用** → [05 授权](05-authorization.md)

**我关心数据存在哪、换数据库、自定义 ledger** → [06 Ledger 选择](06-ledgers.md)

**我要看/处置不确定的操作（运维）** → [07 运维面](07-operations.md)

**我在写宿主适配（DSH 之外）、用 MCP 或对齐宿主合同版本** → [08 宿主](08-hosts.md)

**我在写测试** → [09 测试套件](09-testing.md)

**我想理解生命周期/崩溃后发生什么** → [10 生命周期与恢复](10-lifecycle-and-recovery.md)

**我要在共享时间线上存计划/意图（宿主与编排作者）** → [11 管理型 state](11-state.md) → [06 Ledger 选择](06-ledgers.md)

**我要观测"别的主体提交了什么"（跨进程增量读取）** → [11 管理型 state §增量观测](11-state.md)（`StateChangeFeed`：全局 cursor、到末尾仍返回 resume 位点、`limit` 域 `1..1000`、`INVALID_CURSOR` fail closed）

## 索引

| # | 指南 | 覆盖 |
|---|---|---|
| 01 | [快速开始](01-getting-started.md) | 三种消费方式、最小示例、版本锚 |
| 02 | [核心概念](02-core-concepts.md) | Action / identity / operation / ledger 的心智模型 |
| 03 | [Effect profiles](03-effect-profiles.md) | 五种 profile 的适用面与崩溃语义 |
| 04 | [错误码表](04-errors.md) | 全部稳定错误码与调用者动作（案头参考） |
| 05 | [授权](05-authorization.md) | 分类 authorization evidence 与写门槛 |
| 06 | [Ledger 选择](06-ledgers.md) | 能力矩阵、能力门、自定义 ledger、运维注意 |
| 07 | [运维面](07-operations.md) | inspect / list / history / reconcile-only 与 OperatorAuthorization |
| 08 | [宿主](08-hosts.md) | DSH / MCP / 自建宿主、`HOST_CONTRACT_VERSION` 握手 |
| 09 | [测试套件](09-testing.md) | conformance kit、fault injection、手动时钟 |
| 10 | [生命周期与恢复](10-lifecycle-and-recovery.md) | quiesce/drain/close、uncertain 与 reconcile |
| 11 | [管理型 state 与变更订阅](11-state.md) | StateRecord、CAS、refs、`StateChangeFeed` 与 1.3.1 边界 |

## 一句话记住 Ordarium

> 你声明 Action，Ordarium 保证：同一项工作不会因为重放、崩溃或并发而被悄悄执行两次；证明不了时，它诚实地返回 `uncertain`，绝不盲重试。
>
> 同一账本上的管理型 state 与变更订阅只提供**位置与顺序**——state 的含义（计划、消息、契约、peer 进度）由宿主赋予。
