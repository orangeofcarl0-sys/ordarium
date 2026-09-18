# 01 · Getting started

## 前置条件

- `@ordarium/core` / `@ordarium/testing` / `@ordarium/host-kit`：Node.js `>=24.0.0`；
- `@ordarium/ledger-sqlite` / `@ordarium/host-mcp`：Node.js `>=24.15.0`；
- 一个能提供稳定 invocation identity 的宿主或 Node 进程；
- 仓库开发使用 pnpm。

当前已发布线是 **1.3.1**（tag `ordarium-v1.3.1`）；工作区已 bump 到 **1.3.2**（含 `@deprecated` 标记），待发布。分发渠道是 GitHub tags / Releases。

## 仓库开发

```bash
git clone https://github.com/orangeofcarl0-sys/ordarium.git
cd ordarium
pnpm install
pnpm build
pnpm check
```

消费时应让全部 `@ordarium/*` 保持在同一 release line。

## 定义第一个 Action

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

  effect: effects.idempotent(),

  async execute(input, context) {
    return provider.createTicket(input, {
      idempotencyKey: context.idempotencyKey,
      signal: context.signal,
    });
  },
});

const runtime = new OrdariumRuntime({
  ledger: new SqliteLedger("/var/lib/myapp/ordarium.sqlite"),
});
```

Action 合同告诉 Ordarium：

```text
它叫什么
它是哪一版
输入/输出是什么
它会产生什么类型的 effect
如何执行
以及可选的 key / reconcile / cancel / receipt
```

## 运行

Managed write 需要稳定 identity 与授权证据：

```ts
const output = await runtime.run(
  createTicket,
  { title: "Printer is on fire" },
  {
    identity: {
      source: "myapp",
      scope: "session-42",
      callId: "tool-call-7",
    },

    authorization: {
      decision: "allow",
      kind: "host-admission",
      source: "myapp:tool-admission",
    },
  },
);
```

默认 logical key：

```text
source + scope + callId
```

如果业务本身有更强的稳定键，可以显式定义：

```ts
const reserve = defineAction({
  // ...
  key: (input) => `reservation:${input.orderId}`,
});
```

自定义 `key()` 会替代默认 invocation key，成为 Operation identity 的业务基础。

## Direct runtime 与 Host Adapter

应用内部直接嵌入时，可以调用：

```text
runtime.run(...)
```

可复用宿主适配则应通过：

```text
HostInvocationPort
```

宿主负责把原生 tool call 映射为：

- `InvocationIdentity`；
- 分类后的 authorization；
- 可选 provider principal；
- cancellation signal。

写新宿主时使用 `@ordarium/host-kit` 对齐 `HOST_CONTRACT_VERSION` 并运行 host conformance。见 [08 · Hosts](08-hosts.md)。

## 第一天就应该测什么

不要只测 happy path。至少测试：

1. 相同 identity + 相同 input 的 replay；
2. 相同 identity + 不同 input 的冲突；
3. authorization allow / deny / conflict；
4. dispatch 后崩溃；
5. 两个 worker 并发处理同一 Operation；
6. 当前 effect profile 的恢复路径。

使用 [`@ordarium/testing`](09-testing.md) 做 fault/conformance，而不是靠手工 mock 猜测恢复行为。

## 下一步

- [02 · Core concepts](02-core-concepts.md)
- [03 · Effect profiles](03-effect-profiles.md)
- [05 · Authorization](05-authorization.md)
- [10 · Lifecycle & recovery](10-lifecycle-and-recovery.md)
