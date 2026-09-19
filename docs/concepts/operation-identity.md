# Concept · Operation identity

## The problem

同一个真实业务动作可能被 Host 投递多次：

```text
network retry
session replay
queue redelivery
subagent transport retry
process restart
```

如果每次 delivery 都直接执行 Provider，你没有 durable basis 判断它们是不是同一项工作。

## 30-second answer

Ordarium 把：

```text
Invocation
```

映射为稳定：

```text
Operation
```

默认 logical key：

```text
source + scope + callId
```

Operation ID 还绑定：

```text
Action name + Action version
```

所以“同一 delivery 的 replay”可以汇合，而不同 Action version 不会悄悄共用 durable history。

## Example

```text
Invocation A: session=42, call=7
Invocation B: session=42, call=7

        A ─┐
           ├→ Operation op_xxx
        B ─┘
```

如果 B 的 input 与 A 不同：

```text
OPERATION_CONFLICT
```

而不是把两个不同请求合在一起。

## Custom business key

Action 可以定义：

```ts
key: (input) =>
  `invoice:${input.invoiceId}:charge`
```

这样跨 session 的不同 Invocation 也可以被定义成同一项业务工作。

这是非常强的语义选择。

不要为了“提高去重率”随便写 custom key。

## Failure behavior

Operation identity 是 recovery 的锚：

```text
restart
→ load same Operation
→ inspect durable state
→ decide query / same-key retry / uncertain
```

如果重启时 Host 生成了新 callId，本来应该恢复的工作就会变成一个新 Operation。

## Common mistakes

- 把 random UUID 当 replay-stable callId；
- 把 input hash 直接当业务 key，却忽略“相同 input 也可能是两项不同合法工作”；
- 在同一个 Action version 下改变业务意义；
- 遇到 `uncertain` 后换新 callId 重新做一遍。

## Reference

- [Core concepts](../dev/02-core-concepts.md)
- [Action contract](../13-ordarium-action-contract.md)
