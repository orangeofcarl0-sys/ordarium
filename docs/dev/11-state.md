# 11 · 管理型 state

共享时间线的第二种墨水（G11）。证据型 operation 记录"世界被改变"；管理型 state 记录"当前意图/计划"——计划修订、角色表、门禁注册表、run 状态这类**可变槽位**。它与 operation 共用同一账本引擎、同一套 revision/CAS 机器、同一个 SQLite 文件；信任模型与读法各自成合同。

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

覆盖式 CAS 槽位适合"计划/意图"这类**终值语义**——读最新修订即全部真相。首个深度消费（PLMP-TLM-1，Palimpsest telemetry 外置）给出了计数器类负载的另一形状：每样本一条 append-only 主体（`key: "delta-<uuid>"`，`expectedRevision: 0` 创建后**不改写**），读取用 `state.list(namespace)` 聚合装载——CAS 冲突面归零，修订史即数据本身。选型口径：要"当前值 + 修订史"用槽位；要"只增不减的事件序列"用 append-only 主体。

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

## 能力与生命周期

- ledger 必须声明 `stateRevisions: true`（两个内置实现都具备）；不足的 ledger 写入前 `LEDGER_CAPABILITY_REQUIRED`，绝不静默降级。
- 绑定 runtime 时尊重生命周期：quiesce 后写 → `RUNTIME_QUIESCING`，close 后 → `RUNTIME_CLOSED`。
- 打开旧数据库自动迁移：v2→v3 是纯增表事务迁移，operation 数据逐字节不动；失败回滚完整旧库。

## 边界重申

内核提供的是**时间线**：append-only、内容寻址摘要、CAS、引用存在性。它不提供订阅/推送（那是总线）、不解释 state 的业务含义、不执行失效传播、不重建编排逻辑。"预算即账本查询"是它的派生视图之一：按 scope 过滤 operation 列表（`ledger.list({ scope })`）即可得到派发计数，无需自建计数器。
