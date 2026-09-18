# Ordarium

**Ordarium 是一个 host-neutral 的 Safe Action SDK：为真实副作用提供稳定身份、持久证据、并发所有权与诚实恢复。**

它位于宿主的 Tool Pipeline 与真正产生业务变化的 Provider 之间。宿主继续拥有 Agent Loop、工具选择、审批、凭据、Sandbox、Session 与 UI；Ordarium 只负责一个更窄、但必须可靠的边界：

- 把重放/并发的调用归并到稳定的 **Operation**；
- 在执行副作用前持久化身份、授权与执行状态；
- 用 claim、lease 与 fencing 协调多个执行者；
- 根据 Provider **实际具备**的幂等/查询能力决定是否能重试；
- 结果无法证明时保持 `uncertain`，不伪造成功或失败；
- 在同一 ledger 上提供 revisioned management state 与增量 `StateChangeFeed`。

Ordarium **不承诺 arbitrary API 的 exactly-once**。只有 Provider 真正支持稳定 operation key、权威查询或相应 fencing 时，运行时才会采用对应恢复路径。

当前发布：**1.3.1**（已发布，tag `ordarium-v1.3.1`）· 工作区 **1.3.2**（已 bump，含类型面 `@deprecated` 标记，待发布）· MIT · 通过 GitHub tags / Releases 分发。

> `@ordarium/dsh` 是 **legacy / frozen** 宿主适配叶包。既有消费者继续可用；新接入优先使用 `@ordarium/core`、`@ordarium/host-kit`，或直接使用 `@ordarium/host-mcp`。自 1.3.2 起该包公开声明全部带 `@deprecated`（IDE / 类型检查直接提示迁移方向），运行时与类型形状零变化。

## 为什么需要 Ordarium

普通 Tool Wrapper 往往只能告诉你“函数被调用了”，但在崩溃、重放和并发发生后，它通常回答不了：

- Provider 已经完成副作用，但本地记账前进程崩了——到底成功了吗？
- 相同 tool call 被 replay / transport 再次投递——它是同一项工作还是新工作？
- 两个进程同时处理同一 Operation——谁拥有执行权？
- Provider 没有幂等键或权威查询——可以重试吗？
- 这个副作用到底由哪一份授权证据放行？
- 唯一诚实答案是“目前无法证明”时，系统该保存什么状态？

Ordarium 把这些判断从各插件自己的 `try/catch + retry` 中抽出来，形成明确、可测试的运行合同。

## Quick start

```ts
import { OrdariumRuntime, defineAction, effects, schema } from "@ordarium/core";
import { SqliteLedger } from "@ordarium/ledger-sqlite";

const createTicket = defineAction({
  name: "ticket.create",
  version: "1",
  description: "Create one support ticket",

  input: schema.object({
    title: schema.string({ minLength: 1 }),
  }),

  output: schema.object({
    id: schema.string(),
  }),

  // Provider 真正接受稳定幂等键。
  effect: effects.idempotent(),

  async execute(input, context) {
    return ticketApi.create(input, {
      idempotencyKey: context.idempotencyKey,
      signal: context.signal,
    });
  },
});

const runtime = new OrdariumRuntime({
  ledger: new SqliteLedger("/var/lib/myapp/ordarium.sqlite"),
});

const result = await runtime.run(
  createTicket,
  { title: "Printer is on fire" },
  {
    identity: {
      source: "myapp",
      scope: sessionId,
      callId,
    },
    authorization: {
      decision: "allow",
      kind: "host-admission",
      source: "myapp:tool-admission",
    },
  },
);
```

对 managed write，稳定 identity 是必需的。默认 logical key 为：

```text
source + scope + callId
```

Action 也可以通过 `key(input, identity)` 声明更强的业务键。

真正的宿主适配不要把 `runtime.run(...)` 散落在宿主各处，而应通过冻结的 [`HostInvocationPort`](docs/dev/08-hosts.md) 进入。

## Effect profiles

Effect profile 描述的是 **Action + Provider 的能力剖面**，不是“安全等级”。

| Profile | 什么时候用 | 崩溃/恢复姿态 |
|---|---|---|
| `effects.readOnly()` | 无外部副作用 | 可以重新执行 |
| `effects.guarded()` | 有副作用，但 Provider 无安全重放/查询原语 | 需要授权；dispatch 后结果不明则保持 `uncertain` |
| `effects.idempotent()` | Provider 真正接受稳定 operation key | 在声明的幂等窗口内可复用同一 key |
| `effects.reconcilable()` | Provider 能权威查询外部结果 | 先 query，再根据证据决定终态或是否可重做 |
| `effects.unmanaged()` | 明确的迁移/弱模式 opt-out | 不提供 managed crash/restart 保证 |

选择方法见 [Effect profiles](docs/dev/03-effect-profiles.md)，精确定义见 [Action contract](docs/13-ordarium-action-contract.md)。

## 两条持久时间线

### Operation：副作用执行证据

一个 Operation 表示“某个版本 Action 的一项稳定逻辑工作”。

```text
proposed
  → authorized | denied
  → claimed
  → dispatched
  → succeeded | failed | cancelled | uncertain | reconciled
```

Operation 记录稳定身份、授权、语义修订、attempt、fencing 与终态/不确定性。

### Management state：宿主定义的修订状态

```ts
import { createStateStore } from "@ordarium/core";

const state = createStateStore({ ledger });

await state.write({
  namespace: "workflow",
  key: "job-42",
  expectedRevision: 0,
  value: { phase: "queued" },
  refs: [],
  identity,
});
```

State 使用 revision CAS。`refs` 可以指向 Operation 或精确 state revision，并在写入前检查存在性；但 **Ordarium 不解释这些引用的业务含义**。

增量观测：

```ts
const page = await state.changes(
  { namespace: "workflow", limit: 100 },
  cursor,
);

page.changes;
page.cursor;   // 永远返回，可作为后续 resume 位点
page.hasMore;
```

这里的顺序只表示 **ledger commit-observation order**；它不承诺因果关系、业务优先级或分布式 exactly-once。

## Ledger

`@ordarium/core` 依赖 `OperationLedger + LedgerCapabilities`，不是硬编码 SQLite。

| Ledger | 适合 | 不承诺 |
|---|---|---|
| `SqliteLedger` | 默认 crash-durable 本机部署、本机多进程协调、Operation/State history、durable cursor | 多主机共识 |
| `MemoryLedger` | 单元测试、single-isolate read-only、明确的 volatile 场景 | 重启恢复、跨进程协调 |
| conformant custom ledger | 宿主已有 durable store | 超出 capability 声明与 conformance 证据的保证 |

Managed write 的 ledger 能力不够时，Provider 调用前就返回 `LEDGER_CAPABILITY_REQUIRED`。**不会静默 fallback 到 `MemoryLedger`。**

## Host integration

宿主入口很小：

```ts
interface HostInvocationPort {
  invoke(action, input, invocation): Promise<unknown>;
}
```

宿主提供：

- 稳定 `InvocationIdentity`；
- 可选、分类后的 `AuthorizationDecision`；
- 可选 `ProviderPrincipalRef`；
- 可选 `AbortSignal`。

当前宿主相关包：

| Package | 作用 |
|---|---|
| `@ordarium/host-kit` | host contract 握手 + curated types + portable conformance runner |
| `@ordarium/host-mcp` | MCP stdio 宿主适配 |
| `@ordarium/dsh` | **legacy / frozen** DSH 适配 |

当前：

```text
HOST_CONTRACT_VERSION = 1
```

它与 package semver、SQLite schema version 相互独立。

## Packages

| Package | 职责 | Node |
|---|---|---|
| `@ordarium/core` | Action / Runtime / Ledger & State ports / Recovery / Operations | `>=24.0.0` |
| `@ordarium/ledger-sqlite` | reference durable local ledger、迁移、本机协调 | `>=24.15.0` |
| `@ordarium/host-kit` | 自建宿主适配合同与 conformance | `>=24.0.0` |
| `@ordarium/host-mcp` | MCP 叶适配器 | `>=24.15.0` |
| `@ordarium/testing` | fault injection 与 conformance helpers | `>=24.0.0` |
| `@ordarium/dsh` | legacy DSH 适配器 | `>=24.15.0` |

每个包都有就地 README，位于 [`packages/`](packages/)。

## 分发与开发

当前正式分发渠道是 **GitHub tags / Releases**，不是公共 npm。

版本锚：

```text
ordarium-v1.3.1          published
ordarium-v1.3.2          workspace, pending release
```

仓库开发：

```bash
git clone https://github.com/orangeofcarl0-sys/ordarium.git
cd ordarium
pnpm install
pnpm build
pnpm check
```

消费方式与当前 package-manager 限制见 [Getting started](docs/dev/01-getting-started.md)。

## 明确不做

Ordarium 不是：

- Agent Loop；
- Planner / 多 Agent Scheduler；
- Prompt / Context assembler；
- Model Provider；
- Sandbox；
- Credential Vault；
- 第二套 Approval UI；
- 分布式共识系统；
- 通用 Workflow Engine；
- 普通使用所必需的独立 daemon/control plane。

这些职责属于宿主或更高层 runtime，例如 Palimpsest。

## 文档

- **开始使用**：[Developer guide](docs/dev/README.md)
- **产品边界**：[Product baseline](docs/12-ordarium-product-baseline.md)
- **精确执行合同**：[Action contract](docs/13-ordarium-action-contract.md)
- **架构**：[Architecture](docs/15-ordarium-complete-architecture.md)
- **升级/发布**：[Compatibility policy](docs/18-release-compat-policy.md)
- **版本事实**：[Release history](docs/19-release-history.md)
- **历史研究/证据**：[`docs/research/`](docs/research/agent-landscape-2026-08/README.md)、[`evidence/`](evidence/README.md)

总入口：[`docs/README.md`](docs/README.md)。

## Repository verification

```bash
pnpm check
pnpm test:integration
pnpm test:conformance
pnpm test:package
pnpm verify:architecture
pnpm verify:docs
pnpm verify:release
pnpm verify:matrix
```

`verify:architecture` 保护包依赖图、public API snapshot、冻结 union、SQLite schema baseline 与 compatibility register；`verify:docs` 检查 Markdown 链接、代码围栏与 README 的宣称边界。
