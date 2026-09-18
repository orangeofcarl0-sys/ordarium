# @ordarium/host-kit

编写新 Ordarium Host Adapter 时的推荐入口。

它只暴露 curated host-facing contract，并提供 portable host conformance runner。

```ts
import {
  HOST_CONTRACT_VERSION,
  assertHostContract,
  runHostAdapterConformance,
} from "@ordarium/host-kit";

assertHostContract(
  HOST_CONTRACT_VERSION,
);
```

Host 的核心工作是把原生 tool-call lifecycle 映射为：

```text
host tool call
→ InvocationIdentity
→ AuthorizationDecision?
→ ProviderPrincipalRef?
→ AbortSignal?
→ HostInvocationPort.invoke(...)
```

Host-framework-specific 类型应留在 leaf adapter，不要进入 `@ordarium/core`。

见 [08 · Hosts](../../docs/dev/08-hosts.md)。
