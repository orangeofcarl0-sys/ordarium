# 01 · 快速开始

## 前置条件

- DSH 宿主（插件运行环境）；纯宿主/测试场景可直接用 core；
- Node.js：`@ordarium/ledger-sqlite`、`@ordarium/dsh`、`@ordarium/host-mcp` 要求 **`>=24.15.0`**；`@ordarium/core`、`@ordarium/testing` 仅要求 `>=24.0.0`；
- pnpm。

## 安装

分发渠道为 GitHub（DSH 插件生态惯例）。两种方式：

**方式一：同 workspace 开发（推荐起步）**

```bash
git clone https://github.com/orangeofcarl0-sys/ordarium.git
cd ordarium && pnpm install && pnpm run build
# 你的插件工程依赖本 workspace（pnpm workspace 链接或 path 协议引入）
```

**方式二：GitHub Release 五 tarball 一次安装**

```bash
pnpm add <release-assets>/ordarium-{core,ledger-sqlite,dsh,testing,host-mcp}-1.0.0.tgz
```

私有期下载 Release 资产需带 token；转公开后 URL 直接可用。五包互相依赖自洽（这正是 CI 里 `pnpm test:package` 验证的内容）。

> 已知限制：`pnpm add github:...#path=packages/dsh` 式**单包** git 依赖暂不可用——包间 `workspace:*` 依赖在 git 安装语境无法解析。多包消费请用上述两种方式。

## 第一个 Action

一个 Action = 一次可能产生外部副作用的工作单元。你要做的只有三件事：声明合同、选 effect profile、实现 `execute`。

```ts
import {
  defineAction,
  effects,
  installOrdarium,
  schema,
} from "@ordarium/dsh";

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

// 安装：普通插件作者的唯入口
const ordarium = installOrdarium(ctx, { actions: [createTicket] });
```

从这一刻起，`ticket.create` 的每次调用都会：获得稳定身份 → 记录分类授权 → 在调用 Provider **之前**持久化 `dispatched` → 执行 → 写入终态或诚实的 `uncertain`。

## 验证它在保护你

试两件事：

1. **重放**：用同一个 `callId` 再调用一次——不会第二次执行，直接返回已持久化的结果；
2. **崩溃**：在 `execute` 里 `throw`——工具不会伪装失败：状态停在 `uncertain`，日志里是 `OPERATION_UNCERTAIN`，Ordarium 拒绝盲目重试。下次相同调用会走恢复流程（见 [10](10-lifecycle-and-recovery.md)）。

## 数据存在哪

默认 managed 模式使用内嵌 SQLite：`$DSH_HOME/ordarium/operations.sqlite`（未设置 `DSH_HOME` 时为 `~/.dsh/ordarium/operations.sqlite`）。ledger 里只有摘要与安全载荷——没有原始输入、凭据或堆栈（见 [02](02-core-concepts.md)#secret-边界）。

## 下一步

- 理解 [02 核心概念](02-core-concepts.md)：operation 身份与状态机；
- 为你的 Provider 选对 [03 effect profile](03-effect-profiles.md)——这是你做的最重要的决定；
- 把 [04 错误码表](04-errors.md)放进书签，出错时按"调用者动作"列处理。
