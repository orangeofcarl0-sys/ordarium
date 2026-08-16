# Delta G3-001：Runtime 生命周期与安全 dispose

- 变更分类（docs/17 §7.2）：C 破坏性合同变化（`close()` 语义升级为完整 dispose；immediate-close 路径删除）
- 依据：`evidence/G3/design-spec.md` §1/§2；docs/13 §9、docs/17 §11.3

## 目标结构与理由

1. `RuntimeLifecycleState = accepting → quiescing → draining → closing → closed`（单调）；`runtime.lifecycle` 只读暴露。
2. `quiesce()`：accepting → quiescing；此后新 `run/invoke` 稳定抛 `RUNTIME_QUIESCING`（closing/closed 抛 `RUNTIME_CLOSED`），ledger 零写入。
3. `dispose({ drainMs })` 固定顺序：quiesce → draining 有界等待（默认 leaseMs）→ abort remaining（per-run AbortController 与 caller signal 组合，run() 建立组合点）→ 对仍挂起项做 durable handoff（proposed/authorized→cancelled；claimed/dispatched→uncertain `runtime-dispose-handoff`，CAS 败于并发终态则让位）→ 吸收迟到 callback（catch 兜底 + fence 验证天然拒绝迟到终态）→ closing → ledger.close → closed。
4. `close()` 成为 `dispose()` 别名——dsh `installOrdarium().dispose()`/`DshOrdarium.close()` 经此自动切换到新合同（unregister 在先，宿主侧停新调用），**无第二份 in-flight 集合**。
5. 开发中发现并修正测试侧一处误用（execute 第二参是 context 而非 signal），产品代码无缺陷。

## 旧调用/旧数据的转换位置

无 durable 数据。既有 `close()` 调用点（dsh/测试）零改动获得新语义；immediate-close 路径不存在。

## 旧路径删除时点

本变更集内：`close() → ledger.close?.()` 直连路径删除。

## 证明测试（`packages/core/test/lifecycle.test.ts`，5 项，映射 G3-A10）

- quiesce 后新调用 `RUNTIME_QUIESCING`、零 operation；
- drain 内完成 → succeeded 终态、closed、后续调用 `RUNTIME_CLOSED`；
- 挂起 dispatched 动作 → handoff uncertain（reason 固定）、lease 清除、迟到 resolve 被吸收且不改 durable 状态（rejects OPERATION_BUSY）；
- 挂起 pre-dispatch（authorizer 悬置）→ handoff cancelled；
- handoff 后替代 runtime 可进入恢复（uncertain 保持诚实语义）。

## 文档与快照

docs/14（生命周期行）、docs/17 §2.2（G3 进行中）；`contracts.json` +`RUNTIME_QUIESCING`/`RUNTIME_CLOSED`；`api/core/*` 声明快照。
