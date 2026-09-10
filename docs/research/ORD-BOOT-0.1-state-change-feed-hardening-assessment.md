# ORD-BOOT-0.1 评估：StateChangeFeed 边界安全加固

> **研究评估，不是合同**——与 docs/12–18 冲突时以 12–18 为准。本文在实现前复现并分类 ORD-BOOT-0 已发布面（`ordarium-v1.3.0`，commit `a173453`）的三个边界缺陷；实现后的规范权威落在 [`ORD-BOOT-0.1-state-change-feed-hardening-spec.md`](ORD-BOOT-0.1-state-change-feed-hardening-spec.md)。
>
> 基线：`main` = `a173453`（工作树干净，tag/Release `ordarium-v1.3.0` 已发布且不重写）；workspace 1.3.0；SQLite schema v4；`HOST_CONTRACT_VERSION = 1`；35 文件 / 197 测试全绿。

## 1. 范围

只做三件事：拒绝 `limit=0`（确定性活锁）、拒绝**未来 cursor**（静默饥饿）、给显式页大小加资源上限。冻结既有架构：schema v4、`change_seq INTEGER PRIMARY KEY AUTOINCREMENT`、同事务写入、加法能力面、全局 filter-independent cursor、AtLeastOnceObservation、`HOST_CONTRACT_VERSION = 1`。**不**改 schema、不加表/列、不加 agent 语义、不做阻塞等待/consumer offsets/federation。

## 2. Defect A — `limit=0` 确定性活锁

现状（1.3.0）契约允许 `limit >= 0`（`resolveChangeLimit`：`!Number.isSafeInteger(limit) || limit < 0` 才拒绝）。给定至少一条匹配修订时：

```text
bound = 0
rows  = LIMIT 1
page  = []
cursor = 输入 cursor（不变）
hasMore = true
```

于是 `while (page.hasMore) { page = await feed.changes({ limit: 0 }, page.cursor); }` 永不前进：

$$
\boxed{limit=0 \land matchingChangeExists \Rightarrow CursorDoesNotAdvance \land hasMore=true}
$$

这不是风格问题，是确定性活锁（对长跑消费者等同永久挂起）。分类：**correctness/safety 缺陷**，须拒绝而非赋予特殊语义。

## 3. Defect B — 未来 cursor 静默饥饿

现状显式允许 `cursor > 数据库 high-water`，返回 `{changes:[], cursor:<原值>, hasMore:false}`。若 `change_seq` 最大值 37 而消费者 cursor=900，则后续 38、39、40… 在该库"越过 900"之前**永远不可观测**，而 feed 一直报"无新内容"。对持久协调/控制面消费者，静默"无新内容"比显式失败危险得多——两个自治进程可能互相停止观测。

未来 cursor 不是 feed 自己会产生的值，它强烈暗示：错误的库 / 库被还原到旧快照 / 库被重建重置 / cursor 持久化损坏 / 手工构造不兼容 cursor。冻结期望不变量：

$$
\boxed{CursorPosition > CurrentLedgerHighWater \Rightarrow INVALID\_CURSOR}
$$

分类：**correctness/safety 缺陷**，fail closed，复用既有 `InvalidCursorError`，不引入新错误族。

## 4. Defect C — 缺显式页大小资源上限

现状显式 `limit` 无上限（仅要求非负 safe integer）：调用方可请求任意大页，单次读取可物化无界数量的完整 `StateRecord`。既有默认 100，但显式值不受约束。分类：**resource-boundary 缺陷**——需一个命名的单一资源真值常量与上界校验，且不得把魔数散落在 MemoryLedger/SqliteLedger/StateStore/tests。

## 5. 高水位（high-water）语义冻结

`currentHighWater` = 账本当前已知的最高 state change 位置；空 feed 为 `0`。故空库 `cursor=0` 合法、`cursor=1` 非法；`highWater=17` 时合法区间为 `0..17`，`18+` 非法。

**校验必须是全局的**：cursor 是全局 filter-independent 位置，故未来 cursor 校验对比**全局** high-water，而非请求 namespace 的局部最大值。例：全局 max=100、alpha max=40，`changes({namespace:"alpha"}, cursor=80)` 合法（可能返回空页），此后 `alpha` 的 `change_seq=101` 仍可观测。不把 cursor 绑定到 namespace/filter/limit。

## 6. 并发与一致性（§17 审计结论）

`changes()` 读路径 = 两条读查询：读全局 `highWater`、校验 cursor、再取页。不需要一致快照，也不需要写侧改动：

- 正常并发下 high-water 只增不减（`AUTOINCREMENT` 不复用）；若校验后又有提交使 high-water 上升，被校验的 `cursor ≤ 旧 highWater ≤ 新 highWater` 仍合法——**不会误拒正常消费者**。
- 只有库被还原/重建/替换导致 high-water 下降时，旧 cursor 才会被拒——这正是期望的探测。
- 因此两查询实现的校验是**保守 fail-closed**：宁可拒绝疑似失效位置，绝不把"不可能的本地未来位置"静默当作已追平。

## 7. 诚实局限（不得过度声称）

高水位校验能捕获 "旧 cursor=500 / 还原后 max=100"，但**不能**捕获 "cursor 来自库 A=20 / 库 B max=100"（因 `20 <= 100`）。ORD-BOOT-0.1 **不**引入 ledger UUID / database epoch / cursor 数据库身份绑定（默认决议 `LedgerIdentityBinding = DEFER`，不为这个残余理论情形新增 schema v5）。已审计：当前无零架构代价可复用的通用身份原语。首个 Palimpsest bootstrap 消费者使用固定协调库配置。这是**已知局限，不是实现失败**，须在 spec 与发布说明中明确。

## 8. 修复决议（最小正确）

| 面 | 决议 |
|---|---|
| `limit` 域 | `undefined` → 默认 100；否则必须 `1 <= limit <= RESOURCE_LIMITS.maxStateChangePageItems`，违反（0/负/非整数/非 safe/超上限）→ `TypeError`。**不**给 `limit=0` 定义特殊语义 |
| 页大小上限 | `RESOURCE_LIMITS.maxStateChangePageItems`（core codec 的单一资源真值），两 ledger 共同引用；默认 100 不变 |
| 未来 cursor | 语法解析（既有严格解析）与语义校验分离：解析后 `position > highWater` → `InvalidCursorError`（`INVALID_CURSOR`） |
| schema | 不变，保持 v4；`ordarium_state_changes`/`change_seq`/AUTOINCREMENT/FK/UNIQUE 全不动 |
| 能力/兼容 | `StateChangeFeed` 仍是加法能力，`OperationLedger` 源兼容；`HOST_CONTRACT_VERSION` 不变 |
| 交付报告 | 1.3.0 的 delivery/spec **保留历史原文**，新增 0.1 文档并加日期化指针；不回溯改写 |

## 9. 发布分类初判

倾向 **1.3.1（patch）**：无 schema 迁移、无默认值变化、无新错误码、无 API 形状变化、无弃用面；`INVALID_CURSOR` 的含义（"不是合法持久位置"）未变，只是其触发域扩展；被拒绝的两个输入（`limit=0`、未来位置）本就是退化/危险输入，无正确消费者程序会依赖。最终裁决与逐类清单见 0.1 delivery report §2。
