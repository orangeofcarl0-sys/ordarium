# Quickstart · Protect one side effect in 5 minutes

这页不先解释 Ordarium 的所有对象。我们只做一件事：**保护一次外部 API 写操作。**

## 0. 你现在有这样的代码

```ts
async function createTicket(title: string) {
  return ticketApi.create({ title });
}
```

Happy path 没问题。

真正的问题是：

```text
Provider create 成功
→ response 丢失 / 进程崩溃
→ 你的函数没有返回
→ 上层 retry
→ 是否又创建一张 ticket？
```

普通 Promise 的类型回答不了这个问题。

## 1. 把这个调用声明成 Action

```ts
import {
  defineAction,
  effects,
  schema,
} from "@ordarium/core";

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

  execute(input, context) {
    return ticketApi.create(input, {
      idempotencyKey: context.idempotencyKey,
      signal: context.signal,
    });
  },
});
```

这里最重要的不是 `defineAction` 本身，而是：

```text
effect: effects.idempotent()
```

这句话只有在 **Provider 真正接受稳定 idempotency key** 时才成立。

如果你的 Provider 没这个能力，先去 [Choose a profile](choose-a-profile.md)，不要照抄。

## 2. 给 Action 一个 durable Runtime

```ts
import { OrdariumRuntime } from "@ordarium/core";
import { SqliteLedger } from "@ordarium/ledger-sqlite";

const runtime = new OrdariumRuntime({
  ledger: new SqliteLedger(
    "/var/lib/myapp/ordarium.sqlite",
  ),
});
```

现在执行证据不会只存在于当前 JS Promise / 内存变量里。

## 3. 给这次调用稳定 identity

```ts
const result = await runtime.run(
  createTicket,
  { title: "Printer is on fire" },
  {
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
  },
);
```

默认情况下：

```text
source + scope + callId
```

定义 logical work identity。

因此同一 tool call 被 transport replay 时，不会自动变成“另一项工作”。

## 4. Ordarium 多做了什么？

你写的是：

```text
runtime.run(action, input, identity, authorization)
```

Runtime 实际维护的是：

```text
schema parse
→ ledger capability check
→ derive stable Operation ID
→ create/load durable Operation
→ persist authorization
→ acquire claim + lease + fencing token
→ persist dispatched
→ call Provider
→ persist terminal result OR uncertainty
```

最关键的边界：

```text
persist dispatched
BEFORE
Provider side effect
```

这样进程在 Provider 调用附近死亡时，重启之后不会假装“这项调用从来没发生过”。

## 5. Replay 同一调用

再次使用**同样的 identity 与 input**：

```ts
await runtime.run(
  createTicket,
  { title: "Printer is on fire" },
  {
    identity: {
      source: "support-agent",
      scope: sessionId,
      callId: toolCallId,
    },
    authorization,
  },
);
```

它会汇合到同一个 durable Operation。

如果你改成不同 input，却仍复用同一 Operation identity，Ordarium 会报 conflict，而不是悄悄把两件事混成一件。

## 6. 现在做真正有价值的实验

Quickstart 的 happy path 只证明代码能跑。

Ordarium 的价值发生在 failure path。

下一页：

[**Failure Lab — crash after Provider commit**](failure-lab.md)

你会故意让进程死在最坏的位置，然后看 recovery 为什么必须根据 Provider capability 分三条路。
