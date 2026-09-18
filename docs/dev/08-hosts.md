# 08 · 宿主：自建、MCP 与 DSH（legacy）

Ordarium 的接入面只有 `HostInvocationPort`：**自建宿主是一等路径**，`@ordarium/host-kit` 是它的对齐与 conformance 工具；`@ordarium/host-mcp` 是现成的 MCP 叶包；`@ordarium/dsh` 是最初的 DSH 适配，**已冻结为 legacy**（保留给既有消费者，不再演进）。

## MCP 宿主（`@ordarium/host-mcp`）

一个零外部依赖的 MCP stdio 服务器：把 Action 暴露成 MCP 工具，任何 MCP 客户端 harness 都能消费——Ordarium 内核中立的实证。

```ts
import { createMcpOrdarium } from "@ordarium/host-mcp";

const server = createMcpOrdarium({
  runtime,
  actions: [reserveSku],
  authorize: () => ({ decision: "allow", kind: "policy-decision", source: "mcp:policy:x" }),
  operations: { authorization: operatorAuthz },  // 可选：注册 ordarium_inspect
});

await server.start();          // stdio 循环；shutdown 走同一生命周期合同
```

identity 映射：`source="mcp"`、`scope=clientInfo.name`、`callId=请求 id`。客户端不保留稳定 call identity 的高风险 Action 必须声明业务键，否则 `IDENTITY_REQUIRED`。

## 自建宿主（框架作者，推荐路径）

实现 `HostInvocationPort` 合同即可接入 core，不改内核：稳定 `source/scope/callId`、正确的授权来源（不伪造人工决策）、取消 signal、输入/输出 schema 双向映射、register/dispose 生命周期、replay/并发/重启语义的真实集成测试。

第三方宿主的一等入口是 **`@ordarium/host-kit`**（G18）：curated 适配面（port/identity/授权类型 + 错误基类）+ 构造期版本握手 + 可移植 conformance runner。

```ts
import { assertHostContract, HOST_CONTRACT_VERSION, runHostAdapterConformance } from "@ordarium/host-kit";

assertHostContract(HOST_CONTRACT_VERSION);  // exact-match，不匹配即 HOST_CONTRACT_MISMATCH fail-closed
// 装配完成后、发布前，对 scratch 账本上的 runtime 跑可移植 conformance：
await runHostAdapterConformance(runtime, runtime.ledger);
```

`@ordarium/testing` 的 `HostAdapterHarness` 仍是这套合同的现成 conformance 基座（见 [09](09-testing.md)）。

**双宿主共账**：两个宿主（例如 MCP 叶包 + 你自建的宿主）指向同一 SQLite 时，相同业务键跨宿主汇合为单个 operation（单次执行），不同身份互不折叠——多 agent/multi-harness 共享同一份副作用事实。

## DSH 适配（`@ordarium/dsh`，legacy 冻结）

> **状态**：这是最初的 DSH 宿主适配（含官方插件壳与运维面），**已冻结**——无新能力、不推荐新接入、问题不阻塞内核线。保留它是因为既有消费者可能仍在使用；迁移路径是 host-neutral 三件套（core + 自建宿主 / `host-mcp`）。归属重审见 `docs/17` §16 第 6 项。

适配细节（仅供既有集成参考）：

| DSH 侧 | Ordarium 侧 |
|---|---|
| `ToolRunContext.callId` | `identity.callId`（宿主 replay 不保留 callId 时必须用业务 `key()`） |
| `rootCallId` | 关联字段，不参与去重 |
| Agent/session id | `identity.scope`（稳定且非敏感） |
| tool signal | 组合 signal（取消 + 租约丢失） |
| admission/policy/approval | 分类 evidence（见 [05](05-authorization.md)） |

输出渲染：默认 JSON text；自定义 renderer 可返回宿主原生内容块（结构化 `DshContentBlock`，不再限 text）。per-action binding（render/timeout/concurrency/actor/lineage/principal/自定义 ledger）与插件壳都在 `@ordarium/dsh/advanced`。

生命周期：`installOrdarium(...).dispose()` 执行冻结序 `quiesce → unregister → 有界 drain → abort → durable handoff → close`——in-flight 调用不会被直接掐断（见 [10](10-lifecycle-and-recovery.md)）。
