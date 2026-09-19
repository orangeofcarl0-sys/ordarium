# Tutorial · Build a Host Adapter

目标：把你自己的 Tool / Agent / RPC 系统映射到 Ordarium，而不把宿主类型塞进 `@ordarium/core`。

## 1. Host 保留原生 pipeline

假设你的宿主收到：

```ts
type HostToolCall = {
  sessionId: string;
  callId: string;
  tool: string;
  arguments: unknown;
  actor?: string;
};
```

不要把这个类型加入 Ordarium core。

## 2. Map to HostInvocation

```ts
const invocation = {
  identity: {
    source: "my-host",
    scope: call.sessionId,
    callId: call.callId,
    ...(call.actor ? { actor: call.actor } : {}),
  },

  authorization: {
    decision: "allow" as const,
    kind: "host-admission" as const,
    source: "my-host:tool-pipeline",
  },

  signal: abortController.signal,
};
```

## 3. Invoke through the port

```ts
const result = await runtime.invoke(
  action,
  call.arguments,
  invocation,
);
```

宿主继续负责：

```text
which tool
input admission
human/policy approval
credentials
sandbox
session
rendering
```

Ordarium 只从 port 之后接管 effect execution boundary。

## 4. Version handshake

```ts
import {
  HOST_CONTRACT_VERSION,
  assertHostContract,
} from "@ordarium/host-kit";

assertHostContract(HOST_CONTRACT_VERSION);
```

真实 adapter 应固定自己编译时针对的 contract version，而不是把 Runtime 当前值原样回传来“永远通过”。

## 5. Provider principal

如果 credential recovery 可能解析到不同账户，宿主应提供稳定 principal reference：

```ts
providerPrincipalRef: {
  namespace: "provider-x",
  subject: accountId,
}
```

Ordarium 只持久化 digest，不持久化 credential。

## 6. Conformance

通过 `@ordarium/host-kit` 的 portable runner 验证：

```text
stable identity
classified authorization
cancellation
error mapping
principal continuity
lifecycle
```

## 7. 一个常见错误

错误：

```text
transport retry
→ host generates fresh callId
→ Ordarium sees a new Operation
```

正确做法是尽可能把宿主原生稳定 delivery/call identity 映射进 `callId`。

## Existing adapters

- `@ordarium/host-mcp`：当前具体非 legacy adapter；
