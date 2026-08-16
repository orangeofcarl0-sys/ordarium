# Ordarium

Ordarium 是**多 agent harness 的公共基石**：一个轻量、可嵌入、host-neutral 的 **Safe Action SDK + Effect Authority**。它不运行 Agent、不组装 Prompt、不调度或编排 agent，也不替代任何宿主 harness；它只包住真正会产生副作用的 Action，使一次调用具备稳定身份、分类授权证据、持久状态、并发所有权和诚实的崩溃恢复语义。DSH 是首个宿主；发布前以真实第二宿主（`@ordarium/host-mcp`）与宿主 conformance harness 机器证明内核中立，多个 agent/进程/宿主可共享同一本地 ledger（共账拓扑）。

> 当前发布线为 `1.0.0`（正式线，MIT；G0–G9 验收完成，见 `evidence/G7/release-candidate-report.md` 与 `evidence/G9/exit-report.md`）。**分发渠道为 GitHub**（DSH 插件生态惯例）：本仓库即包源，以 git tag（`ordarium-v1.0.0`）为版本锚；公共 npm 发布推迟至 DSH 公开后。

## 为什么安装

普通 Harness 能告诉你“工具被调用过”，却通常无法可靠回答：

- 进程在远端成功后、本地记账前崩溃，这次调用到底成功了吗？
- 相同 tool call 被 session replay 或 subagent transport 再次投递时，是否会重复扣款、发消息或创建资源？
- 两个进程同时接到同一调用时，谁拥有执行权？
- Provider 不支持幂等键或查询时，系统会不会把未知结果当失败并盲重试？

Ordarium 把这些判断从每个插件各自的 `try/catch` 中抽出来，形成一个小而明确的公共合同。纯读取工具通常不需要安装它；有不可逆或昂贵副作用、需要 crash/replay 恢复的插件才是核心用户。

## 最短路径

普通 DSH 插件只安装 `@ordarium/dsh`。根入口是精选 author façade；默认 managed 模式使用进程内嵌的本地 SQLite，不需要 daemon、端口或控制平面。

```ts
import {
  defineAction,
  effects,
  installOrdarium,
  schema,
} from "@ordarium/dsh";

const createTicket = defineAction({
  name: "ticket.create",
  version: "1",
  description: "Create one support ticket",
  input: schema.object({ title: schema.string({ minLength: 1 }) }),
  output: schema.object({ id: schema.string() }),
  effect: effects.idempotent(),
  async execute(input, context) {
    return api.createTicket(input, {
      idempotencyKey: context.idempotencyKey,
      signal: context.signal,
    });
  },
});

const ordarium = installOrdarium(ctx, { actions: [createTicket] });
```

`effects.idempotent()` 表示 Provider 能证明 durable operation-key idempotency；有限窗口必须显式写成 `effects.idempotent({ window: { kind: "finite", expiresAfterMs } })`。Finite deadline 在 operation 首次创建时冻结，重启或重试不会续期。

默认数据库位于 `$DSH_HOME/ordarium/operations.sqlite`，未设置 `DSH_HOME` 时使用 `~/.dsh/ordarium/operations.sqlite`。

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

## SQLite 是否必需

**不绝对必需。** Core 只依赖 `OperationLedgerPort + LedgerCapabilities`，不把 SQLite 写进 Action 或 Operation 语义。

| 选择 | 合法用途 | 不能承诺 |
|---|---|---|
| 默认 `@ordarium/ledger-sqlite` | 本机 crash-durable managed write、本机多进程协调、历史与恢复 | 网络文件系统或多主机共识 |
| `MemoryLedger` | 单 isolate 测试、纯读取、显式 `unmanaged` | crash/restart recovery、跨进程 claim |
| conformant custom/host ledger | 高级嵌入、宿主已有 durable store | 未通过 capability/codec/lease/history conformance 的 managed guarantee |

Runtime 在创建 managed operation 前检查 durability、coordination、semantic CAS、live lease 与 history 能力。能力不足或 durable ledger 打开失败会返回 `LEDGER_CAPABILITY_REQUIRED`，Provider 不会被调用；系统绝不静默 fallback 到 MemoryLedger。

JSON 文件或自制 append log 看似少一个数据库，实际还要重新实现事务提交、fsync、进程锁、CAS、迁移、备份与损坏恢复，因此不作为内置生产选项。SQLite 是总系统复杂度最低的 reference default，而不是唯一可能的后端。

## 包与公开边界

| 入口 | 面向谁 | 职责 |
|---|---|---|
| `@ordarium/dsh` | 普通 DSH 插件作者 | `defineAction`、`effects`、`schema/defineSchema`、`installOrdarium` 与必要作者类型 |
| `@ordarium/dsh/advanced` | 高级 DSH 集成作者 | per-action binding、Operations binding、custom ledger、lifecycle tuning |
| `@ordarium/core` | 宿主与框架作者 | Action/Host/Ledger port、Runtime、状态/恢复语义、MemoryLedger、Operations |
| `@ordarium/ledger-sqlite` | 需要默认 durable 实现的嵌入者 | WAL、事务性 semantic CAS、独立 LiveLease、history、migration/backup |
| `@ordarium/host-mcp`（发布门） | MCP 客户端 harness / 宿主 | MCP server 适配叶包：tools 面映射到 HostInvocationPort，ops 工具受权暴露 |
| `@ordarium/testing` | Action 与 adapter 作者 | crash checkpoint、手动时钟、固定 identity、ledger/Provider/宿主 conformance |

根入口不会暴露 Runtime、Ledger、raw record 或 migration。需要这些能力的框架作者必须显式选择 advanced subpath 或对应低层包；Operations 仍留在 core，不拆第五个运行时包。

## 安全与宿主边界

DSH 的 Agent Loop、Tool Pipeline、Approval、Credentials、Sandbox、Session、Client Surface、HMR 与 Cordis lifecycle 继续包围 Ordarium。Ordarium 只接收宿主注入的 identity、`host-admission | policy-decision | human-approval` evidence、cancellation signal 与短暂 credential/principal reference；它不实现第二套审批、安全沙箱或生命周期引擎。

Ledger 不保存 raw input、raw business key、credential、任意 stack 或未筛选 Provider response。可持久化 output/receipt 先经过 schema、JSON 与默认 1 MiB 单值上限；Provider principal 最多保存稳定 digest，不保存 credential。

## 明确不做

- Agent Loop、模型 Provider、Prompt/Context assembly；
- **多 agent 调度器或编排引擎**（多 agent 协作安全通过 identity/命名空间合同与共账拓扑提供）；
- 任何宿主的 Approval、Credentials、Sandbox、Session、Client Surface、HMR 或 Cordis 生命周期的替代实现；
- worker 协议、远程调度、Rust Runner、独立 daemon 或默认控制平面；
- workflow、subagent scheduler 或 Palimpsest Runtime；
- 默认多主机 authority、分布式共识或 secret vault。

## 安装（GitHub 分发）

分发渠道为 GitHub（DSH 插件生态惯例；分发决议见 `evidence/G7/release-candidate-report.md` §5）。本工程已拆分为独立仓库（https://github.com/orangeofcarl0-sys/ordarium），五包位于 `packages/`，版本锚为 git tag（首个 `ordarium-v1.0.0`）与同名 GitHub Release。两种消费方式：

**方式一：同 workspace 开发（推荐起步；Palimpsest 复兴插件即此路径）**

```bash
git clone https://github.com/orangeofcarl0-sys/ordarium.git
cd ordarium && pnpm install && pnpm run build
# 你的插件工程依赖本 workspace（pnpm workspace 链接或 path 协议引入）
```

**方式二：GitHub Release 五 tarball 一次安装**（五包互相依赖自洽性即 `pnpm test:package` 验证的内容）

```bash
pnpm add <release-assets>/ordarium-{core,ledger-sqlite,dsh,testing,host-mcp}-1.0.0.tgz
```

私有期下载 Release 资产需带 token；转公开后 URL（`https://github.com/orangeofcarl0-sys/ordarium/releases/download/ordarium-v1.0.0/<name>.tgz`）直接可用。

> 已知限制（如实记录）：`pnpm add github:...#path=packages/dsh` 式单包 git 依赖暂不可用——包间 `workspace:*` 依赖在 git 安装语境无法解析；多包消费走上述两种方式。公共 npm 发布仍是未来第三选项（触发条件见 G7 报告）。

## 开发验证与 Node 政策

```powershell
pnpm install
pnpm check
pnpm verify:architecture
```

`pnpm verify:architecture`（G0 起生效）机器校验包依赖图与禁止边、public API 快照、错误码/状态 union、SQLite schema 基线与 Compatibility Register。任何漂移必须先在 `evidence/` 附 Architecture Delta Sheet，再用 `pnpm snapshots:update` 重新生成快照并一起提交。

五包发布线为 `1.0.0`（正式线；MIT）。engines 分层：ledger-sqlite / dsh / host-mcp 为 Node.js `>=24.15.0`，core / testing 为 `>=24.0.0`；Docker 矩阵（24.15.0 下限 + 当前 24.x）已在 `evidence/G7/node-matrix-report.md` 闭环，可用 `pnpm verify:matrix` 复跑。

完整合同、实施状态、架构与阶段验收见 [`docs/12-ordarium-product-baseline.md`](docs/12-ordarium-product-baseline.md)、[`docs/13-ordarium-action-contract.md`](docs/13-ordarium-action-contract.md)、[`docs/14-ordarium-implementation-plan.md`](docs/14-ordarium-implementation-plan.md)、[`docs/15-ordarium-complete-architecture.md`](docs/15-ordarium-complete-architecture.md)、[`docs/16-ordarium-mermaid-architecture-atlas.md`](docs/16-ordarium-mermaid-architecture-atlas.md) 与 [`docs/17-ordarium-goals-and-acceptance.md`](docs/17-ordarium-goals-and-acceptance.md)。
