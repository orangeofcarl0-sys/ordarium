# @ordarium/ledger-sqlite

Ordarium 的 reference crash-durable local `OperationLedger`。

```ts
import { OrdariumRuntime } from "@ordarium/core";
import { SqliteLedger } from "@ordarium/ledger-sqlite";

const ledger = new SqliteLedger(
  "/var/lib/myapp/ordarium.sqlite",
);

const runtime = new OrdariumRuntime({
  ledger,
  deploymentCoordination: "local-multi-process",
});
```

## 提供

- crash-durable Operation / State records；
- semantic CAS；
- atomic claim + live lease；
- 本机多进程 coordination；
- semantic Operation history；
- revisioned management state；
- StateRef index；
- durable state-change ordering/cursor；
- forward migrations。

当前：

```text
SQLite user_version = 4
```

这个包不把 SQLite 变成 multi-host consensus system。

它的定位是：

```text
local embedded durability
+
local multi-process coordination
```

见 [06 · Ledgers](../../docs/dev/06-ledgers.md)。
