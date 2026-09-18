# 04 · Errors

稳定 Runtime / Ledger 错误继承 `OrdariumError`，并带有字符串 `code`。

调用者应该按 `code` 或 error class 分类，**不要解析 message 文本**。

| Code | 含义 | 调用者动作 |
|---|---|---|
| `AUTHORIZATION_REQUIRED` | Managed Action 没有 authorization decision | 提供 host/policy/human evidence |
| `AUTHORIZATION_CONFLICT` | 同一 Operation 出现矛盾 durable authorization | 按 conflict 处理，检查 identity 是否被误复用 |
| `PRINCIPAL_CONFLICT` | 恢复时解析到了不同 Provider principal | 恢复原 principal/account，禁止继续 |
| `OPERATOR_AUTHORIZATION_REQUIRED` | Operations API 缺少可信 operator authorization | 从可信运维路径注入 |
| `CONTRACT_DRIFT` | 同 name/version 下 Action contract 漂移 | 升级 Action version 或恢复兼容合同 |
| `IDENTITY_REQUIRED` | Managed direct invocation 没有稳定 identity | 提供 source/scope/callId |
| `LEDGER_CAPABILITY_REQUIRED` | Ledger 无法支撑请求的 capability | 使用 SQLite 或 conformant capable ledger |
| `RUNTIME_QUIESCING` | Runtime 已停止接收新工作 | 把新工作路由到 live runtime |
| `RUNTIME_CLOSED` | Runtime 已关闭 | 创建/使用 live runtime |
| `IDEMPOTENCY_EXPIRED` | Finite idempotency window 已过期 | 禁止 redispatch；reconcile 或升级人工处理 |
| `ACTION_DENIED` | Authorization 拒绝 Action | 对当前 Operation 视为 durable denial |
| `OPERATION_CONFLICT` | Operation identity 与新材料冲突 | 检查 key/input/version/identity |
| `OPERATION_BUSY` | 另一 live worker 持有 Operation | 退避后重试 |
| `OPERATION_FAILED` | Operation 已 durable failed 或无法继续 | 检查 safe error/history |
| `OPERATION_CANCELLED` | Operation 已 durable cancelled | 当前 Operation 终态 |
| `OPERATION_UNCERTAIN` | 外部结果无法证明 | reconcile/升级处理；禁止 blind retry |
| `PERSISTED_VALUE_TOO_LARGE` | result/receipt/state 超过持久化限制 | 缩小/脱敏数据，或显式调整 limit |
| `INPUT_TOO_LARGE` | Action input 超过限制 | 减小输入，改传 reference |
| `LEDGER_OPEN_FAILED` | Durable ledger 无法打开 | 按基础设施故障处理 |
| `LEDGER_NEWER_SCHEMA` | 数据库 schema 新于当前 binary | 升级 binary，禁止旧版回写 |
| `LEDGER_MIGRATION_FAILED` | 前向 migration 失败 | 保留旧库并调查 |
| `LEDGER_BUSY` | SQLite/open coordination busy | 有界退避 |
| `LEDGER_CORRUPT` | Ledger/record invariant 失败 | 停止写入，恢复/修复 |
| `LEDGER_CLOSED` | Ledger handle 已关闭 | 使用 live ledger/runtime |
| `LEDGER_FULL` | 持久存储无法继续写入 | 扩容/释放空间 |
| `STATE_REVISION_CONFLICT` | State CAS 基准 revision 已过期 | reload 后重新决策 |
| `STATE_REF_NOT_FOUND` | State write 引用了不存在的 target | 先修复/创建引用目标 |
| `INVALID_CURSOR` | Change cursor 畸形或超过 high-water | 按显式 replay/reset policy 处理 |
| `HOST_CONTRACT_MISMATCH` | Host contract 版本不一致 | 对齐 @ordarium/* 版本并重跑 conformance |

## 可稍后重试

典型 coordination / transient：

```text
OPERATION_BUSY
LEDGER_BUSY
```

重试时继续使用同一逻辑 identity，不要为了“绕开 busy”生成新 callId。

## 需要修正请求/配置

```text
IDENTITY_REQUIRED
AUTHORIZATION_REQUIRED
LEDGER_CAPABILITY_REQUIRED
INPUT_TOO_LARGE
PERSISTED_VALUE_TOO_LARGE
HOST_CONTRACT_MISMATCH
STATE_REVISION_CONFLICT
STATE_REF_NOT_FOUND
INVALID_CURSOR
```

这些错误用完全相同输入 blind retry 通常没有意义。

## Durable conflict

```text
AUTHORIZATION_CONFLICT
PRINCIPAL_CONFLICT
CONTRACT_DRIFT
OPERATION_CONFLICT
```

Conflict 表示：已经存在的 durable Operation 与新请求对同一身份给出了不兼容含义。

应保留原记录并调查 identity / version / key / principal，而不是换个 callId 强行继续。

## Outcome ambiguity

```text
OPERATION_UNCERTAIN
IDEMPOTENCY_EXPIRED
```

含义不是“失败了”，而是当前证据不足以安全决定下一次副作用动作。

优先 reconcile；没有查询原语时升级 operator/human 处理。

## Provider failure

Action 只应该产生可安全持久化的 error/receipt。

不要把：

```text
raw provider exception
stack
credential
token
完整未脱敏 response
```

作为 durable error 保存。

Dispatch 之后出现异常时，根据 effect profile 与已有证据，结果可能是 `uncertain`，而不是普通 `failed`。

## Testing error

`SIMULATED_PROCESS_CRASH` 用于 deterministic fault injection，不是生产 Provider error。

## 持久化安全错误码

`ACTION_EXECUTION_FAILED` 是**写在 record 里的** `error.code`（SafeError），不是抛出的异常类型——它随 Operation 持久化，供 `inspect`/`history` 与恢复路径读取。不要把它当作可 `catch` 的错误类处理。
