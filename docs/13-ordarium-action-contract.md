# 13 · Action & runtime contract

这是当前 Ordarium 的规范性运行合同。

## 1. Action

```ts
interface Action<I, O> {
  name: string;
  version: string;
  description: string;

  input: ActionSchema<I>;
  output: ActionSchema<O>;
  effect: EffectProfile;

  key?(
    input: I,
    identity: InvocationIdentity,
  ): string;

  execute(
    input: I,
    context: ActionExecutionContext,
  ): Promise<O> | O;

  reconcile?(
    input: I,
    context: ActionExecutionContext,
  ): Promise<ReconcileResult<O>> | ReconcileResult<O>;

  cancel?(
    input: I,
    context: ActionExecutionContext,
  ): Promise<void> | void;

  receipt?(
    value: O,
    input: I,
  ): JsonValue | undefined;
}
```

## 2. Name / version / fingerprint

Action name：

```text
^[a-z][a-z0-9_.-]*$
```

Action version 是稳定标识。

不兼容语义变化由 Action author 负责 bump version。

`contractFingerprint` 覆盖：

- name/version；
- input/output JSON Schema；
- effect profile；
- `key/reconcile/cancel/receipt` 是否存在。

它不 hash function source，也不替代 version discipline。

## 3. EffectProfile

当前 union：

```text
read-only
guarded
idempotent
reconcilable
unmanaged
```

规则：

- `reconcilable` 必须实现 `reconcile()`；
- 有 `cancel()` 的 Action 必须是 `cancellable: true` 的 reconcilable profile。

## 4. InvocationIdentity

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

`read-only` / `unmanaged` direct call 可以获得进程内生成 identity；宿主适配仍应提供稳定 host identity。

## 5. Operation identity

Input 先通过 Action schema parse。

随后：

```text
logicalKey =
  action.key(input, identity)

  OR

  source ␀ scope ␀ callId
```

然后：

```text
logicalKeyDigest = digest(logicalKey)

operationId =
  op_ + prefix(
    digest({
      action: action.name,
      version: action.version,
      logicalKeyDigest
    })
  )
```

`inputDigest` 独立保存。

同一 Operation identity 被用于不兼容 input / contract 时 fail closed。

## 6. Authorization

Managed write 需要 `AuthorizationDecision`：

```text
allow | deny

kind:
host-admission
policy-decision
human-approval
```

Authorization 会成为 durable Operation evidence。

后续矛盾 evidence：

```text
AUTHORIZATION_CONFLICT
```

`ProviderPrincipalRef` 是 transient `{namespace, subject}`，持久化时只保存 digest。

Recovery 解析到不同 principal：

```text
PRINCIPAL_CONFLICT
```

## 7. Semantic states

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

典型 managed write：

```text
proposed
→ authorized
→ claimed
→ dispatched
→ terminal / uncertain
```

每次 semantic transition：

```text
semanticRevision + 1
```

Live lease heartbeat 不增加 semanticRevision，也不进入 semantic history。

## 8. Claim / Lease / Fencing

Claim 保存：

```text
owner
fencingToken
acquiredAt
resumeFrom
```

Ledger 必须把 semantic claim 与 live lease acquisition 原子化。

旧 fencing token 在所有权转移后不能成功提交新的 semantic state。

## 9. Ledger eligibility

```ts
interface LedgerCapabilities {
  durability:
    | "volatile"
    | "crash-durable";

  coordination:
    | "single-isolate"
    | "single-process-exclusive"
    | "local-multi-process";

  semanticCas: true;
  liveLease: boolean;
  semanticHistory: boolean;
  stateRevisions: boolean;
  stateChangeFeed?: boolean;
}
```

Managed write 要求：

- crash durability；
- live lease；
- semantic history；
- 能覆盖 runtime 声明 deployment topology 的 coordination。

不足时：

```text
LEDGER_CAPABILITY_REQUIRED
```

并且必须发生在 Provider dispatch 之前。

## 10. Dispatch boundary

Ordarium 在调用 Provider Action body 之前持久化：

```text
dispatched
```

因此一旦越过这条边界：

```text
本地没有 success record
!=
外部一定失败
```

这就是 `uncertain` 必须存在的原因。

## 11. Recovery

统一 evaluator：

```text
有 reconcile？
→ query

否则有可用 operation key
+ normal mode
+ finite deadline 未过期？
→ redispatch-same-key

否则
→ stay-uncertain
```

### ReconcileResult

```ts
type ReconcileResult<O> =
  | {
      status: "succeeded";
      value: O;
      receipt?: JsonValue;
    }
  | {
      status: "failed";
      error: SafeError;
      receipt?: JsonValue;
    }
  | {
      status: "absent";
      retrySafe: boolean;
    }
  | {
      status: "pending";
      receipt?: JsonValue;
    }
  | {
      status: "unknown";
      receipt?: JsonValue;
    };
```

`absent` 只有 `retrySafe: true` 时才可能使 **normal mode** 获得重做资格。

### Reconcile-only

```text
reconcileOnly
→ same evidence evaluator
→ query-only mode
→ never dispatch execute
```

## 12. IdempotencyWindow

```ts
type IdempotencyWindow =
  | { kind: "durable" }
  | {
      kind: "finite";
      expiresAfterMs: number;
    };
```

Finite deadline 在 Operation 初次创建时冻结。

不会因为 replay/restart/takeover/reconcile 续期。

## 13. Persistence

当前：

```text
OperationRecord.schemaVersion = 2
```

可以持久化：

- contract fingerprint；
- input / logical-key / principal digests；
- identity；
- effect/idempotency metadata；
- authorization；
- semantic state/revision；
- attempts/fence；
- claim snapshot；
- safe result/receipt/error；
- uncertainty/reconciliation；
- timestamps。

LiveLease 单独保存。

## 14. Resource / Secret boundary

Input 与 persisted JSON 有资源上限。

Oversize 必须显式报错。

如果 Provider effect 已经可能发生，而 output/receipt 因资源限制无法持久化，不能把这种情况伪装成普通 failure。

不要在 output / receipt / State value 中保存 credential / secret。

## 15. Management state

当前：

```text
StateRecord.schemaVersion = 1
```

一个 subject：

```text
(namespace, key)
```

写入：

```text
expectedRevision = 0
→ create revision 1

expectedRevision = n
→ CAS n → n+1
```

StateRef 指向的 Operation / exact state revision 在 commit 前检查存在性。

State 不使用 Operation lease/fencing。

## 16. StateChangeFeed

```ts
changes(filter?, cursor?)
→ {
  changes,
  cursor,
  hasMore,
}
```

合同：

- cursor 永远返回；
- 顺序是 ledger commit-observation order；
- explicit `limit` 为 `1..1000`；
- malformed/future cursor → `INVALID_CURSOR`；
- 不宣称 causal order；
- 不宣称 distributed exactly-once processing。

## 17. Host contract

当前：

```text
HOST_CONTRACT_VERSION = 1
```

HostInvocation 只携带：

```text
identity
authorization?
providerPrincipalRef?
signal?
```

Core 不接受 host-framework-specific type。

版本不一致 fail closed。

## 18. Operations API

`createOperations` 提供：

```text
inspect
list
history
reconcileOnly
```

全部使用独立 `OperatorAuthorization`。

```text
ActionAuthorization
!=
OperatorAuthorization
```

## 19. Normative safety rules

1. 不推断 Provider idempotency/query capability；
2. 不 blind-retry uncertain guarded effect；
3. lease heartbeat 不进入 semantic history；
4. replay 不改写 durable authorization；
5. 不在不同 Provider principal 下继续同一 Operation；
6. durable storage failure 不 silent fallback 到 volatile；
7. reconcile-only 永不 dispatch；
8. change cursor 不是 authority，也不是 causal truth。
