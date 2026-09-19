# Ordarium

**Make external side effects survive retries, crashes, and races — without guessing.**

你有一段普通的工具代码：

```ts
const charge = await paymentApi.charge({ orderId, amount });
```

现在考虑最麻烦的一种故障：

```text
payment provider 已经扣款
        ↓
response 正在返回
        ↓
💥 进程在本地保存结果之前崩溃
        ↓
应用重启
        ↓
应该重试吗？
```

如果 Provider 支持稳定 idempotency key，答案可能是“使用同一个 key 安全重做”；如果 Provider 能权威查询，答案可能是“先查”；如果二者都没有，**正确答案可能就是 `uncertain`，不能盲重试**。

Ordarium 就负责这条边界。

它是一个 host-neutral 的 Safe Action SDK：为真实副作用提供稳定 **Operation identity**、durable execution evidence、并发 claim/fencing，以及基于 Provider 实际能力的恢复决策。

> Ordarium 不承诺 arbitrary API 的 exactly-once。它只在证据证明安全时重执行；证明不了外部结果时，保持 `uncertain`。

当前发布：**1.3.1**（已发布，tag `ordarium-v1.3.1`）· 工作区 **1.3.2**（已 bump，含类型面 `@deprecated` 标记，待发布）· MIT · GitHub tags / Releases。

## 第一次来？从这里开始

### 1. 用 5 分钟保护一个 API call

[**Quickstart — Protect one side effect**](docs/start/quickstart.md)

从普通 `await provider.create(...)` 开始，只增加：

```text
Action contract
+ stable invocation identity
+ effect profile
+ durable ledger
```

### 2. 然后故意把进程杀掉

[**Failure Lab — crash after the Provider commits**](docs/start/failure-lab.md)

这个实验会真的制造：

```text
Provider 已持久化 effect
→ Node 进程立即退出
→ Ordarium 尚未写 success
→ 同一调用重启恢复
```

你会亲眼看到三种完全不同的正确行为：

```text
guarded       → uncertain，不再次调用 Provider
idempotent    → 使用同一 idempotency key 重做
reconcilable  → 先查询 Provider，再决定
```

### 3. 根据 Provider 能力选 Profile

[**Choose a profile by what the Provider can prove**](docs/start/choose-a-profile.md)

不要背五个名词。先回答三个问题：

```text
这个调用会产生副作用吗？
Provider 支持稳定幂等键吗？
Provider 能权威查询结果吗？
```

## Before / After

### Before

```ts
async function createTicket(title: string) {
  return ticketApi.create({ title });
}
```

它的类型签名没有告诉你：

- replay 是否会创建第二张 ticket；
- crash 后是否允许 retry；
- 两个进程同时调用时谁拥有执行权；
- 这次调用由什么授权放行；
- response 丢失后外部结果是什么。

### With Ordarium

```ts
import { OrdariumRuntime, defineAction, effects, schema } from "@ordarium/core";
import { SqliteLedger } from "@ordarium/ledger-sqlite";

const createTicket = defineAction({
  name: "ticket.create",
  version: "1",
  description: "Create one support ticket",
  input: schema.object({ title: schema.string({ minLength: 1 }) }),
  output: schema.object({ id: schema.string() }),

  // Only choose this if the Provider truly honors this key.
  effect: effects.idempotent(),

  execute(input, context) {
    return ticketApi.create(input, {
      idempotencyKey: context.idempotencyKey,
      signal: context.signal,
    });
  },
});

const runtime = new OrdariumRuntime({
  ledger: new SqliteLedger("/var/lib/myapp/ordarium.sqlite"),
});

const ticket = await runtime.run(createTicket, { title: "Printer is on fire" }, {
  identity: {
    source: "support-agent",
    scope: sessionId,
    callId: toolCallId,
  },
  authorization: {
    decision: "allow",
    kind: "host-admission",
    source: "support-agent:tool-admission",
  },
});
```

Ordarium 现在能够把 replay/race 映射到同一个 durable Operation，并根据 Action 的 effect contract 决定恢复时允许什么。

## 常见问题，直接去对应页面

| 我现在的问题 | 读这里 |
|---|---|
| Provider 有 idempotency key，怎么正确接？ | [Idempotency-key tutorial](docs/tutorials/provider-idempotency-key.md) |
| Provider 可以按业务键查询结果 | [Reconciliation tutorial](docs/tutorials/provider-reconciliation.md) |
| Provider 什么恢复原语都没有 | [Guarded tutorial](docs/tutorials/no-recovery-primitive.md) |
| Operation 已经 `uncertain`，生产上怎么办？ | [Inspect an uncertain Operation](docs/how-to/inspect-uncertain-operation.md) |
| 多个 worker 会不会一起执行？ | [Run multiple workers safely](docs/how-to/run-multiple-workers.md) |
| 我要写自己的 Host Adapter | [Build a Host Adapter](docs/tutorials/host-adapter.md) |
| 我要写 custom Ledger | [Build a custom Ledger](docs/how-to/build-custom-ledger.md) |
| 我要保存 Project/Peer/Subscription 等状态 | [Store & watch management state](docs/how-to/store-and-watch-state.md) |

## Recipes

具体场景不要从抽象名词开始：

- [Payments](docs/recipes/payments.md)
- [Email / message sending](docs/recipes/email-and-messages.md)
- [Create an issue / ticket](docs/recipes/issues-and-tickets.md)
- [Cloud resource creation](docs/recipes/cloud-resources.md)
- [AI agent tool actions](docs/recipes/ai-tool-actions.md)

每个 recipe 都先问“Provider 能证明什么”，然后才选 profile。

## 核心概念——需要时再读

- [Operation identity：Ordarium 如何判断两次调用是不是同一项工作](docs/concepts/operation-identity.md)
- [`uncertain`：为什么不知道也是一种正确状态](docs/concepts/uncertain.md)
- [Claim / Lease / Fencing：多个 worker 如何避免同时拥有写权](docs/concepts/claim-lease-fencing.md)
- [Authorization evidence：Identity 与 Authority 为什么必须分开](docs/concepts/authorization-evidence.md)
- [Provider capabilities：真正决定恢复能力的是谁](docs/concepts/provider-capabilities.md)

## Ordarium 的边界

Ordarium 负责：

```text
stable Operation identity
+ authorization evidence
+ durable dispatch/history
+ claim / lease / fencing
+ recovery decision
+ revisioned management state
```

它**不负责**：

```text
Agent Loop
Planner / Scheduler
Prompt / Context
Model Provider
Approval UI
Credentials
Sandbox
Distributed consensus
Workflow semantics
```

这些继续属于 Host、Provider 或更高层 Runtime（例如 Palimpsest）。

## Packages

| Package | 用途 | Node |
|---|---|---|
| `@ordarium/core` | Action / Runtime / Ledger & State ports / Recovery / Operations | `>=24.0.0` |
| `@ordarium/ledger-sqlite` | 默认 crash-durable local ledger | `>=24.15.0` |
| `@ordarium/host-kit` | 自建 Host Adapter + conformance | `>=24.0.0` |
| `@ordarium/host-mcp` | MCP host adapter | `>=24.15.0` |
| `@ordarium/testing` | fault injection + conformance helpers | `>=24.0.0` |

当前：

```text
package version           1.3.1 published / 1.3.2 workspace
HOST_CONTRACT_VERSION     1
SQLite user_version       4
OperationRecord schema    2
StateRecord schema        1
```

> **`@ordarium/dsh`（legacy / frozen）**：最初的首宿主适配叶包，已冻结——既有消费者继续可用（自 1.3.2 起其公开声明全部带 `@deprecated`，运行时与类型形状零变化），新接入请走 `@ordarium/core` + `@ordarium/host-kit` 或 `@ordarium/host-mcp`。

## Documentation map

```text
Start       → 先跑起来、先看一次真实故障
Tutorials   → 端到端完成一种 Provider/Host 接入
How-to      → 解决具体工程任务
Recipes     → 套到真实业务场景
Concepts    → 理解抽象为什么存在
Reference   → 精确 API / contract / architecture
Archive     → research / evidence / release history
```

总入口：[docs/README.md](docs/README.md)

给 coding agents 的精简上下文：[docs/llms.txt](docs/llms.txt)

## Verify

```bash
pnpm check
pnpm verify:architecture
pnpm verify:docs
```

完整 release gate：

```bash
pnpm verify:release
```
