# 04 · 错误码表（案头参考）

所有错误都是 `OrdariumError` 的子类，带稳定 `code` 字段（以及多数情况下的 `operationId`）。**按 `code` 决定动作，不要解析 message。**

## 身份与授权

| code | 含义 | 调用者动作 |
|---|---|---|
| `IDENTITY_REQUIRED` | managed 副作用缺宿主提供的稳定身份 | 由 Host Adapter 补齐；不得用随机 id 绕过 |
| `AUTHORIZATION_REQUIRED` | managed Action 没有授权决策 | 经宿主取得真实授权后以同一身份再进入 |
| `ACTION_DENIED` | 此 operation 已持久 deny | 不自动重试；新意图需新调用/新业务修订 |
| `AUTHORIZATION_CONFLICT` | 同一 operation 收到矛盾的授权证据 | 宿主集成错误；首个持久决定不可覆盖 |
| `PRINCIPAL_CONFLICT` | 恢复凭据解析到另一个 Provider 主体 | 不得换账号继续原 operation |
| `OPERATOR_AUTHORIZATION_REQUIRED` | 运维面调用缺有效 `OperatorAuthorization` | 由受信宿主命令注入；工具输入无法自授予 |

## 冲突与并发

| code | 含义 | 调用者动作 |
|---|---|---|
| `OPERATION_CONFLICT` | 同一身份被不同输入复用 | 修复 identity/key；绝不自动换随机身份 |
| `OPERATION_BUSY` | 另一 owner 持有 claim | 稍后**以同一身份**重试；不得另起 operation |
| `CONTRACT_DRIFT` | 同名同版本的 Action 合同元数据漂移 | 诊断性失败——作者应 bump version |

## 执行与恢复

| code | 含义 | 调用者动作 |
|---|---|---|
| `OPERATION_UNCERTAIN` | 外部结果未知，拒绝盲重试 | inspect / reconcile-only / 人工外部核查 |
| `OPERATION_FAILED` | 已有可证明失败终态 | 返回业务失败；不再执行 |
| `OPERATION_CANCELLED` | dispatch 前取消（或只读取消） | 新的显式意图才可再调用 |
| `IDEMPOTENCY_EXPIRED` | finite 幂等 deadline 已过，禁止执行 | 只能查询或保持 uncertain；不得续期 |

## 资源限制

| code | 含义 | 调用者动作 |
|---|---|---|
| `INPUT_TOO_LARGE` | 输入超过 1 MiB canonical JSON 上限 | 缩小输入；发生在任何持久化之前 |
| `PERSISTED_VALUE_TOO_LARGE` | output/receipt 超过持久化上限 | dispatch 前可修正；dispatch 后按 uncertain 处理 |

## 生命周期

| code | 含义 | 调用者动作 |
|---|---|---|
| `RUNTIME_QUIESCING` | Runtime 已停止接收新调用 | 新意图交给替换实例 |
| `RUNTIME_CLOSED` | Runtime 与 ledger 已关闭 | 不再使用该实例 |

## 基础设施（ledger）

| code | 含义 | 调用者动作 |
|---|---|---|
| `LEDGER_CAPABILITY_REQUIRED` | ledger 能力不覆盖该 profile/拓扑 | 配置合格的 durable ledger 或显式降级 profile；**不会静默 fallback 到内存** |
| `LEDGER_OPEN_FAILED` | 打不开数据库/属于别的应用 | 检查路径与占用；fail closed |
| `LEDGER_NEWER_SCHEMA` | 数据库版本高于本运行时 | 升级 Ordarium；不自动降级 |
| `LEDGER_MIGRATION_FAILED` | v1→v2 迁移失败（已回滚） | 数据库保持完整 v1；排查后重试打开 |
| `LEDGER_BUSY` | 数据库被其他写入者锁定 | 稍后重试；保持同一身份 |
| `LEDGER_CORRUPT` | 记录/内容损坏 | fail closed；从一致性备份恢复 |
| `LEDGER_CLOSED` | 已关闭后使用 | 编程错误 |
| `LEDGER_FULL` | 存储耗尽 | dispatch 前会停止；dispatch 后保留未知并要求维护 |

## 测试专用

`SIMULATED_PROCESS_CRASH`——仅测试夹具使用，模拟进程崩溃。

> 另有一个**持久化**的安全错误码 `ACTION_EXECUTION_FAILED`（写在 record 里的 `error.code`，不是抛出的异常类型）。
