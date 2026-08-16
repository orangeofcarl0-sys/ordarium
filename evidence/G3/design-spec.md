# G3 Design Spec：Runtime 恢复、并发与生命周期（冻结）

> 依据：`ORDARIUM-GOALS-3`（docs/17 §11）、docs/13 §5/§9、docs/15 §9/§15。
> 性质：G3 实现前的单一目标形状；与 12–17 冲突时以后者为准。本文锚定 G1/G2 已交付的 v2 现状（record v2、lease 分离端口、codec、capability gate）。

## 0. 当前落点（G2 出口）

已有：invocation 惰性恢复主链（reconcile-first / same-key / uncertain）、CAS claim + lease + fence、`renewLease` 零语义心跳、`idempotencyExpiresAt` 创建时持久化（**未强制**）、`installOrdarium().dispose()` 仍为 unregister 后立即 close、recovery 判断散在 `#recover`/`#dispatchAndExecute` 且无 reconcile-only 模式。

## 1. Runtime 生命周期（唯一生产路径）

```ts
type RuntimeLifecycleState =
  | "accepting" | "quiescing" | "draining" | "closing" | "closed";

class OrdariumRuntime {
  get lifecycle(): RuntimeLifecycleState;
  quiesce(): Promise<void>;          // accepting → quiescing：立即拒绝新调用
  dispose(options?: { drainMs?: number }): Promise<void>; // 见 §2 固定顺序
}
```

- `quiescing` 之后新 `run/invoke` 稳定抛 `RUNTIME_QUIESCING`（新错误码，code 固定）；不新建 operation、不 dispatch；
- 状态迁移单调，不可逆；`closed` 后任何调用抛 `RUNTIME_CLOSED`（新错误码）；
- `close()`（现存）并入同一条路径，成为 dispose 的别名；immediate-close 旧路径**删除**。

## 2. dispose 固定顺序（不可交换）

```text
quiesce（拒绝新调用）→ unregister（宿主侧，由 adapter 触发）
→ draining：对每个 in-flight operation 有界等待（默认 drainMs = leaseMs）
→ abort remaining：组合 signal abort
→ persist/handoff：dispatch 前 → cancelled；dispatch 后无 Provider 事实 → uncertain（durable handoff）
→ revoke late writes：撤销旧 owner 的终态写权限（清/过期其 lease；迟到 CAS 由 fence 验证天然拒绝）
→ closing → ledger.close → closed
```

- Action 忽略 AbortSignal 时：先持久化 handoff，再吸收迟到 callback（结果丢弃，不写终态）；
- 硬进程退出跳过 drain（依赖 durable recovery，属既有语义）；
- `@ordarium/dsh` 的 `installOrdarium().dispose()` 在同一切片切到该合同，不保留第二份 in-flight 集合。

## 3. 统一 RecoveryEvidenceEvaluator（单一事实源）

```ts
type RecoveryMode = "normal" | "reconcile-only";

interface RecoveryEvidence {
  record: OperationRecord;                 // dispatched / uncertain / 过期 claimed
  action: Action<JsonValue, JsonValue>;
  mode: RecoveryMode;
  clock: () => Date;
}

interface RecoveryDecision {
  action:
    | { kind: "return-terminal"; value: JsonValue }
    | { kind: "query" }                    // 调 reconcile()
    | { kind: "redispatch-same-key" }      // 仅 normal + 证据允许 + deadline 未过
    | { kind: "stay-uncertain"; reason: string };
}
```

- `#recover`/`#dispatchAndExecute` 的判定逻辑收敛为该内部模块；G4 的 Operations 只以 `mode: "reconcile-only"` 复用，**永不**得到 `redispatch-same-key`；
- 判定矩阵（docs/13 §5）：有 `reconcile()` 先查询；`absent + retrySafe` 仅 normal 允许 redispatch；`pending/unknown/throw/invalid` 保持 uncertain；无查询但 `idempotencyMode === "operation-key"` 且 deadline 未过 → same-key；其余 uncertain，禁止盲重试；
- 取消语义并入：dispatch 前取消 → cancelled（可证明）；dispatch 后 → 按 Provider 事实或 uncertain。

## 4. finite idempotency deadline 执行期强制

- evaluator 与 dispatch 入口检查 `record.idempotencyExpiresAt`：已过期 → 禁止 `execute()`，只允许 query 或保持 uncertain（稳定 `IDEMPOTENCY_EXPIRED` 诊断错误码，仅用于明确拒绝执行的路径）；
- deadline 不因重试/重启/quiesce 恢复续期（持久化已在 G2 完成，此处只消费）；
- `renewLease` 与 deadline 无关（lease 是 liveness，不是窗口）。

## 5. 时钟与停顿语义

- lease 到期判定以 ledger 时钟一致源为准（`SqliteLedger`/`MemoryLedger` 的 clock 注入已具备）；
- wall-clock 前后跳变 fixture：跳变不得制造两个本地有效 owner（lease 比较用同一 clock 源）；无法证明时 fail closed/uncertain；
- event-loop stall fixture：stall 超过 lease → 心跳丢失 → `renewLease` false → abort + 旧 owner 无终态权（G2-A04 已证机制，本阶段加时钟注入用例）。

## 6. 交付切片建议

- G3-001：生命周期状态机 + `RUNTIME_QUIESCING`/`RUNTIME_CLOSED` + dsh dispose 切换 + 有界 drain 测试；
- G3-002：RecoveryEvidenceEvaluator 收敛（行为等价重构 + reconcile-only 模式桩）+ `IDEMPOTENCY_EXPIRED` 强制；
- G3-003：时钟跳变/stall/心跳丢失夹具 + checkpoint 完整矩阵 + exit report。

## 7. 验收映射（docs/17 §11.4）

| ID | 证据形式 |
|---|---|
| A01 crash before dispatch | 既有 crash 注入 + evaluator 单测 |
| A02 crash after dispatch、before request | recovery 进入（非普通失败）|
| A03 Provider 成功后 terminal 前 crash | 同 identity query/same-key，不建新 operation |
| A04 opaque 丢失响应 | 稳定 uncertain，重复 invocation 不盲重试 |
| A05 deadline 未过/已过 | 未过 same-key；过期 `IDEMPOTENCY_EXPIRED`，只 query/uncertain |
| A06 lease 丢失/心跳 CAS 失败 | signal abort + 旧 owner 终态无权（扩展 G2-A04） |
| A07 clock jump / stall | 单 owner 或 fail closed |
| A08/A09 abort before/after dispatch | cancelled / reconciled-or-uncertain |
| A10 quiesce 期间 | 新调用 `RUNTIME_QUIESCING`；有界 drain；handoff；无 immediate-close 路径 |
| A11 normal vs reconcile-only | 共享 evaluator；reconcile-only 的 execute spy 恒为 0 |
