# 02 · Core concepts

理解 Ordarium 最重要的一点，是不要把下面五个对象混在一起。

| 对象 | 含义 |
|---|---|
| **Action** | 可版本化的能力定义 |
| **Invocation** | 宿主投递的一次调用 |
| **Operation** | 稳定的逻辑工作身份；去重与恢复单位 |
| **Attempt** | durable dispatch 之后的一次 Provider 执行 |
| **External effect** | Provider 系统里真正发生的业务变化 |

多个 replayed Invocation 可以汇合到同一个 Operation。一个 Operation 只有在恢复合同证明安全时，才可能拥有多个 Attempt。

## Operation identity

没有自定义 `key()` 时：

```text
logical key = source ␀ scope ␀ callId

operationId =
  digest(
    action name,
    action version,
    logical-key digest
  )
```

`inputDigest` 单独保存。

因此：

```text
同 logical key + 同 input
→ 同一项工作的 replay

同 logical key + 不同 input
→ conflict

Action 合同在同 name/version 下漂移
→ conflict
```

Ordarium 保存 digest，而不是 raw input 或 raw business key。

## InvocationIdentity

```ts
interface InvocationIdentity {
  source: string;
  scope: string;
  callId: string;
  rootCallId?: string;
  actor?: string;
  lineage?: string[];
}
```

Managed write 必须有稳定 identity。

`read-only` / `unmanaged` 的直接 core 调用可以获得进程内生成的 identity，但真正的宿主适配应始终注入稳定宿主身份。

**Identity 不是 Authorization。**

## Authorization

```ts
{
  decision: "allow" | "deny",
  kind:
    | "host-admission"
    | "policy-decision"
    | "human-approval",
  source: string,
  reason?: string
}
```

`guarded` / `idempotent` / `reconcilable` 需要 authorization evidence。

第一份 durable decision 会成为 Operation 的一部分。后续对同一 Operation 提交矛盾证据会 fail closed：

```text
AUTHORIZATION_CONFLICT
```

用于 `inspect/reconcileOnly` 的 OperatorAuthorization 是另一条独立边界。

## Operation state

当前 semantic states：

```text
proposed
authorized
denied
claimed
dispatched
succeeded
failed
cancelled
uncertain
reconciled
```

`LiveLease` 与 semantic history 分离。

Heartbeat 只更新执行所有权的 liveness，不会伪造新的业务修订。

## Claim / Lease / Fencing

Claim 包含：

```text
owner
fencingToken
acquiredAt
resumeFrom
```

ledger 在 claim 时原子创建/更新 live lease。

当旧 lease 失效、所有权转移后，旧 worker 的 fencing token 不能继续提交 semantic transition。

## Contract fingerprint

`contractFingerprint` 对以下信息做确定性摘要：

- Action name/version；
- input/output JSON Schema；
- effect profile；
- `key/reconcile/cancel/receipt` 是否存在。

它**不 hash 函数源码**，也不替代 Action author 的 version 责任。

## 两类持久数据

### Operation evidence

用于回答“这项副作用工作发生了什么”：

- identity；
- Action name/version/fingerprint；
- input/key/principal digests；
- effect/idempotency metadata；
- authorization；
- state/revision/attempt/fence；
- claim snapshot；
- safe output/receipt/error/uncertainty/reconciliation。

### Management state

用于保存宿主定义的 `(namespace, key)` revision chain。

Ordarium 负责 shape、CAS 与 reference existence，不解释其业务语义。

见 [11 · Management state](11-state.md)。

## Secret boundary

Ledger 不是 credential vault。

不要把 secret 放进 Action output、receipt 或 State value。

Operation record 设计上不保存：

- raw input；
- raw logical/business key；
- credential；
- environment variable；
- arbitrary stack；
- 未过滤 Provider request/response。

Provider principal continuity 只持久化 `{namespace, subject}` 的 digest。

## 最重要的原则

```text
有足够证据
→ 推导允许的下一步

没有足够证据
→ uncertain / fail closed
```

Ordarium 不把“应该成功了”当成 durable truth。
