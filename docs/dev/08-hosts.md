# 08 · 宿主：DSH、MCP 与自建

## DSH（首宿主）

普通作者只碰根入口（见 [01](01-getting-started.md)）。适配细节：

| DSH 侧 | Ordarium 侧 |
|---|---|
| `ToolRunContext.callId` | `identity.callId`（宿主 replay 不保留 callId 时必须用业务 `key()`） |
| `rootCallId` | 关联字段，不参与去重 |
| Agent/session id | `identity.scope`（稳定且非敏感） |
| tool signal | 组合 signal（取消 + 租约丢失） |
| admission/policy/approval | 分类 evidence（见 [05](05-authorization.md)） |

输出渲染：默认 JSON text；自定义 renderer 可返回宿主原生内容块（结构化 `DshContentBlock`，不再限 text）。per-action binding（render/timeout/concurrency/actor/lineage/principal/自定义 ledger）与插件壳都在 `@ordarium/dsh/advanced`。

生命周期：`installOrdarium(...).dispose()` 执行冻结序 `quiesce → unregister → 有界 drain → abort → durable handoff → close`——in-flight 调用不会被直接掐断（见 [10](10-lifecycle-and-recovery.md)）。

## MCP 第二宿主（`@ordarium/host-mcp`）

一个零外部依赖的 MCP stdio 服务器：把 Action 暴露成 MCP 工具，任何 MCP 客户端 harness 都能消费——Ordarium 内核中立的实证。

```ts
import { createMcpOrdarium } from "@ordarium/host-mcp";

const server = createMcpOrdarium({
  runtime,                    // 可与 DSH 共享同一 ledger（共账拓扑）
  actions: [reserveSku],
  authorize: () => ({ decision: "allow", kind: "policy-decision", source: "mcp:policy:x" }),
  operations: { authorization: operatorAuthz },  // 可选：注册 ordarium_inspect
});

await server.start();          // stdio 循环；shutdown 走同一生命周期合同
```

identity 映射：`source="mcp"`、`scope=clientInfo.name`、`callId=请求 id`。客户端不保留稳定 call identity 的高风险 Action 必须声明业务键，否则 `IDENTITY_REQUIRED`。

## 自建宿主（框架作者）

实现 `HostInvocationPort` 合同即可接入 core，不改内核：稳定 `source/scope/callId`、正确的授权来源（不伪造人工决策）、取消 signal、输入/输出 schema 双向映射、register/dispose 生命周期、replay/并发/重启语义的真实集成测试。`@ordarium/testing` 的 `HostAdapterHarness` 是这套合同的现成 conformance 基座（见 [09](09-testing.md)）。

**双宿主共账**：DSH 与 host-mcp 指向同一 SQLite 时，相同业务键跨宿主汇合为单个 operation（单次执行），不同身份互不折叠——多 agent/multi-harness 共享同一份副作用事实。
