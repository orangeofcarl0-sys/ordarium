# 01 · 快速开始

## 前置条件

- 一个要接入的宿主（任意 Node harness：自建 / MCP / DSH 等）——若只是嵌入或测试，直接用 `@ordarium/core` 即可，不必先有宿主；
- Node.js：`@ordarium/ledger-sqlite`、`@ordarium/host-mcp`、`@ordarium/dsh`（legacy）要求 **`>=24.15.0`**；`@ordarium/core`、`@ordarium/testing`、`@ordarium/host-kit` 要求 `>=24.0.0`；
- pnpm。

## 安装

分发渠道为 GitHub。三种方式：

**方式一：同 workspace 开发（推荐起步）**

```bash
git clone https://github.com/orangeofcarl0-sys/ordarium.git
cd ordarium && pnpm install && pnpm run build
# 你的插件工程依赖本 workspace（pnpm workspace 链接或 path 协议引入）
```

**方式二：GitHub Release 六 tarball 一次安装（npm）**

```bash
pnpm add <release-assets>/ordarium-{core,ledger-sqlite,dsh,testing,host-mcp,host-kit}-1.3.1.tgz
```

私有期下载 Release 资产需带 token；转公开后 URL 直接可用。六包互相依赖自洽（这正是 CI 里 `pnpm test:package` 验证的内容）。

**方式三：pnpm 工作区成员消费（pnpm 宿主工程场景）**

pnpm **无法**从同批 tarball 解析兄弟依赖（对 `@ordarium/core@1.3.1` 直奔 registry 404），方式二只适用于 npm。pnpm 消费者把 Release 资产解包为本地目录并改写为 workspace 成员：

```bash
mkdir ordarium-pkgs && cd ordarium-pkgs
for p in core ledger-sqlite dsh testing host-mcp host-kit; do
  mkdir -p $p && tar -xzf <release-assets>/ordarium-$p-1.3.1.tgz -C $p
done
# 把每个包 package.json 里包间的 @ordarium/* 依赖从 ^1.3.1 改写回 workspace:*
# （含 devDependencies——host-mcp 的 devDeps 里有 @ordarium/dsh）
```

然后把六个解包目录加入消费工程的 `pnpm-workspace.yaml` 的 `packages` 列表，`pnpm install --no-frozen-lockfile`。发布 tarball 本体不动，改写只发生在本地解包副本。如果你只需要 core + 一个宿主叶包，可以只解包 `core`/`ledger-sqlite`/`host-kit`（或 `host-mcp`）三个。

> 版本锚随发布线推进：当前为 **1.3.1**（`ordarium-v1.3.1`）。逐版台账见 [`../19-release-history.md`](../19-release-history.md)。

> 已知限制：`pnpm add github:...#path=packages/dsh` 式**单包** git 依赖暂不可用——包间 `workspace:*` 依赖在 git 安装语境无法解析。多包消费请用上述两种方式。

## 第一个 Action

一个 Action = 一次可能产生外部副作用的工作单元。你要做的只有三件事：声明合同、选 effect profile、实现 `execute`。

```ts
import { OrdariumRuntime, defineAction, effects, schema } from "@ordarium/core";
import { SqliteLedger } from "@ordarium/ledger-sqlite";

const createTicket = defineAction({
  name: "ticket.create",          // 稳定的小写命名空间标识
  version: "1",                    // 语义边界：不兼容改动必须升版本
  description: "Create one support ticket",
  input: schema.object({
    title: schema.string({ minLength: 1 }),
  }),
  output: schema.object({
    id: schema.string(),
  }),
  effect: effects.idempotent(),    // Provider 真正尊重稳定幂等键
  async execute(input, context) {
    return provider.createTicket(input, {
      // 两个关键参数由 Ordarium 提供：
      idempotencyKey: context.idempotencyKey,  // 稳定：重试/重放时不变
      signal: context.signal,                  // 组合了取消与租约丢失
    });
  },
});

const runtime = new OrdariumRuntime({
  ledger: new SqliteLedger("/var/lib/myapp/ordarium/operations.sqlite"),
});

// 直接调用（嵌入场景）：
await runtime.run(createTicket, { title: "printer is on fire" }, {
  identity: { source: "myapp", scope: sessionId, callId },
  authorization: { decision: "allow", kind: "host-admission", source: "myapp:approval" },
});
```

**在宿主里运行时**，不要让宿主代码到处 `runtime.run`——把 `runtime.invoke` 作为 `HostInvocationPort` 交给宿主，宿主负责注入 identity、授权证据与取消信号。自建宿主用 `@ordarium/host-kit` 对齐宿主合同版本并提供 conformance 证据；现成叶包：`@ordarium/host-mcp`（MCP 协议）。

> **旧路径（legacy）**：如果你维护的是既有 DSH 集成，`@ordarium/dsh`（`installOrdarium(ctx, { actions })`）与 `@ordarium/dsh/advanced` 仍然可用但**已冻结**；新接入请走上面的 host-neutral 路径。

从这一刻起，`ticket.create` 的每次调用都会：获得稳定身份 → 记录分类授权 → 在调用 Provider **之前**持久化 `dispatched` → 执行 → 写入终态或诚实的 `uncertain`。

## 验证它在保护你

试两件事：

1. **重放**：用同一个 `callId` 再调用一次——不会第二次执行，直接返回已持久化的结果；
2. **崩溃**：在 `execute` 里 `throw`——工具不会伪装失败：状态停在 `uncertain`，日志里是 `OPERATION_UNCERTAIN`，Ordarium 拒绝盲目重试。下次相同调用会走恢复流程（见 [10](10-lifecycle-and-recovery.md)）。

## 数据存在哪

默认 managed 模式使用进程内嵌的 SQLite：库路径由你的宿主决定（上例写死绝对路径；DSH 适配为 `$DSH_HOME/ordarium/operations.sqlite`）。ledger 里只有摘要与安全载荷——没有原始输入、凭据或堆栈（见 [02](02-core-concepts.md)#secret-边界）。

## 下一步

- 理解 [02 核心概念](02-core-concepts.md)：operation 身份与状态机；
- 为你的 Provider 选对 [03 effect profile](03-effect-profiles.md)——这是你做的最重要的决定；
- 把 [04 错误码表](04-errors.md)放进书签，出错时按"调用者动作"列处理。
