# @ordarium/host-mcp

Ordarium 的 Model Context Protocol stdio Host Adapter。

它把 Action 映射为 MCP tools，并把 `tools/call` 映射到 Ordarium Runtime。

```ts
import {
  createMcpOrdarium,
} from "@ordarium/host-mcp";

const server = createMcpOrdarium({
  actions: [createTicket],
  databasePath:
    "/var/lib/myapp/ordarium.sqlite",
});

await server.start();
```

## Authorization

Managed Action 如果需要比“宿主收到 tool call”更强的授权证据，应配置 `authorize`。

默认 fallback 只分类为：

```text
host-admission
```

**不宣称**这等价于 `human-approval`。

## Operations tool

默认不会注册：

```text
ordarium_inspect
```

只有显式提供可信 OperatorAuthorization 时，它才进入 MCP tool surface。

见 [08 · Hosts](../../docs/dev/08-hosts.md)。
