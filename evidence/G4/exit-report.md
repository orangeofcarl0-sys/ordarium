# G4 Exit Report：Operations 与 recovery material 闭环

> Goal revision：`ORDARIUM-GOALS-3`（docs/17 §12）；目标形状冻结于 `design-spec.md`
> 完成日期：2026-08-16　环境：Windows 10 (26200)、Node v24.14.1、TypeScript 7.0.2

## 1. 变更范围

| Delta | 内容 |
|---|---|
| G4-001 | `operations.ts`（OrdariumOperations、双视图 projector、OperatorAuthorization 门、reconcileOnly 预验+委托）+ claim 重试有界修复 |

## 2. 产品决定核对（docs/17 §12.2）

- Operations 留在 `@ordarium/core`，无第五包 ✓；
- inspect/list/history 只读；reconcileOnly 只走 `runtime.reconcileOnly`（query-only）✓；
- 无 forceRetry / raw SQL / forceTransition / manual attestation ✓；
- 双视图同一 projector、无 DTO 复制 ✓；
- ops 面默认不暴露给模型（需显式 OperatorAuthorization，仅宿主可构造）✓。

## 3. 验收矩阵（docs/17 §12.4）

| ID | 证据 |
|---|---|
| A01 | `operations.test.ts` "A01"（terminal/双态 inspect、resultRef digest、结果全文不出现） |
| A02 | "A02"（cursor 遍历 9 记录 limit 4 无遗漏/重复；history 分页） |
| A03 | "A03/A04"（material 不可用时 inspect 可用；reconcile fail closed，reconcile spy = 0） |
| A04 | 同上（错输入/错身份/未知 op/漂移版本 → `OPERATION_CONFLICT`） |
| A05 | "A05"（reconciled + outcome + codec 过滤；A06 变体四类保持 uncertain） |
| A06 | "A05/A06" |
| A07 | "A07"（absent+retrySafe → uncertain；execute spy 零增长） |
| A08 | "A08"（换 principal → `PRINCIPAL_CONFLICT`，记录不动） |
| A09 | "A09/A11"（model 字段白名单恰等） |
| A10 | "A10"（缺失/伪造/越 scope/读权限 reconcile 全拒 `OPERATOR_AUTHORIZATION_REQUIRED`） |
| A11 | "A09/A11"（operator 视图含 source/scope/rootCallId/actor/lineage；model 不含） |

## 4. 快照 / 错误码演进

`contracts.json` 错误码 25 → 26（+`OPERATOR_AUTHORIZATION_REQUIRED`）；新增 `api/core/operations.d.ts`；依赖图不变（core 零外部依赖）。

## 5. 开发中抓到并修复的缺陷

- 状态机 claim-reload 循环无上界：双时钟源分歧（runtime 与 ledger clock 不一致）会造成永久重试——测试先以挂起形式暴露，已加连续失败 >10 → `OPERATION_BUSY` 有界封死；
- 测试对 crash 语义的两处误设：SimulatedProcessCrash 诚实地把记录留在 `dispatched`（进程死亡后无人写 uncertain），A03/A08 断言随之修正。

## 6. 未完成项（归属后续 Goal）

- DSH 侧 ops 工具的受权注册（opt-in binding）与宿主命令呈现 → G5；
- Provider conformance 对 A06/A07 行为的夹具化复跑 → G6；
- recovery material 的来源 1（宿主 session 找回原 invocation）依赖 DSH binding → G5（验证器与优先级合同已冻结）。

## 7. 最终命令与输出

```text
pnpm check                → tsc -b 全绿；21 test files, 106 tests passed
pnpm verify:architecture  → passed；快照零未解释漂移
```

G4 exit gate 达成：uncertain 具备安全可见性与 query-only 处置闭环，operator 权限、Secret 边界与"无原输入不恢复"的 fail-closed 原则全部有自动化证据。
