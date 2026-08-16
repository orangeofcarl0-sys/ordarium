# Delta G4-001：OrdariumOperations 服务与运维闭环

- 变更分类（docs/17 §7.2）：B 加法合同（core 新模块导出 + 新错误码）+ 一处健壮性修复（claim 重试有界）
- 依据：`evidence/G4/design-spec.md` §1–§4；docs/17 §12、docs/13 §10、docs/15 §21

## 目标结构与理由

1. **`packages/core/src/operations.ts`**：`createOperations({ runtime | ledger })` 工厂返回 `OrdariumOperations`——`inspect/list/history` 为 codec 之上的只读薄层（消费 G2 cursor 分页）；`reconcileOnly` 为查询专用处置路径。
2. **双视图同一 projector**：`projectOperatorView`（完整 identity/lineage/authorization/error/uncertainty/receipt + `resultRef.digest`，结果全文不出投影）与 `projectModelView`（八字段白名单：operationId/action/version/effectKind/state/attempts/updatedAt/reasonCode）——无复制 DTO，G4-A09/A11。
3. **recovery material 验证器**：`reconcileOnly` 先以 `operationIdentityPreview` 重推导 action/version/operationId/logicalKeyDigest/inputDigest 并与 durable record 全比对（G4-A04 矩阵：错输入/错身份/未知 operation/漂移版本全部 `OPERATION_CONFLICT`，Provider 查询零调用、零垃圾 record 创建），再委托 `runtime.reconcileOnly`（principal 连续性、never-dispatched fail closed、execute 永零均由 G3 冻结语义提供，G4-A07/A08）。
4. **`OperatorAuthorization` 独立边界**：`{ operator, source, grantedAt, scope?: "operations" | "operations:reconcile" }`；全部四个方法都要求它（读需 operations、reconcile 需 operations:reconcile），伪造/缺失/越 scope → 新错误码 `OPERATOR_AUTHORIZATION_REQUIRED`（G4-A10：普通 tool input 无法自授予——只有受信宿主 adapter 能构造合法对象）。
5. **附带健壮性修复**：`#runInternal` 状态机的 claim-reload 循环加上界（连续失败 >10 → `OPERATION_BUSY` fail closed）。开发中测试以"双时钟分歧"触发过该无限循环（operator runtime 用真实时钟而 ledger 用冻结时钟），属真实故障模式（时钟源不一致的部署），已用有界重试封死。

## 旧调用/旧数据的转换位置

纯新增模块；无 durable 迁移。

## 证明测试（`packages/core/test/operations.test.ts`，10 项，映射 G4-A01–A11）

A01 双态 inspect（结果全文不泄漏）；A02 cursor 分页无遗漏/重复；A03/A04 material 矩阵（reconcile spy = 0）；A05 成功落 reconciled + resultRef digest；A05/A06 pending/unknown/throw/invalid 保持 uncertain；A07 absent+retrySafe 保持 uncertain 且 execute spy 零增长；A08 换 principal `PRINCIPAL_CONFLICT`；A09/A11 model 字段白名单恰等 + operator 视图含完整 lineage；A10 未授权/伪造 scope/越权 reconcile 全拒；never-dispatched 拒绝。

## 快照变化

`api/core/operations.d.ts`（新增）、`api/core/errors.d.ts`；`contracts.json` +`OPERATOR_AUTHORIZATION_REQUIRED`。
