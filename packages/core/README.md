# @ordarium/core

Ordarium 的 host-neutral kernel。

这个包用于：

- 定义 Action；
- 运行 effect-authority runtime；
- 接入 custom ledger / host；
- 使用 revisioned management state；
- 观察 durable Operations。

## 主要公开面

```text
defineAction
effects
schema / defineSchema
OrdariumRuntime

HostInvocationPort

OperationLedger
LedgerCapabilities
MemoryLedger

createOperations

createStateStore
supportsStateChangeFeed

HOST_CONTRACT_VERSION
assertHostContract

OrdariumError family
```

## 最小示例

```ts
import {
  OrdariumRuntime,
  defineAction,
  effects,
  schema,
} from "@ordarium/core";

const lookup = defineAction({
  name: "catalog.lookup",
  version: "1",
  description: "Read one catalog item",

  input: schema.object({
    id: schema.string(),
  }),

  output: schema.object({
    id: schema.string(),
  }),

  effect: effects.readOnly(),

  execute: ({ id }) =>
    provider.lookup(id),
});

const runtime = new OrdariumRuntime();

const result = await runtime.run(
  lookup,
  { id: "42" },
);
```

Managed write 请使用满足 capability 的 durable ledger（默认 reference 为 `@ordarium/ledger-sqlite`），并提供稳定 identity 与 authorization evidence。

完整入口见仓库 [README](../../README.md) 与 [Developer Guide](../../docs/dev/README.md)。
