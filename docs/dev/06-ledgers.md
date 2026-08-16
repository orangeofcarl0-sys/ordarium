# 06 · Ledger 选择

SQLite 不是 core 的语义依赖——core 只认 `OperationLedger` 端口 + `LedgerCapabilities`。选 ledger = 选你能诚实承诺的能力。

## 两个内置实现

| | `SqliteLedger`（默认） | `MemoryLedger` |
|---|---|---|
| 能力 | crash-durable、local-multi-process、语义 CAS、活租约、历史 | volatile、single-isolate |
| 合法用途 | managed 副作用的默认本地 authority | 测试、纯读取、显式 unmanaged |
| 不承诺 | 网络文件系统、多主机共享、外部 Provider 的恰好一次 | 崩溃/重启恢复、跨进程 claim |

## 能力门

Runtime 在**创建 operation 之前**检查 ledger 声明是否覆盖 profile 与部署拓扑。不覆盖 → `LEDGER_CAPABILITY_REQUIRED`，Provider 不会被调用，**且绝不静默降级到内存**。同理：durable ledger 打开失败也是 fail closed。

测试与嵌入式弱模式可显式选择 volatile 托管：

```ts
import { OrdariumRuntime } from "@ordarium/core";

const runtime = new OrdariumRuntime({ allowVolatileLedger: true });
// 明确承认：没有 crash/restart 保证。生产 managed 写不要这么做。
```

## 默认数据库与部署拓扑

- 路径：`$DSH_HOME/ordarium/operations.sqlite`，未设置时 `~/.dsh/ordarium/operations.sqlite`（WAL 模式，会有受同一生命周期管理的 sidecar 文件）；
- managed DSH 默认声明 `local-multi-process` 拓扑：多个本机进程可打开同一文件竞争 operation（真实双进程夹具在 CI 里验证）。跨主机/网络文件系统不在承诺内。

## 自定义 ledger（高级）

实现完整的 `OperationLedger`（能力声明、语义 CAS + fence 验证、原子 claim+lease、轻量续租、cursor 分页、v2 记录 codec）并通过 conformance 后即可替换。**不要**建立第二套记录/状态语义。

## 运维注意

- 无自动 GC：terminal operation 不自动删除——删除会重新打开重复副作用的窗口；
- 备份活跃库需先 `PRAGMA wal_checkpoint(TRUNCATE)` 或关闭全部连接（CI 中验证）；
- 打开旧 v1 库会**自动事务性迁移**到 v2（失败回滚，库保持完整 v1）；
- 恢复旧备份可能丢失备份点之后的 operation 身份——恢复后先与 Provider 事实 reconcile 再恢复执行。
