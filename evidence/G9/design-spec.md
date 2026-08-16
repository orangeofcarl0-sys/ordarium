# G9 Design Spec：运维面与官方 DSH 插件壳（冻结）

> 依据：docs/12 §5（表面分层）、docs/13 §10（Operations 端口）、docs/15 §17（运维闭环）、docs/17 §12.2（"Ops surface 默认不自动暴露给模型；宿主必须显式注册并提供 authorization"）。
> 性质：RC 后追加的 Goal（见 docs/17 §16.5）。与 12–17 冲突时以后者为准；本文把已批准的产品决定（2026-08-17 会话决议：Ordarium 以插件形式进入 DSH，自有功能仅运维面）收敛为可实施合同。
> 已否决项：插件不做 action 注册面（action 本体是 execute 代码，属业务插件/G8 recipes）；不做调度/审批 UI/凭据（DSH 与 Palimpsest 地盘）。

## 1. 产品形状：官方插件壳

```ts
// @ordarium/dsh/advanced
export interface OrdariumPluginOptions {
  databasePath?: string;                  // 统一配置：进程级默认 ledger 位置
  runtime?: OrdariumRuntime;              // 高级注入（默认由壳构造，见 §2）
  authorize?: DshAuthorizer;              // action 作者级默认授权器
  scopeId?: string | ((ctx: DshToolRunContext) => string);
  recoveryMaterial?: DshRecoveryMaterialResolver;   // G4 来源 1（会话找回）
  operations?: { authorization: OperatorAuthorization };  // opt-in 运维面
}

export interface OrdariumDshPlugin extends DshOrdarium {
  readonly ops?: OrdariumPluginOps;       // 仅当 operations 提供时存在
}
export function createOrdariumPlugin(options?: OrdariumPluginOptions): OrdariumDshPlugin;
```

- 壳 = **进程级 Ordarium 实例所有者**：构造默认 runtime（durable SQLite、`deploymentCoordination: "local-multi-process"`）；其他 Ordarium-aware 插件通过传入 `runtime` 复用（或独立 installOrdarium 指向同库——local-multi-process 语义本就允许，壳把它从约定变成结构）。
- 不新增包、不动 root façade（`createOrdariumPlugin` 只在 `/advanced`）；core 合同零改动。
- `register(ctx, actions)`/`tool()` 复用既有 asDshTool 合同；`dispose()` 复用 G3 字面序（quiesce → unregister → drain → close）。

## 2. 运维面（唯一自有功能）

`OrdariumPluginOps` 是 G4 `OrdariumOperations` 的插件内直通（同一 projector、同一权限边界），外加把三个只读面 + reconcile 以 **DSH 工具**形式受控注册：

| 工具名 | 输入 | 输出 | 权限 |
|---|---|---|---|
| `ordarium_inspect` | `{ operationId }` | ModelOperationView（脱敏八字段） | operations（读） |
| `ordarium_list` | `{ actionName?, state?, limit?, cursor? }` | `{ views[], nextCursor? }`（model 视图） | operations（读） |
| `ordarium_history` | `{ operationId, cursor?, limit? }` | `{ events[], nextCursor? }`（model 视图） | operations（读） |
| `ordarium_reconcile` | `{ actionName, input, identity: { source, scope, callId } }` | 终值或稳定错误 | operations:reconcile |

规则：

1. **默认不存在**：未提供 `operations` 时，四个工具不注册、`ops` 字段为 undefined（docs/17 §12.2 的"默认不暴露"在插件层的落实）。
2. **OperatorAuthorization 注入点**：授权对象由宿主命令/受信配置构造后传入壳——壳是 G4 边界在 DSH 内的受信注入者；模型输入无法伪造（构造期校验，缺失/伪造 → `OPERATOR_AUTHORIZATION_REQUIRED`）。
3. **模型只见脱敏视图**：工具返回 G4 的 `ModelOperationView`（无 reason/actor/lineage/authorization/result 全文）；operator 审计全文走 `plugin.ops.*`（进程内 API，宿主命令消费）。
4. **reconcile 工具语义**：按 G4 验证器重推导（actionName → 注册表中唯一同名 Action + input + identity → digests 全匹配才继续）；材料来源 = 调用方重交（优先级 2）或 `recoveryMaterial` 解析（优先级 1，解析结果仍须经同一验证器）。永不 execute（复用 `runtime.reconcileOnly`）。
5. **host-mcp 对齐修复**：`ordarium_inspect` 在 MCP 侧此前只声明未分发（G9 审计项）——本 Goal 补齐分发，走同一 createOperations + opt-in 授权。

## 3. 验收映射

| ID | 场景 | 通过条件 |
|---|---|---|
| G9-A01 | 共享实例 | 壳构造默认 durable runtime；经壳注册的 action 正常执行；第二个消费者传入同一 runtime 复用同一 ledger（同 operation 去重） |
| G9-A02 | ops 默认缺席 | 无 operations 选项：registry 中无 `ordarium_*` 工具、`ops` undefined |
| G9-A03 | ops 注册与脱敏 | 提供后四工具就位；inspect/list 返回 model 视图形状（字段白名单恰等） |
| G9-A04 | 权限门 | 伪造/缺失授权（含读权限试图 reconcile）→ `OPERATOR_AUTHORIZATION_REQUIRED`，零 ledger 读副作用 |
| G9-A05 | reconcile fail-closed | 材料不匹配 → `OPERATION_CONFLICT`；absent+retrySafe → 保持 uncertain 且 execute spy 零增长 |
| G9-A06 | dispose 字面序 | 壳 dispose 后 runtime `closed`、新调用 `RUNTIME_QUIESCING`/`RUNTIME_CLOSED` |
| G9-A07 | MCP inspect 分发 | opt-in 后 `tools/call ordarium_inspect` 返回脱敏视图；未 opt-in 时不在 tools/list |
| G9-A08 | 表面治理 | root façade 不变（白名单零漂移）；exports.test 覆盖 `createOrdariumPlugin`；快照冻结 |

## 4. 实现切片

- G9-001：`packages/dsh/src/plugin.ts` + advanced 导出；
- G9-002：host-mcp inspect 分发修复；
- G9-003：`packages/dsh/test/plugin.test.ts` + host-mcp 用例；
- G9-004：审计缺漏文档修复（docs/14 §5 Palimpsest 方向、evidence/G8 spec §4、docs/12 §5、docs/13 §10、docs/17 §16.5/§2.2）；
- G9-005：delta + exit + 快照 + 全绿 + 提交。

## 5. 环境约束（承袭披露）

真实 DSH 插件 manifest 的最终接线仍依赖 DSH 发布包可消费（与 G5/G7 同一遗留项）；本 Goal 以结构合同 + 测试落地，DSH 包到位后接 manifest 即可，合同零改动预期。
