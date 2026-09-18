# Ordarium

Ordarium 是**多 agent harness 的公共基石**：一个轻量、可嵌入、host-neutral 的 **Safe Action SDK + Effect Authority + revisioned durable state primitives**。它不运行 Agent、不组装 Prompt、不调度或编排 agent，也不替代任何宿主 harness；它包住真正会产生副作用的 Action，使一次调用具备稳定身份、分类授权证据、持久状态、并发所有权和诚实的崩溃恢复语义；它也在同一账本上提供宿主声明的**管理型 state**（`(namespace, key)` 修订链 + refs）与**跨主体的增量变更观测**（`StateChangeFeed`），但不解释这些 state 的含义。

**宿主中立是可以用机器证明的合同，而不是口号**：接入面是冻结的 `HostInvocationPort`，任何符合该端口的 harness 都能消费；中立性由真实第二宿主（`@ordarium/host-mcp`，MCP 协议）与可移植的宿主 conformance runner（`@ordarium/host-kit`）验证。多个 agent/进程/宿主可共享同一本地 ledger（共账拓扑）。宿主适配器是**叶包**：新增一个宿主只增加一个叶包，内核与 Action 合同零改动。

> 当前发布线为 **`1.3.1`**（正式线，MIT；六包）。**分发渠道为 GitHub**：本仓库即包源，以 git tag + 同名 Release 为版本锚（`ordarium-v1.0.0` → `ordarium-v1.3.1` 均已发布）；公共 npm 发布未执行（1.0.0 时的尝试被账号 2FA 拒绝，零发布）。每版的档位、头条交付与消费者可见变化见 [`docs/19-release-history.md`](docs/19-release-history.md)。
>
> **`@ordarium/dsh` 是 legacy 叶包**：它是最初的 DSH 宿主适配，现已冻结（只保留给既有消费者，不再新增能力，不再作为推荐路径）。自 1.3.2 起其公开声明全部带 `@deprecated`，IDE/类型检查会直接提示迁移方向；运行时、导出与类型形状**零变化**——既有代码继续编译运行。新接入请走 host-neutral 路径：`@ordarium/core` + 自建宿主（`@ordarium/host-kit`）或 MCP（`@ordarium/host-mcp`）。

## 为什么安装

普通 Harness 能告诉你“工具被调用过”，却通常无法可靠回答：

- 进程在远端成功后、本地记账前崩溃，这次调用到底成功了吗？
- 相同 tool call 被 session replay 或 subagent transport 再次投递时，是否会重复扣款、发消息或创建资源？
- 两个进程同时接到同一调用时，谁拥有执行权？
- Provider 不支持幂等键或查询时，系统会不会把未知结果当失败并盲重试？

Ordarium 把这些判断从每个插件各自的 `try/catch` 中抽出来，形成一个小而明确的公共合同。纯读取工具通常不需要安装它；有不可逆或昂贵副作用、需要 crash/replay 恢复的插件才是核心用户。

## 最短路径

两步：**声明 Action**，**给它一个 runtime + durable ledger**。没有 daemon、端口或控制平面；默认 managed 模式使用进程内嵌的本地 SQLite。

```ts
import { OrdariumRuntime, defineAction, effects, schema } from "@ordarium/core";
import { SqliteLedger } from "@ordarium/ledger-sqlite";

const createTicket = defineAction({
  name: "ticket.create",
  version: "1",
  description: "Create one support ticket",
  input: schema.object({ title: schema.string({ minLength: 1 }) }),
  output: schema.object({ id: schema.string() }),
  effect: effects.idempotent(),
  async execute(input, context) {
    return api.createTicket(input, {
      idempotencyKey: context.idempotencyKey,   // 稳定 operation key，跨重试复用
      signal: context.signal,
    });
  },
});

const runtime = new OrdariumRuntime({
  ledger: new SqliteLedger("/var/lib/myapp/ordarium/operations.sqlite"),
});

const ticket = await runtime.run(createTicket, { title: "printer is on fire" }, {
  identity: { source: "myapp", scope: sessionId, callId },
  authorization: { decision: "allow", kind: "host-admission", source: "myapp:approval" },
});
```

`effects.idempotent()` 表示 Provider 能证明 durable operation-key idempotency；有限窗口必须显式写成 `effects.idempotent({ window: { kind: "finite", expiresAfterMs } })`。Finite deadline 在 operation 首次创建时冻结，重启或重试不会续期。

**接入宿主时**不要直接调用 `runtime.run`，而是让宿主实现 `HostInvocationPort`（`runtime.invoke` 即该端口的实现）并注入 identity / 授权证据 / 取消信号；自建宿主用 `@ordarium/host-kit` 的 `assertHostContract` + `runHostAdapterConformance` 对齐宿主合同版本。现成的宿主适配叶包：`@ordarium/host-mcp`（MCP 协议）；`@ordarium/dsh`（legacy，冻结）。

## Effect profiles

这些 profile 是不同能力剖面，不是从低到高的“五级安全分数”。

| Profile | 适用对象 | 崩溃后的行为 |
|---|---|---|
| `effects.readOnly()` | 查询、纯计算 | 可重做；不需要 durable side-effect recovery |
| `effects.guarded()` | 有副作用但 Provider 无恢复原语 | 先授权；dispatch 后结果不明则保持 `uncertain`，绝不盲重试 |
| `effects.idempotent(window)` | Provider 真正接受稳定 operation key | 只在已证明的 durable/finite window 内复用同一 key；finite 过期后禁止 execute |
| `effects.reconcilable(...)` | Provider 可按外部键 query | 恢复时先查询；只有 authoritative evidence 才完成、失败或允许 normal Runtime 重做 |
| `effects.unmanaged()` | 渐进迁移或明确退出 managed guarantee | 不承诺 crash/restart recovery；不能被文档描述成安全模式 |

Ordarium 不声称能让任意外部 API 获得“恰好一次”。只有 Provider 真正支持幂等键、可查询业务键或 fencing 时，端到端不重复才可证明；否则正确结果是 `uncertain`，不是伪造成功或失败。

## 管理型 state 与变更订阅

除证据型 operation 外，同一账本还承载**管理型 state**：宿主声明的 `(namespace, key)` 槽位 + 单调 `revision` + 内容摘要 `valueDigest` + 一等 `refs`（指向 operationId 或 `namespace/key@revision`，写入前做存在性校验）+ 写者 identity。仲裁是乐观 revision CAS 单原语（`expectedRevision: 0` 表示创建），无 lease/fence；内核只存不释——失效传播、晋升、级联撤销都留在宿主。

需要"看到别的主体提交了什么"时用**变更订阅**（1.3.0 起）：

```ts
import { createStateStore } from "@ordarium/core";

const store = createStateStore({ ledger });
const page = await store.changes({ namespace: "alpha", limit: 100 }, cursor);
// page.changes : StateRecord[]（按持久账本提交观测序升序）
// page.cursor  : 不透明、全局、到达末尾仍返回的 resume 位点
// page.hasMore : 是否还有已存在的匹配变更
```

- 顺序只承诺**账本提交观测序**，不代表因果、墙钟或业务优先级；
- 交付语义是 `AtLeastOnceObservation + DurableCursor + IdempotentConsumerPossible`——不承诺分布式 exactly-once；正确持久化的 cursor 不会静默跳过已提交修订；
- 显式 `limit` 域为 `1..1000`（默认页 100）；畸形 cursor，以及语法合法但位置**超出本账本高水位**的 cursor，都以 `INVALID_CURSOR` fail closed（绝不当作"从零开始"或"无新内容"）；
- cursor 的持久性继承 ledger 的 durability 声明：SQLite 跨进程重启有效，`MemoryLedger` 仅进程内；
- 已知局限（如实记录）：不做 cursor 与数据库的身份绑定，因此"来自另一库但数值合法"的 cursor 无法被探测。

state 的含义（消息、收件箱、契约、承诺、订阅、配置、计数器）完全由宿主赋予——Ordarium 不知道也不需要知道。详见 [docs/dev/11](docs/dev/11-state.md)、[docs/13 §11](docs/13-ordarium-action-contract.md) 与 [docs/research/ORD-BOOT-0.1-state-change-feed-hardening-spec.md](docs/research/ORD-BOOT-0.1-state-change-feed-hardening-spec.md)。

## SQLite 是否必需

**不绝对必需。** Core 只依赖 `OperationLedgerPort + LedgerCapabilities`，不把 SQLite 写进 Action 或 Operation 语义。

| 选择 | 合法用途 | 不能承诺 |
|---|---|---|
| 默认 `@ordarium/ledger-sqlite` | 本机 crash-durable managed write、本机多进程协调、历史与恢复、state 修订链与变更订阅（cursor 跨重启有效） | 网络文件系统或多主机共识 |
| `MemoryLedger` | 单 isolate 测试、纯读取、显式 `unmanaged`、进程内 state/变更订阅 | crash/restart recovery、跨进程 claim、cursor 跨进程存活 |
| conformant custom/host ledger | 高级嵌入、宿主已有 durable store | 未通过 capability/codec/lease/history conformance 的 managed guarantee |

Runtime 在创建 managed operation 前检查 durability、coordination、semantic CAS、live lease 与 history 能力。能力不足或 durable ledger 打开失败会返回 `LEDGER_CAPABILITY_REQUIRED`，Provider 不会被调用；系统绝不静默 fallback 到 MemoryLedger。

JSON 文件或自制 append log 看似少一个数据库，实际还要重新实现事务提交、fsync、进程锁、CAS、迁移、备份与损坏恢复，因此不作为内置生产选项。SQLite 是总系统复杂度最低的 reference default，而不是唯一可能的后端。

## 包与公开边界

| 入口 | 面向谁 | 职责 |
|---|---|---|
| `@ordarium/core` | **默认入口**：宿主与框架作者 | Action/Host/Ledger port、Runtime、状态/恢复语义、管理型 state（`createStateStore`）与变更订阅（`StateChangeFeed`/`supportsStateChangeFeed`）、MemoryLedger、Operations |
| `@ordarium/ledger-sqlite` | 需要默认 durable 实现的嵌入者 | WAL、事务性 semantic CAS、独立 LiveLease、history、state 修订链与定序表（schema v4）、前向 migration、backup |
| `@ordarium/host-mcp` | MCP 客户端 harness / 宿主 | MCP server 适配叶包：tools 面映射到 HostInvocationPort，ops 工具受权暴露 |
| `@ordarium/host-kit` | **自建宿主适配者** | versioned Host Adapter：`assertHostContract` exact-match 握手 + curated 适配面 + `runHostAdapterConformance` runner re-export |
| `@ordarium/testing` | Action 与 adapter 作者 | crash checkpoint、手动时钟、固定 identity、ledger/Provider/宿主 conformance（含 state 与变更订阅） |
| `@ordarium/dsh` · `/advanced` | **legacy**：既有 DSH 集成 | 最初的 DSH 宿主适配（`installOrdarium`、per-action binding、官方插件壳与运维面）。**已冻结**：无新能力、不推荐新接入，仅为既有消费者保留 |

内核包是四个（core / ledger-sqlite / dsh / testing），宿主适配以**叶包**加入（host-mcp / host-kit，以及 legacy 的 dsh）——新增宿主只加叶包，内核与 Action 合同零改动。`@ordarium/dsh/advanced` 是同一个包的 subpath，不是第五个内核包。core 的根入口不做宿主判断：宿主差异全部经由 `HostInvocationPort` 注入。

## 安全与宿主边界

宿主保留自己的 Agent Loop、Tool Pipeline、Approval、Credentials、Sandbox、Session、Client Surface 与 lifecycle 管理；Ordarium 只接收宿主注入的 identity、`host-admission | policy-decision | human-approval` evidence、cancellation signal 与短暂 credential/principal reference。它不实现第二套审批、安全沙箱或生命周期引擎。

Ledger 不保存 raw input、raw business key、credential、任意 stack 或未筛选 Provider response。可持久化 output/receipt 先经过 schema、JSON 与默认 1 MiB 单值上限；Provider principal 最多保存稳定 digest，不保存 credential。

## 明确不做

- Agent Loop、模型 Provider、Prompt/Context assembly；
- **多 agent 调度器或编排引擎**（多 agent 协作安全通过 identity/命名空间合同与共账拓扑提供）；
- 任何宿主的 Approval、Credentials、Sandbox、Session、Client Surface 或 lifecycle 实现（含 DSH 的 Cordis 生命周期）；
- worker 协议、远程调度、Rust Runner、独立 daemon 或默认控制平面；
- workflow、subagent scheduler 或 Palimpsest Runtime；
- 默认多主机 authority、分布式共识或 secret vault。

## 开发者文档

写插件、选 profile、查报错、做运维、观测 state——十一篇按角色组织的指南（快速开始、核心概念、effect profiles、错误码全表、授权、ledger、运维面、宿主、测试、生命周期与恢复、管理型 state 与变更订阅）：**[docs/dev/](docs/dev/README.md)**。不需要先读维护合同 12–19。

## 安装（GitHub 分发）

分发渠道为 GitHub（分发决议见 `evidence/G7/release-candidate-report.md` §5）。本工程为独立仓库（https://github.com/orangeofcarl0-sys/ordarium），六包位于 `packages/`，版本锚为 git tag（`ordarium-v1.0.0` → `ordarium-v1.3.1`）与同名 GitHub Release（自 `ordarium-v1.2.0` 起为六 tarball）。两种消费方式（pnpm 场景另有**工作区成员模式**，见 [docs/dev/01](docs/dev/01-getting-started.md)）：

**方式一：同 workspace 开发（推荐起步；Palimpsest 复兴插件即此路径）**

```bash
git clone https://github.com/orangeofcarl0-sys/ordarium.git
cd ordarium && pnpm install && pnpm run build
# 你的插件工程依赖本 workspace（pnpm workspace 链接或 path 协议引入）
```

**方式二：GitHub Release 六 tarball 一次安装**（六包互相依赖自洽性即 `pnpm test:package` 验证的内容）

```bash
pnpm add <release-assets>/ordarium-{core,ledger-sqlite,dsh,testing,host-mcp,host-kit}-1.3.1.tgz
```

私有期下载 Release 资产需带 token；转公开后 URL（`https://github.com/orangeofcarl0-sys/ordarium/releases/download/ordarium-v1.3.1/<name>.tgz`）直接可用。

> 已知限制（如实记录）：`pnpm add github:...#path=packages/dsh` 式单包 git 依赖暂不可用——包间 `workspace:*` 依赖在 git 安装语境无法解析；多包消费走上述两种方式。公共 npm 发布仍是未来第三选项（触发条件见 G7 报告）。

## 开发验证与 Node 政策

```powershell
pnpm install
pnpm check
pnpm verify:architecture
```

`pnpm verify:architecture`（G0 起生效）机器校验包依赖图与禁止边、public API 快照、错误码/状态 union、SQLite schema 基线与 Compatibility Register。任何漂移必须先在 `evidence/` 附 Architecture Delta Sheet，再用 `pnpm snapshots:update` 重新生成快照并一起提交。

六包发布线为 **`1.3.1`**（正式线；MIT；1.1.0 起为 G11 管理型 state kind、1.2.0 为 G18 host-kit、1.3.x 为 ORD-BOOT-0/0.1 变更订阅——每版档位与消费者可见变化见 [`docs/19-release-history.md`](docs/19-release-history.md)，发布沟通纪律见 [`docs/18`](docs/18-release-compat-policy.md)）。engines 分层：`ledger-sqlite` / `dsh` / `host-mcp` 为 Node.js `>=24.15.0`（携带 `node:sqlite` 的那一层），`core` / `testing` / `host-kit` 为 `>=24.0.0`；Docker 矩阵（24.15.0 下限 + 当前 24.x）已闭环（`evidence/G7/node-matrix-report.md`，最新复跑见 `evidence/ORD-BOOT-0.1/exit-report.md` §5），可用 `pnpm verify:matrix` 复跑。

完整合同、实施状态、架构、阶段验收与发布史见 [`docs/12-ordarium-product-baseline.md`](docs/12-ordarium-product-baseline.md)、[`docs/13-ordarium-action-contract.md`](docs/13-ordarium-action-contract.md)、[`docs/14-ordarium-implementation-plan.md`](docs/14-ordarium-implementation-plan.md)、[`docs/15-ordarium-complete-architecture.md`](docs/15-ordarium-complete-architecture.md)、[`docs/16-ordarium-mermaid-architecture-atlas.md`](docs/16-ordarium-mermaid-architecture-atlas.md)、[`docs/17-ordarium-goals-and-acceptance.md`](docs/17-ordarium-goals-and-acceptance.md)、[`docs/18-release-compat-policy.md`](docs/18-release-compat-policy.md) 与 [`docs/19-release-history.md`](docs/19-release-history.md)。
