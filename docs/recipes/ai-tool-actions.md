# Recipe · AI agent tool actions

LLM / Agent 场景里，tool call 很容易因为：

```text
session replay
agent retry
subagent transport retry
host reconnect
```

被再次投递。

Ordarium 的价值不是替你决定“Agent 该调用哪个 tool”，而是保护**已经决定要执行的 side effect**。

## Host mapping

```text
Agent chooses tool
→ Host validates arguments / policy
→ Host constructs stable InvocationIdentity
→ Ordarium Action boundary
→ Provider
```

## Identity

尽量使用 Host 原生的 stable tool-call/delivery ID：

```ts
identity: {
  source: "agent-host",
  scope: conversationId,
  callId: toolCallId,
}
```

Transport replay 不应重新随机生成 callId。

## Authorization

“模型输出了 tool call”最多说明：

```text
host-admission
```

它**不自动等于**：

```text
human-approval
```

如果某个 tool 需要人工确认，Host 必须先完成自己的 approval pipeline，再注入正确分类的 evidence。

## Profile examples

```text
web search                    → readOnly
send external message         → guarded / idempotent / reconcilable
create ticket                 → depends on Provider
charge payment                → depends on Provider
update local cache only       → maybe unmanaged/readOnly depending semantics
```

Profile 由 Provider capability 决定，不由“这是 AI tool”决定。

## Palimpsest / multi-agent runtime

更高层 runtime 可以使用 Ordarium 的：

```text
Operations
StateStore
StateChangeFeed
```

构建 project / commitment / federation / monitor 等语义。

这些语义仍然属于上层，不进入 Ordarium kernel。
