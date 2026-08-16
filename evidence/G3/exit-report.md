# G3 Exit Report：Runtime 恢复、并发与生命周期

> Goal revision：`ORDARIUM-GOALS-3`（docs/17 §11）；目标形状冻结于 `design-spec.md`
> 完成日期：2026-08-16　环境：Windows 10 (26200)、Node v24.14.1、TypeScript 7.0.2

## 1. 变更范围

| Delta | 内容 |
|---|---|
| G3-001 | 生命周期状态机、`RUNTIME_QUIESCING`/`RUNTIME_CLOSED`、有界 drain + durable handoff + 迟到 callback 吸收、dsh dispose 切换（commit `6adee15`） |
| G3-002/003 | 统一 `recovery.ts` evaluator（normal/reconcile-only）、`IDEMPOTENCY_EXPIRED` 执行期强制、时钟跳变/stall 夹具、checkpoint 矩阵、取消语义（commit `584f4fa`） |
| G3-004 | `runtime.reconcileOnly` 调用入口（A11 调用方级证明）+ dsh dispose 字面顺序（quiesce → unregister → drain） |

## 2. 验收矩阵（docs/17 §11.4）

| ID | 证据 |
|---|---|
| A01 crash before dispatch | `core/test/clock.test.ts` "crash after the claim, before dispatch"（Provider 0、同 identity 恢复成功） |
| A02 crash after dispatch、before request | 同文件 "crash after the durable dispatch..."（记录停在 dispatched，非普通失败） |
| A03 Provider 成功后 terminal 前 crash | `core/test/runtime.test.ts` "reconciles an externally successful operation after a crash"（同 identity query，无新 operation） |
| A04 opaque 丢失响应 | `core/test/recovery.test.ts` guarded 回归（重复 invocation 不盲重试）+ 既有 runtime.test |
| A05 deadline 未过/已过 | `core/test/recovery.test.ts` 两条 finite 链路（未过 same-key 重发且 deadline 不变；过期 `IDEMPOTENCY_EXPIRED` + uncertain，execute 不再发生） |
| A06 lease 丢失/心跳失败 | `core/test/clock.test.ts` 前跳接管（旧 owner `OPERATION_BUSY`）+ `lifecycle.test.ts` 迟到终态被拒 + G2-A04 |
| A07 clock jump / stall | `core/test/clock.test.ts` 前跳单接管 / 后跳无第二 owner |
| A08 abort before dispatch | `core/test/cancellation.test.ts`（cancelled、Provider 0） |
| A09 abort after dispatch | 同文件（结果未知 → uncertain；确定性完成保持 succeeded 的诚实语义） |
| A10 quiesce | `core/test/lifecycle.test.ts` 5 项（`RUNTIME_QUIESCING`、有界 drain、handoff、迟到吸收、替代 runtime 恢复） |
| A11 normal vs reconcile-only | `core/test/recovery.test.ts` evaluator 决策级证明 + `core/test/reconcile-only.test.ts` 调用方级证明（`runtime.reconcileOnly`：Provider execute spy 恒零、absent+retrySafe 保持 uncertain、never-dispatched fail closed） |

## 3. 快照 / 错误码演进

`contracts.json` 错误码 23 → 25（+`RUNTIME_QUIESCING`、`RUNTIME_CLOSED`、`IDEMPOTENCY_EXPIRED` 共 3 项，含 G3-001 两项）；`api/core/*` 新增 `recovery.d.ts` 与生命周期声明；依赖图不变。

## 4. 开发中抓到并修正的问题

测试侧 execute 第二参误当 signal（产品无缺陷）；"abort 后动作优雅完成应记 succeeded"被测试先行纠正为诚实语义；跨 runtime 重投撞活跃 lease 的夹具形状修正。

## 5. 未完成项（归属后续 Goal）

- reconcile-only 的调用方（Operations/recovery material/双视图）→ **G4**（其决策保证已在本阶段冻结并单测）；
- Provider conformance 的 deadline/absence 端到端 → G6；
- 真实 DSH HMR fixture → G5（dsh dispose 已切本合同）。

## 6. 最终命令与输出

```text
pnpm check                → tsc -b 全绿；20 test files, 96 tests passed
pnpm verify:architecture  → passed；快照零未解释漂移
```

G3 exit gate 达成：runtime 只有一个 recovery evaluator、一条生命周期路径；崩溃/时钟/取消矩阵均有失败注入证据。
