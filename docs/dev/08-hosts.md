# 08 · Host integration

Ordarium 的目标是：**宿主可以不同，但 core 不需要知道宿主是什么。**

稳定接缝是：

```text
HostInvocationPort
```

## 合同

```ts
interface HostInvocation {
  identity: InvocationIdentity;
  authorization?: AuthorizationDecision;
  providerPrincipalRef?: ProviderPrincipalRef;
  signal?: AbortSignal;
}

interface HostInvocationPort {
  invoke(
    action,
    input,
    invocation,
  ): Promise<unknown>;
}
```

`OrdariumRuntime` 本身实现这个 port。

## Host 继续拥有

- tool discovery / registration；
- Ordarium 之前的 input admission；
- Agent / Model Loop；
- Policy 与人工审批 UI；
- credential；
- sandbox；
- session；
- client rendering；
- 整体 host lifecycle。

Ordarium 不复制这些系统。

## Host 要提供

每次 invocation：

1. 稳定 identity；
2. managed Action 所需的分类 authorization；
3. 可选 Provider principal；
4. cancellation signal；
5. 正确 Action definition。

Replay identity 是关键。

Transport 再投递同一个 tool call 时，不应该只是因为“又收到一次”就换成随机新 callId。

## Host contract version

当前：

```text
HOST_CONTRACT_VERSION = 1
```

自建 adapter 应执行 exact-match 握手：

```ts
import {
  HOST_CONTRACT_VERSION,
  assertHostContract,
} from "@ordarium/host-kit";

assertHostContract(HOST_CONTRACT_VERSION);
```

不一致：

```text
HOST_CONTRACT_MISMATCH
```

Host contract version 与 package semver、SQLite schema 相互独立。

## `@ordarium/host-kit`

新宿主适配的推荐入口。

它只 re-export curated host-facing contract，并提供：

```text
HostAdapterHarness
runHostAdapterConformance
```

Host package 在宣称 compatible 前应通过 portable conformance。

Host-kit 不包含任何宿主特有字段。

## MCP

`@ordarium/host-mcp` 是当前非 legacy 的具体宿主适配器。

映射：

```text
MCP tools/list
MCP tools/call
→
Ordarium Actions
```

当前行为：

- Action name → MCP tool name；
- Action description/schema → tool metadata；
- MCP client name → bounded scope（可用时）；
- JSON-RPC request ID → callId；
- managed Action 默认只记录 `host-admission`，除非配置自定义 authorizer；
- `ordarium_inspect` 只有显式提供可信 operator authorization 时才注册。

## Primitive input schema

Core 允许 primitive Action input。

具体宿主适配器可能因宿主自身的 tool schema 约束要求 object-shaped arguments——那是该适配器的限制，不是 Ordarium kernel 的限制。

## Host checklist

至少证明：

- replay identity 稳定；
- authorization 分类正确；
- cancellation 正确传播；
- Provider principal continuity 正确；
- error mapping 不吞掉 conflict / uncertain；
- host-specific types 不穿过 HostInvocationPort；
- lifecycle 正确关闭 runtime/ledger；
- contract handshake 与 host conformance 通过。
