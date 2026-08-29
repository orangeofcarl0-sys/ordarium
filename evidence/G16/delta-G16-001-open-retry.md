# Delta G16-001：`SqliteLedger` 打开退避重试

- 变更分类(docs/17 §7.2):**B 加法合同**(`SqliteLedgerOptions.openRetry` 新可选字段 + `SqliteLedgerOpenRetry` 导出)+ **C 缺陷修复**(测试实证的 `mapSqliteFailure` 空档——node:sqlite 以 `errstr` 承载 `SQLITE_NOTADB` 等,旧行为下 corrupt 库打开抛裸 `ERR_SQLITE_ERROR` 而非合同承诺的 `LEDGER_CORRUPT` 族)+ **工具面**(G12 harness 增 open 赛跑腿,零包变更)
- 依据:`evidence/G16/design-spec.md`(2026-08-29 冻结;触发条件"随时"满足,会话决议解除休眠)

## 目标结构与理由

1. **构造器重试环**(ledger-sqlite `src/index.ts`):整个打开序列(建目录 → 连库 → PRAGMA → app_id/user_version 门 → 建表/迁移)收进 `for` 重试环;仅 `LedgerBusyError` 触发下一轮,corrupt / 更新 schema / app_id 不符 / 迁移失败一次性 fail-closed;重试前关闭本轮句柄,耗尽后置 `#closed` 再抛,零句柄泄漏。默认 `{attempts:5, delayMs:100}`(最坏约 400ms),`resolveOpenRetry` 校验(attempts ≥1 整数、delayMs ≥0),`sleepSync` 经 `Atomics.wait` 同步休眠(构造器为同步路径,不可 await)。
2. **迁移 catch 映射先行**:`#migrateFromV1`/`#migrateFromV2` 的 catch 从"先包 `LedgerMigrationFailedError` 再外层映射"改为 map-first——迁移期 BUSY 直通进重试环(A02 单测实证旧行为会把锁超时包成 `LEDGER_MIGRATION_FAILED`,错误族错位);`OrdariumError` 原样直通,其余才包迁移失败。
3. **`mapSqliteFailure` errstr 扩展**:node:sqlite 的 `code` 恒为 `ERR_SQLITE_ERROR`,SQLite 层错误码在 `errstr`;补 `SQLITE_BUSY`/`SQLITE_LOCKED`、`SQLITE_CORRUPT`/`SQLITE_NOTADB`、"file is not a database" 文案三族识别(同一错误族合同内的映射补全,无新错误码)。
4. **死代码删除**:`#closeSilently` 被重试环的显式关闭取代,一并移除——不留兼容桩。
5. **harness**:`tools/stress-worker.mjs` 增 `open-probe` 模式(裸调构造器,不经 G12 时代的外层重试包装——被测机制即内置退避,包装会掩盖承重);`tools/stress-matrix.mjs` 增 `--open-race` 腿:4 热写 + 6 opener 同 tick 齐发抢**新建库**(G12 实证构造器 `LEDGER_BUSY` 的正是该窗口),probe 恰好一行 stdout 由父进程解析。

## 影响面

- 声明面:仅 `snapshots/api/ledger-sqlite/index.d.ts`(openRetry 字段 + `SqliteLedgerOpenRetry`);core/dsh/testing/host-mcp 声明零漂移,root façade 19 curated 零变化,`sqlite-v3.json` 基线零变化(无 schema 改动),错误码清单零新增。
- 行为面:默认 open 撞 BUSY 从"一次性抛"变为"有界退避后抛"(2026-08-29 会话决议:默认开有界退避);`openRetry: {attempts:1}` 保留现行 fail-fast 语义。运行期写路径(`claim`/`compareAndSet` 等)的 BUSY 上抛**不动**——G12 已证其为诚实争用信号,本 Goal 不构成"静默重试"先例。

## 旧调用/旧数据的转换位置

无数据转换:库 schema 不变,既有 v1/v2/v3 库打开路径除重试环包裹外逐字节等价。代码侧 `openRetry` 为可选字段,未传即默认退避——这是决议变更的默认行为,非兼容层;需要旧行为的宿主显式传 `attempts:1`。

## 旧路径删除时点

随本 delta 即时:`#closeSilently` 删除;迁移 catch 双层包装(先 wrap 后 map)收敛为 map-first 单一路径,无开关、无双路径。

## 证明测试

- 单测(ledger-sqlite `test/open-retry.test.ts`,5 项):
  - 默认退避把 open 跨过锁释放边界——v2 库携 operation 行 + 子进程持 `BEGIN IMMEDIATE` 锁,`timeoutMs:100` 压掉 sqlite 自身 busy_timeout,使**构造器重试环承重**;断言打开成功、`user_version` 3、记录逐字节保留(G16-A01 单测版);
  - `attempts:1` 撞锁快速抛 `LEDGER_BUSY`(G16-A02);corrupt 库与更新 schema 均 <300ms 一次性抛 `LEDGER_CORRUPT`/`LEDGER_NEWER_SCHEMA`(G16-A03);非法 `openRetry` 抛 `TypeError`(G16-A04);耗尽退避抛 `LEDGER_BUSY`。
- 矩阵腿:`node tools/stress-matrix.mjs --open-race` → 4 热写 + 6 opener,`allOpenersSucceeded: true` 且 `noLostUpdate: true`(两跑复证),结果落 `evidence/G16/open-race-results.json`(G16-A01)。
- 治理(G16-A05):`pnpm verify:architecture`(快照漂移仅限 ledger-sqlite 声明面)、`pnpm verify:docs`、全仓 `pnpm check` 于 exit report 记录。
