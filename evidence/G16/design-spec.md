# G16 Design Spec:SqliteLedger 打开退避重试(冻结·休眠)

> 依据:`evidence/G12/stress-report.md` §4 附带发现一——热账本上的打开竞态:新进程在热写循环中 open 同一库,构造期 `PRAGMA journal_mode=WAL` 可能撞写锁,构造器抛 `LEDGER_BUSY`(稳定错误码、fail-closed、零句柄)。语义正确,但每个宿主被迫自建退避(G12 harness 已示范)。
> 性质:**休眠 Goal——冻结设计而非排期**。触发条件:随时(全部候选中最小);可与任一后续 Goal 搭车,或独立实施。
> 2026-08-29 会话决议:**默认开启有界退避**——`{ attempts: 5, delayMs: 100 }` 固定间隔,最坏 +0.5s 后仍 `LEDGER_BUSY` fail-closed;宿主零成本获得修复,构造期最坏延迟有界且可预期。
> 已否决项:opt-in 默认 fail-fast(摩擦大,每个宿主复制同一段重试);指数退避(最坏 +3.1s,与 fail-closed 的"快速失败"直觉有张力)。

## 1. 合同骨架

```ts
export interface SqliteLedgerOpenRetry {
  attempts?: number;   // 总尝试次数(含首次);默认 5;≥ 1 的安全整数
  delayMs?: number;    // 固定间隔;默认 100;≥ 0
}
// SqliteLedgerOptions 增:
openRetry?: SqliteLedgerOpenRetry | undefined;
```

- **默认启用**:`openRetry` 缺省 = `{ attempts: 5, delayMs: 100 }`。显式 `{ attempts: 1 }` 即现行 fail-fast 语义;显式传非法值(非安全整数、attempts < 1、delayMs < 0)→ TypeError(构造期,零句柄)。
- **只重试 BUSY 类**:open 全段(连接、PRAGMA、schema 创建/迁移)抛出的、经 `mapSqliteFailure` 判定为 `LedgerBusyError` 的失败,间隔 `delayMs` 后重建连接整体重试;`LEDGER_CORRUPT`、`LEDGER_NEWER_SCHEMA`、`LEDGER_OPEN_FAILED`(application_id 不符等)、`LEDGER_MIGRATION_FAILED` **不重试**——现行 fail-closed 合同一字不动。耗尽 attempts 后抛最后一次的错误实例。
- **重试即整体重建**:每次尝试从头 `new DatabaseSync(...)`,失败连接先静默关闭;迁移段(v1→v3 / v2→v3)遇 BUSY 同样整体重试(迁移自身事务性回滚保证库完整,重试安全;`createSchema` 为 IF NOT EXISTS 幂等 DDL)。
- MemoryLedger 不涉及;不新增错误码;不改变任何打开成功后的行为。

## 2. 边界规则

1. 重试是**打开边界的物理层容错**,不是策略:不日志、不遥测、不区分首次/重试成功;调用方无感知,耗尽后得到的错误与现行 fail-fast 恰同类同码。
2. 构造期最坏延迟上界 = `(attempts - 1) × delayMs` ≈ 400ms(默认),宿主可用更小配置收紧;该上界写入 docs/dev/06。
3. 文档同步:docs/dev/06 运维注意("热账本上并发打开默认内置退避;`attempts:1` 恢复 fail-fast");G12 报告附带发现一加"已由 G16 内置"注记(随实施)。

## 3. 验收矩阵

| ID | 场景 | 通过条件 |
|---|---|---|
| G16-A01 | 并发 open 压测 | 扩展 G12 harness 一腿:K 工作进程热写 + 新进程并发 open——默认配置下全部在重试内成功;零句柄泄漏(临时目录可删) |
| G16-A02 | fail-fast 保留 | `attempts: 1` 下并发 open 撞锁即抛 `LEDGER_BUSY`(现行语义不变) |
| G16-A03 | 非 BUSY 不重试 | corrupt 库 / 更新 schema / app_id 不符:一次性抛对应错误,尝试次数恰为 1 |
| G16-A04 | 参数校验 | 非法 openRetry → TypeError |
| G16-A05 | 治理 | dsh/发布面零变化;root façade 零漂移;快照漂移仅限 ledger-sqlite 声明面;delta 覆盖 |

## 4. 实现切片

- G16-001:`SqliteLedger` 构造器重试实现 + 单测(G16-A02–A04);
- G16-002:G12 harness 增并发 open 腿(G16-A01)+ docs/dev/06 与 G12 报告注记;
- G16-003:delta + snapshots + exit + 全门绿 + 提交。

## 5. 承袭披露与非目标

- 本 Goal 不触碰 `claim`/`compareAndSet` 等运行期写路径的 BUSY 处理(现行 `LEDGER_BUSY` 上抛由宿主决策——G12 已证其为诚实争用信号);open 重试不构成"静默重试"先例。
- 非目标:指数退避、抖动(jitter)、open 超时配置、运行期语句级重试。
