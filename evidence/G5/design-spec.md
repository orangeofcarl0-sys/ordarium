# G5 Design Spec：宿主产品集成——DSH 首宿主 + MCP 第二宿主（冻结）

> 依据：`ORDARIUM-GOALS-3`（docs/17 §13）、docs/12 §5/§6、docs/13 §8、docs/15 §13。
> 性质：G5 实现前的单一目标形状；锚定现状（精选 façade G1-002、HostInvocationPort G1-001、capability gate 默认 local-multi-process）。

## 0. 当前落点

已有：`@ordarium/dsh` 精选 root（6 值导出）+ `/advanced`；结构近似的 DshToolDefinition/ContentBlock（text-only 私有类型）；`installOrdarium` golden path；dispose 仍 immediate-close（G3-001 会先切换）。缺：正式 DSH public types 支持、真实 integration fixture、MCP 叶包。

## 1. DSH 正式类型矩阵（收敛私有近似）

- 固定支持矩阵：列明所支持的 DSH public version 与 import 面（manifest、ToolDefinition、ContentBlock、ToolRunContext、registry/dispose 形状）；`@ordarium/dsh` 只 import 该矩阵内的 public 类型；
- ContentBlock：默认 renderer 保持 JSON text；自定义 renderer 使用 DSH 正式类型，删除私有 text-only union（COMPAT-DSH-001 执行）；
- per-action binding（`/advanced`）：render/timeout/concurrency/actor/lineage/principal/custom ledger/lifecycle tuning 唯一入口。

## 2. 授权 evidence 映射（不伪造 human approval）

| DSH 侧 | Ordarium evidence |
|---|---|
| 工具体被 admission pipeline 放行 | `{decision:"allow", kind:"host-admission", source:"dsh:tool-body-admitted"}` |
| 命名 guard/policy 命中 | `{kind:"policy-decision", source:"dsh:policy:<name>"}` |
| approval 系统的人类决定 | `{kind:"human-approval", source:"dsh:approval:<id>"}` |

- binding 只在宿主提供对应事实时选择更强 kind；不满足时保持 host-admission；与持久决定矛盾 → `AUTHORIZATION_CONFLICT`（G1-003 语义）。

## 3. Session recovery material 与 credential resolver

```ts
// /advanced 绑定（DSH 宿主能力注入）
interface DshAdvancedBindings {
  recoveryMaterial?: (invocation: { source; scope; callId }) => Promise<unknown | undefined>;
  credentialResolver?: (ref: ProviderPrincipalRef) => Promise<unknown>;  // 短暂持有，不落账
}
```

- G4 reconcileOnly 的 material 来源 1（原 invocation）由 dsh binding 提供；取不到时走 operator 重交或 input-independent；
- principal：binding 提供 `providerPrincipalRef`（瞬态），持久 digest 冲突复用 G1-005。

## 4. `@ordarium/host-mcp` 叶包（真实第二宿主）

- workspace 新增 `packages/host-mcp`：依赖仅 `@ordarium/core`（+ `@ordarium/ledger-sqlite` 默认 durable）+ MCP protocol SDK（**外部 SDK 只允许出现在宿主叶包**）；
- 形态：stdio MCP server；`tools/list` → Action 注册面；`tools/call` → `HostInvocationPort.invoke`；
- identity 映射：`source="mcp"`、`scope=client 稳定标识`、`callId=MCP request id`；客户端不保 call identity 的高风险 Action → 要求业务 `key()`，否则 `IDENTITY_REQUIRED` fail closed；
- ops 工具（inspect/reconcile-only）受 `OperatorAuthorization` 保护、opt-in 注册；
- 生命周期：server shutdown 遵循 G3 quiesce→drain→close；
- **回退决策**：MCP SDK 不满足合同（license/稳定性）→ 改为 headless CLI 宿主（同 identitiy/evidence/lifecycle 合同），本合同不变；
- 工具面更新：`tools/verify-architecture.mjs` 的包 allowlist 增加叶包规则（外部依赖仅宿主叶包允许，方向 core(+sqlite)）。

## 5. 真实 integration fixture 集

`packages/dsh/test/integration/` + `packages/host-mcp/test/`：

- root call、code-mode nested dispatch、parallel tool call（不误折叠）、session replay（保留 callId → 复用 operation）、session restart、subagent lineage（rootCallId 不作去重键）、HMR（quiesce→drain→reload 恢复同 version）；
- MCP：真实 MCP client fixture（SDK client 连 stdio server）调用 guarded/idempotent Action，断言与 DSH 路径同语义；
- 双宿主共账 e2e：DSH + host-mcp 共享 SQLite（G2-A12 扩展为真实双宿主进程）。

## 6. 验收映射（docs/17 §13.3）

| ID | 证据形式 |
|---|---|
| A01 普通安装 | 只依赖 `@ordarium/dsh`，一个 `installOrdarium` 完成 |
| A02 原生 pipeline | schema/guard/approval/signal/result event/renderer 均经 DSH |
| A03 三类 evidence | kind/source 可区分，不伪造 human approval |
| A04 replay/restart | 保留 callId → 复用；不保留 → 业务 key |
| A05 parallel | 不同 call 不折叠；相同由 core/ledger 协调 |
| A06 root/subagent | rootCallId 仅 lineage |
| A07 ContentBlock | 默认 text + 正式类型高级 renderer |
| A08 HMR | drain 后 close；同 version 可恢复 |
| A09 ops tools | 默认不注册/受权保护；无 force retry |
| A10 兼容性 | host-version 差异只在 adapter；core 快照无 DSH 类型 |
| A11 root/advanced 面 | 既有机器检查延续 + README=declarations |
| A12 MCP 第二宿主 | 真实 client fixture；core 无 MCP 类型 |
| A13 双宿主共账 e2e | 真实双宿主进程共享 ledger |
| A14 叶包隔离 | verify allowlist + SDK 不入内核包 |
