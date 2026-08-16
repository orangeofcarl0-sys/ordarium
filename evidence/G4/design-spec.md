# G4 Design Spec：Operations 与 recovery material 闭环（冻结）

> 依据：`ORDARIUM-GOALS-3`（docs/17 §12）、docs/13 §10、docs/15 §21。
> 性质：G4 实现前的单一目标形状；锚定 v2 现状（G2 cursor 分页、principal digest、G3 evaluator 的 reconcile-only 模式）。

## 0. 当前落点

已有：cursor 分页（`OperationPage/OperationEventPage`，默认 limit 100）、principal digest 冲突、record codec 双视图可用字段。缺：Operations service、视图脱敏、recovery material 验证、OperatorAuthorization。

## 1. OrdariumOperations（位于 `@ordarium/core`，不拆包）

```ts
interface OrdariumOperations {
  inspect(operationId: string): Promise<OperationView | undefined>;
  list(filter?: OperationListFilter, cursor?: string): Promise<OperationViewPage>;
  history(operationId: string, cursor?: string, limit?: number): Promise<OperationEventViewPage>;

  reconcileOnly<I extends JsonValue, O extends JsonValue>(request: {
    operationId: string;
    action: Action<I, O>;
    input: unknown;                      // recovery material 的一部分
    identity: InvocationIdentity;
    authorization: OperatorAuthorization;
    providerPrincipalRef?: ProviderPrincipalRef;
    signal?: AbortSignal;
  }): Promise<O>;
}
```

- 前三者为只读薄层（ledger + codec + projector）；`reconcileOnly` 以 `mode: "reconcile-only"` 走 G3 的同一 evaluator；
- **禁止**：`execute()`、`forceRetry`、raw SQL filter、开放式 `forceTransition`、manual attestation（未来 schema 另议）；
- 构造：`createOperations({ runtime | ledger, clock? })` 工厂，runtime 提供时复用其 lease/claim 基建。

## 2. 双视图与字段政策（同一 projector，无复制 DTO）

```ts
interface OperationView {           // operator 审计视图（受权）
  operationId; actionName; actionVersion; effectKind; idempotencyMode;
  state; attempts; semanticRevision; lastFencingToken;
  createdAt; updatedAt; idempotencyExpiresAt?;
  identity: { source; scope; callId; rootCallId?; actor?; lineage? };  // 跨 agent 审计（G4-A11）
  authorization?: { decision; kind; source; reason?; at };             // operator 可见
  error?: SafeError; uncertainty?: { reason; at }; receipt?: JsonValue;
  resultRef?: { digest };           // 结果以 digest 引用，不默认回传全文
}
type ModelOperationView = Omit<OperationView,
  "authorization" | "identity" | "error" | "receipt" | "uncertainty" | "resultRef"> & { reasonCode?: string };
```

- model 视图默认只含：operationId、action/version、effectKind、state、attempts、updatedAt、安全 reasonCode（G4-A09：无 reason/actor/lineage/full result/receipt）；
- projector 是 codec 之上的唯一输出脱敏点，不修改 durable 结果再当 replay 值。

## 3. Recovery material 验证器（fail closed）

优先级固定（docs/15 §21）：

1. 宿主按 `source/scope/callId` 找回原 invocation 参数；
2. operator 显式重交相同参数；
3. Action 的 reconcile 只依赖 `operationId`（input-independent）。

验证步骤（任一不符即稳定错误、Provider 零调用，G4-A03/A04）：

- 重新 parse input；校验 action name/version、operationId、logicalKeyDigest、inputDigest、providerPrincipalDigest（复用 G1-005 冲突语义）与 record 全匹配；
- 接受状态：`dispatched`、`uncertain`、或 lease 过期且 `claim.resumeFrom` 为二者之一的 `claimed`；经 claim 取得 recovery 所有权；
- 取不到原输入且 Action 非 input-independent → 只允许 inspect。

## 4. OperatorAuthorization（独立权限边界）

```ts
interface OperatorAuthorization {
  operator: string;                    // 受信宿主注入的 actor 标识
  source: string;                      // 如 "dsh:operator-command"
  grantedAt: string;
  scope?: "operations" | "operations:reconcile";  // 最小默认 operations（只读）
}
```

- 不复用 Action authorization evidence；普通 tool input 自带 `operator=true` 无效（只有宿主 adapter 能注入）；
- `reconcileOnly` 要求 `scope` 覆盖 reconcile；ops 工具默认不注册给模型（G4-A10）。

## 5. 交付切片建议

- G4-001：Operations 只读面（inspect/list/history + projector 双视图 + 分页消费）；
- G4-002：recovery material 验证器 + `reconcileOnly` + OperatorAuthorization + principal 连续性；
- G4-003：负面矩阵（缺 material、摘要不匹配、未授权、reconcile 变体）+ exit report。

## 6. 验收映射（docs/17 §12.4）

| ID | 证据形式 |
|---|---|
| A01 inspect | 双视图 projector 单测（terminal/uncertain） |
| A02 分页 | G2 cursor 消费，无遗漏/重复，bounded limit |
| A03 缺 material | inspect 可用；reconcileOnly fail closed，Provider 0 |
| A04 任一不匹配 | 稳定 conflict/error，Provider 0（digest 矩阵） |
| A05 reconcile 成功/失败 | audited reconciled + codec 过滤 |
| A06 pending/unknown/throw/invalid | 保持 uncertain |
| A07 absent + retrySafe | reconcile-only 保持 uncertain，execute spy = 0 |
| A08 principal 换号 | 拒绝继续原 operation |
| A09 model view | 字段白名单断言 |
| A10 未授权 caller | 无 list/history/reconcile 权限，不能自授予 |
| A11 跨 agent 审计 | operator view 含 source/scope/rootCallId/lineage；model view 不含 |
