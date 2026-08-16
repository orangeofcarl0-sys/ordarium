# Delta G3-004：reconcileOnly 调用入口与 dsh dispose 字面顺序

- 变更分类（docs/17 §7.2）：B 加法合同（runtime 新公共方法）
- 依据：`evidence/G3/design-spec.md` §3；docs/17 §11.3 第 3/6 条、§11.4 G3-A11

## 目标结构与理由

1. **`OrdariumRuntime.reconcileOnly(action, input, options)`**：与 `run()` 同一入口校验（生命周期门、parse/上限、capability gate、identity/digest 推导、合同与 principal 绑定），但 `#runInternal` 全程锁定 `mode: "reconcile-only"`：proposed/authorized 状态直接 fail closed（`OperationFailedError`：未 dispatch 无可查询事实）；claimed 分支永不进入 dispatch；恢复决策全部经共享 evaluator（absent+retrySafe → stay-uncertain）。G4 的 Operations 只包装此方法，不建第二恢复引擎（docs/17 §11.2）。
2. `#recover` 增加 `mode: RecoveryMode` 参数（normal 调用点默认不变，行为零变化）。
3. **dsh dispose 字面顺序修正**为 docs/17 §11.3 冻结序：`quiesce() → unregister() → dispose()`（quiesce 先行使宿主仍可见的竞态调用 fail closed，drain/abort/handoff/close 在 runtime dispose 内）。

## 证明测试（`packages/core/test/reconcile-only.test.ts`，G3-A11 调用方级）

- crash 后 `reconcileOnly` 经 Provider 事实落 `reconciled`，execute 计数与 crash 后相同（spy 零增长）；
- absent+retrySafe → 保持 uncertain 且 execute 零增长（reconcile-only 永不 redispatch）；
- 无 reconcile 的 operation-key Action → uncertain（reason `reconcile-only`）、零执行；
- never-dispatched（authorized）记录 → `OperationFailedError`，记录原样未动（无 claim/query/dispatch）。

跨 owner 接管经共享时钟越过 lease 到期（与 G3-A06/A07 同一机制）。

## 快照变化

`api/core/runtime.d.ts`（reconcileOnly 声明）、`api/dsh/install.d.ts`；错误码无新增。

## 文档

docs/14（恢复行补 reconcileOnly）；`evidence/G3/exit-report.md` A11 证据行更新为调用方级证明。
