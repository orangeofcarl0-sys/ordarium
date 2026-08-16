# Delta G1-004：EffectProfile 判别 union clean break

- 变更分类（docs/17 §7.2）：C 破坏性合同变化（作者 API 形状变更，private 阶段 clean break）
- 影响面：public API（effects.ts/action.ts/types 声明）/ 语义派生（runtime 决策点）/ 宿主映射（dsh）
- 依据：docs/13 §1.1（唯一目标形状）、docs/17 GOALS-3 §9.2.4；evidence/G0/target-contract-decisions.md §2

## 目标结构与理由

1. `EffectProfile` 切为 `kind` 判别 union：`read-only | guarded | unmanaged` 无参分支 + `idempotent`（必带 `window: { kind: "durable" } | { kind: "finite"; expiresAfterMs }`）+ `reconcilable`（可选 `idempotencyWindow`、必填 `cancellable`）。冗余布尔（`hasExternalSideEffect`/`requiresAuthorization`/`idempotency`）与 `IdempotencyMode` 删除。
2. 构造器语义冻结：`effects.idempotent()` 默认 durable window；finite 必须显式；`reconcilable` 默认 `cancellable: false`、无窗口。
3. 派生逻辑收敛为 core 公共助手 `requiresAuthorization()` / `hasExternalSideEffect()` / `usesOperationKey()`——runtime、dsh 适配器一律消费助手，不再各自读布尔。
4. 定义期校验：finite 窗口的 `expiresAfterMs` 必须为正安全整数；未知 window kind 拒绝；`cancel()` 必须由 `cancellable` 的 reconcilable profile 支撑。
5. record 的 `guarantee` 字段值域不变（五种 kind 字符串），字段重命名（effectKind）留给 G2 的 v2 record 原子切换，不在本切片扩散。
6. **范围声明**：finite window 的绝对 `idempotencyExpiresAt` 持久化与过期执行禁止属 record v2（G2）与 Runtime enforcement（G3）；本切片只冻结形状与定义期校验。

## 旧调用/旧数据的转换位置

无 durable 数据。仓库内调用者一次性更新（runtime 八处决策点、dsh 授权判定、全部测试字面量）；`effects.reconcilable()` 无参调用形兼容（仅选项名 `idempotency` → `idempotencyWindow` 变化）。

## 旧路径删除时点

本变更集内已完成：布尔字段形状与 `IdempotencyMode` 不再可构造。

## 证明旧路径不再产生状态的测试

`packages/core/test/effects.test.ts`（8 项）：durable 默认、finite 合法/非法边界（0/负/小数/超安全整数/未知 kind）、reconcilable 默认与 usesOperationKey 派生、五 profile 授权与副作用矩阵、cancel 约束、record.guarantee 反映 kind。既有 32 项回归全部通过（恢复/幂等/崩溃语义不变）。

## 需要同步更新的文档

docs/14 §1、docs/17 §2.2 G1 状态、本 delta sheet。

## 快照变化

`snapshots/api/core/effects.d.ts`、`action.d.ts`、`runtime.d.ts`、`types.d.ts`、`snapshots/api/dsh/advanced.d.ts`、`snapshots/api/dsh/index.d.ts`（root 类型再导出集合不变）；`contracts.json` 无 union 变化（GuaranteeLevel 值域不变）。
