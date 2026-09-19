# Failure Lab · Crash after the Provider commits

这是 Ordarium 最重要的入门实验。

目标不是看 happy path，而是制造这个窗口：

```text
Ordarium: dispatched 已持久化
        ↓
Provider: effect 已 durable commit
        ↓
💥 Node process 立即退出
        ↓
Ordarium: succeeded 还没来得及持久化
```

然后重启同一调用。

## 先理解为什么这是“最坏位置”

如果 crash 发生在 Provider 调用之前：

```text
没产生 effect
→ 很容易恢复
```

如果 crash 发生在 succeeded 已经持久化之后：

```text
结果已知
→ replay 直接读 durable outcome
```

最困难的是中间：

```text
external world 可能已经变了
local world 还没写 terminal truth
```

Ordarium 的整个 recovery contract 就是为这个窗口服务的。

## 一个可运行的 fake Provider

下面的 Provider 用 JSON 文件模拟“外部系统已经 durable commit”，并按 idempotency key 去重。

```ts
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const PROVIDER_FILE = "./fake-provider.json";

type ProviderDb = {
  byKey: Record<string, {
    chargeId: string;
    orderId: string;
    amount: number;
  }>;
};

async function readProvider(): Promise<ProviderDb> {
  try {
    return JSON.parse(
      await readFile(PROVIDER_FILE, "utf8"),
    ) as ProviderDb;
  } catch {
    return { byKey: {} };
  }
}

async function chargeProvider(
  input: { orderId: string; amount: number },
  idempotencyKey: string,
) {
  const db = await readProvider();

  const existing = db.byKey[idempotencyKey];
  if (existing) {
    console.log("provider: deduplicated", existing);
    return existing;
  }

  const created = {
    chargeId: randomUUID(),
    ...input,
  };

  db.byKey[idempotencyKey] = created;
  await writeFile(
    PROVIDER_FILE,
    JSON.stringify(db, null, 2),
  );

  console.log("provider: COMMITTED", created);

  if (process.env.CRASH_AFTER_PROVIDER === "1") {
    console.error("💥 process exits after provider commit");
    process.exit(42);
  }

  return created;
}
```

注意：`process.exit(42)` 发生在 Provider 文件已经写完之后、Action return 之前。

这正是我们要模拟的故障。

## 把它包装成 idempotent Action

```ts
import {
  OrdariumRuntime,
  defineAction,
  effects,
  schema,
} from "@ordarium/core";
import { SqliteLedger } from "@ordarium/ledger-sqlite";

const charge = defineAction({
  name: "payment.charge",
  version: "1",
  description: "Charge one order",

  input: schema.object({
    orderId: schema.string(),
    amount: schema.number(),
  }),

  output: schema.object({
    chargeId: schema.string(),
    orderId: schema.string(),
    amount: schema.number(),
  }),

  effect: effects.idempotent(),

  execute(input, context) {
    return chargeProvider(
      input,
      context.idempotencyKey,
    );
  },
});

const runtime = new OrdariumRuntime({
  ledger: new SqliteLedger("./ordarium-lab.sqlite"),
  leaseMs: 250,
});

const identity = {
  source: "failure-lab",
  scope: "checkout",
  callId: "order-42-charge",
};

const authorization = {
  decision: "allow" as const,
  kind: "host-admission" as const,
  source: "failure-lab",
};

const result = await runtime.run(
  charge,
  { orderId: "order-42", amount: 1999 },
  { identity, authorization },
);

console.log("ordarium result:", result);
await runtime.dispose();
```

## Run 1 — crash

```bash
rm -f fake-provider.json ordarium-lab.sqlite*

CRASH_AFTER_PROVIDER=1 node dist/failure-lab.js
```

你应该看到：

```text
provider: COMMITTED {...}
💥 process exits after provider commit
```

外部 effect 已经存在。

但是 Ordarium 没有机会写 `succeeded`。

## Run 2 — same logical call

等待 lease 过期，然后：

```bash
sleep 1
node dist/failure-lab.js
```

因为 Action 声明 `idempotent()`，normal recovery 可以在有效 operation-key contract 下 **使用同一个 idempotency key redispatch**。

Fake Provider 看到同一个 key：

```text
provider: deduplicated {...}
```

不会创建第二笔 charge。

## 现在把 profile 改成 `guarded()`

只改：

```ts
effect: effects.guarded()
```

同时让 Provider 忽略 idempotency key。

重复 crash 实验。

第二次 invocation 不应该再次调用 Provider 来“试试看”。

正确结果是：

```text
OPERATION_UNCERTAIN
```

因为：

```text
Provider 可能已经 commit
+
没有 safe same-key replay
+
没有 authoritative query
=
不能证明第二次 execute 安全
```

## 再改成 `reconcilable()`

假设 Provider 能按稳定业务键查询：

```ts
reconcile: async (input) => {
  const charge = await provider.findByOrderId(input.orderId);

  if (charge) {
    return {
      status: "succeeded",
      value: charge,
    };
  }

  return {
    status: "absent",
    retrySafe: true,
  };
}
```

Recovery 会：

```text
query first
→ Provider says succeeded
→ persist recovered result
→ no second charge
```

## 这个 Lab 真正教了什么

不是“Ordarium 可以 retry”。

而是：

```text
同一个 crash
在不同 Provider capability 下
正确恢复动作完全不同
```

| Contract | Restart behavior |
|---|---|
| `guarded` | 不 blind retry；保持 uncertain |
| `idempotent` | same-key redispatch |
| `reconcilable` | query first |

这就是 EffectProfile 存在的原因。

## 下一步

根据你实际 Provider：

- [Idempotency-key tutorial](../tutorials/provider-idempotency-key.md)
- [Reconciliation tutorial](../tutorials/provider-reconciliation.md)
- [No recovery primitive tutorial](../tutorials/no-recovery-primitive.md)
