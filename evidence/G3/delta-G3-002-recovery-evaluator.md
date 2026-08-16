# Delta G3-002/G3-003：统一恢复 evaluator、deadline 强制与时钟夹具

- 变更分类（docs/17 §7.2）：B 加法（`recovery.ts` 新导出）+ 语义收紧（finite deadline 执行期强制）
- 依据：`evidence/G3/design-spec.md` §3/§4/§5/§7

## 目标结构与理由（G3-002）

1. **单一 evaluator**：`packages/core/src/recovery.ts` 纯函数集——`evaluateRecovery`（路径选择）、`evaluateSameKeyRedispatch`（deadline/mode 门）、`evaluateAuthoritativeAbsence`（absent+retrySafe 判定）、`idempotencyDeadlinePassed`。`#recover` 的 no-reconcile 分支与 absent-outcome 分支全部改走 evaluator（mode 固定 `normal`）；运行时不再内联解释证据。
2. **reconcile-only 模式**在 evaluator 层冻结：同证据下 normal 得 `redispatch-same-key`、reconcile-only 得 `stay-uncertain`——G4 Operations 只需以该 mode 调用即可获得"execute 永零"的决策保证（G3-A11 的决策级证明；调用方接线属 G4）。
3. **`IDEMPOTENCY_EXPIRED` 执行期强制**：dispatch 写入后、execute 前检查冻结 deadline；recovery 的 redispatch 决策同样被 `evaluateSameKeyRedispatch` 门控。过期 → 持久 uncertain（reason `idempotency-expired`）+ 稳定 `IdempotencyExpiredError`；deadline 不因重启/重试续期（测试断言持久值不变）。
4. `#stopAsUncertain` 统一"诚实 uncertain + 稳定错误"出口。

## 目标结构与理由（G3-003）

- 时钟夹具（`clock.test.ts`）：前跳越过 lease → 恰一接管者、失联 owner 终态被拒（fence）；后跳不伪造过期、不产生第二本地 owner；stall 等价于前跳路径。
- checkpoint 矩阵（A01/A02）：after-claim crash → Provider 零调用且可恢复；after-dispatch crash → 记录停在 dispatched（按未知处理，非普通失败）。
- 取消语义（A08/A09）：abort-before-dispatch → cancelled + Provider 零调用；abort-after-dispatch 且结果未知 → uncertain（`cancel-requested-after-dispatch`）；Provider 确定性完成的 fulfilled 路径保持 succeeded（诚实语义）。

## 证明测试

`recovery.test.ts`（7：evaluator 四组单测 + deadline 前重发/后拒绝链路 + opaque 回归）、`clock.test.ts`（4）、`cancellation.test.ts`（2）。全仓 92 项绿。

## 文档与快照

`contracts.json` +`IDEMPOTENCY_EXPIRED`；`api/core/*`（recovery 声明）；docs/14、docs/17 状态行。
