# 11 · 管理型 state

共享时间线的第二种墨水（G11）。证据型 operation 记录"世界被改变"；管理型 state 记录"当前意图/计划"——计划修订、角色表、门禁注册表、run 状态这类**可变槽位**。它与 operation 共用同一账本引擎、同一套 revision/CAS 机器、同一个 SQLite 文件；信任模型与读法各自成合同。

本篇同时覆盖 **1.3.0 起的增量观测面**（`StateChangeFeed`，跨主体按持久提交序读取修订）与其 1.3.1 边界加固；如果你只想知道"别的主体写了什么"，直接跳到[增量观测](#增量观测statechangefeed130-起131-加固)。

## 什么时候用

- 你的宿主要把**计划/意图状态**移出上下文窗口和宿主私有存储，落成跨进程、跨重启、可审计的修订链（Magentic 式 ledger 的持久化版）；
- 多个 agent/进程要**并发修订同一份意图**，需要乐观仲裁而不是各自维护计数器；
- 你想让计划修订**引用**真实的副作用 operation（"这次晋升是因为哪些已证明的调用"），并按引用反查。

不适用：消息传输与路由（账本≠总线——宿主做传输，内核只在取证需要时落对话记录，目前尚未实现）；任何需要内核解释引用含义的场景（失效传播、晋升逻辑永远在宿主）。

## 最短路径

`createStateStore` 在 `@ordarium/dsh/advanced`（与 `createOrdariumPlugin` 同层）；state 面不进 root façade。

```ts
import { createStateStore } from "@ordarium/dsh/advanced";

const state = createStateStore({ runtime: plugin.runtime });  // 或 { ledger }

await state.write({
  namespace: "palimpsest",        // 宿主声明分区：共账拓扑下的隔离约定
  key: "plan",                    // subject 键：可变槽位地址
  expectedRevision: 0,            // 0 = 创建；否则基于当前修订号
  value: { goal: "ship", steps: ["a", "b"] },
  refs: [{ kind: "operation", id: operationId }],   // 一等引用，可省略
  identity: { source: "dsh", scope: sessionId, callId },
});
```

每次写入都会：校验身份与 subject 命名 → 记录写者溯源（`identity`）→ 校验引用存在性 → 以 revision CAS 落一条 append-only 修订。value 与 receipt 同规格：JSON 安全载荷、1 MiB 上限，账本只存摘要与安全内容。

## 负载形状：覆盖式槽位 vs append-only 主体（首消费者反馈）

覆盖式 CAS 槽位适合"计划/意图"这类**终值语义**——读最新修订即全部真相。首个深度消费（PLMP-TLM-1，Palimpsest telemetry 外置）给出了计数器类负载的另一形状：每样本一条 append-only 主体（`key: "delta-<uuid>"`，`expectedRevision: 0` 创建后**不改写**），读取用 `state.list(namespace)` 聚合装载——CAS 冲突面归零，修订史即数据本身。选型口径：要"当前值 + 修订史"用槽位；要"只增不减的事件序列"用 append-only 主体。**同步语义分两种且不可混用**（首消费者 TLM r2 生产实证）：`fresh`（零基线重放，pump 边界常规 flush）与 `load`（以 durable 聚合续接重启）——新进程误用 durable 聚合当基线会静默丢弃同形记录。

## 并发：乐观 CAS，没有锁

写门槛由身份 + 授权证据表达（默认宿主准入）；仲裁全部交给 revision CAS——`expectedRevision` 不匹配即 `STATE_REVISION_CONFLICT`。没有 lease/fence：单写者纪律是宿主的调度策略（如一次一事件的确定性调度器），不是内核机制。

```ts
try {
  await state.write({ ...request, expectedRevision: current.revision });
} catch (error) {
  if (error.code === "STATE_REVISION_CONFLICT") {
    const latest = await state.get(request.namespace, request.key);  // 重读合并后重试
  }
}
```

## 修订链与引用

- `state.history(namespace, key, cursor, limit)`：append-only 修订链，opaque cursor 分页；撤销/回滚 = 写一条新修订，永不改历史。
- `refs` 是一等字段：写入期做存在性校验（悬空引用 `STATE_REF_NOT_FOUND`，fail-closed），内核**只存不释**——失效传播是宿主拿 `state.listReferencing({ kind, id }, cursor, limit)` 的查询结果自己去执行的事。
- state 引用的 id 形如 `"namespace/key@revision"`；subject 命名只允许 `[A-Za-z0-9._-]`，保证引用永远可解析。

## 增量观测：StateChangeFeed（1.3.0 起，1.3.1 加固）

`get`/`history`/`list` 都是"点"读法。要看**别的主体提交了什么**，用变更订阅——跨主体、按持久账本提交观测序增量前进：

```ts
let cursor: string | undefined = undefined;        // 宿主自己持久化这个值

for (;;) {
  const page = await state.changes({ namespace: "palimpsest", limit: 100 }, cursor);
  for (const record of page.changes) {
    // record 就是普通 StateRecord：value / refs / identity / writtenAt 语义不变
  }
  cursor = page.cursor;      // 到末尾也返回——这就是你的 durable resume 位点
  if (!page.hasMore) break;  // 追平；之后用同一 cursor 轮询即可
}
```

语义要点（完整规范见 [`../research/ORD-BOOT-0.1-state-change-feed-hardening-spec.md`](../research/ORD-BOOT-0.1-state-change-feed-hardening-spec.md)）：

- **顺序**：位置严格升序，只代表**账本提交观测序**，不代表因果、墙钟或业务优先级。
- **cursor**：不透明、**全局**（与 namespace filter 无关，同一 cursor 可换 filter 复用）、**总是返回**（到末尾仍是有效 resume 位点）；缺省 cursor = 从起点开始。跨 filter 复用的含义是"跳过 ≤ 该位置的全局一切"。
- **交付语义**：`AtLeastOnceObservation + DurableCursor + IdempotentConsumerPossible`——不承诺分布式 exactly-once；消费者可以"读页 → 处理部分 → 崩溃 → 重读"，正确持久化的 cursor 不会静默跳过已提交修订。
- **失败模型**：畸形 cursor，以及语法合法但位置**超出本账本全局高水位**的 cursor，都抛 `INVALID_CURSOR`。后者防的是"库被还原/替换后 feed 永远报无新内容"的静默饥饿——**绝不**当作"从零开始"或"无新内容"。
- **资源边界**：显式 `limit` 域为 `1..RESOURCE_LIMITS.maxStateChangePageItems`（1000），默认页 100；`limit=0` 无法推进（确定性活锁），直接被 `TypeError` 拒绝。
- **持久性继承 ledger**：`SqliteLedger` 的 cursor 跨进程重启有效；`MemoryLedger` 只在进程内有效（能力声明 `volatile`，不要声称跨重启）。
- **已知局限（如实记录）**：不做 cursor 与数据库的身份绑定（`LedgerIdentityBinding = DEFER`）——"来自另一库但数值合法"的 cursor 无法被探测。首个消费者使用固定协调库配置。

内核只回答"位置 X 之后提交了哪些修订"；**含义归你**：消息、收件箱、契约、承诺、订阅、peer 进度都只是宿主对这些修订的解释。消费者游标归属（"消费者 A 在 X"）也留在宿主 state——本批不提供 `ack`/consumer offsets/consumer registry/mailbox（那是宿主或未来证据驱动的事）。

## 能力与生命周期

- ledger 必须声明 `stateRevisions: true`（两个内置实现都具备）；不足的 ledger 写入前 `LEDGER_CAPABILITY_REQUIRED`，绝不静默降级。
- 变更订阅要求额外声明 `stateChangeFeed: true`（可选能力位；两个内置实现都具备），入口是 `supportsStateChangeFeed(ledger)` / `state.changes(...)`；不支持时同样 `LEDGER_CAPABILITY_REQUIRED`。
- 绑定 runtime 时尊重生命周期：quiesce 后写 → `RUNTIME_QUIESCING`，close 后 → `RUNTIME_CLOSED`；`changes` 是读面，与 `get`/`history` 同规格，不被当作 mutation。
- 打开旧数据库自动前向迁移：v2→v3（state 修订链 + refs 反查）与 v3→v4（变更定序表）都是纯增表事务迁移，operation 数据逐字节不动；失败回滚完整旧库。当前 schema 版本为 **v4**。

## 边界重申

内核提供的是**时间线 + 它的观测位点**：append-only、内容寻址摘要、CAS、引用存在性，以及"按持久提交序增量读"的 `StateChangeFeed`。它**不提供推送/阻塞等待**（不订阅、不长轮询、无 IPC/WebSocket；首个消费者轮询即可）、不解释 state 的业务含义、不执行失效传播、不重建编排逻辑、不记录消费者偏移量。"预算即账本查询"是它的派生视图之一：按 scope 过滤 operation 列表（`ledger.list({ scope })`）即可得到派发计数，无需自建计数器。
