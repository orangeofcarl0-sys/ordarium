# G16 Exit Report：`SqliteLedger` 打开退避重试

> 依据：`evidence/G16/design-spec.md`（2026-08-29 冻结，同日解除休眠实施）；
> 完成日期：2026-08-29；环境：win32 x64，Node v24.14.1；性质：B 类加法合同 +
> C 类错误映射修复 + G12 harness 扩腿（evidence/tools 面），零 schema 变更。

## 1. 验收矩阵

| ID | 验收项 | 证据 | 结果 |
|---|---|---|---|
| G16-A01 | 并发 open 赛跑（G12 harness 扩腿）：4 热写进程 + 6 opener 进程同 tick 齐发抢**新建库**（G12 实证构造器 `LEDGER_BUSY` 的正是该窗口），默认配置下全部 opener 在内置退避内打开成功、修订链无丢失更新、零句柄泄漏（临时目录可删） | `evidence/G16/open-race-results.json`（两跑独立复证：`allOpenersSucceeded:true`、`noLostUpdate:true`）；单测版 A01 另行承重 | PASS |
| G16-A01'（单测版） | 子进程持 `BEGIN IMMEDIATE` 锁跨释放边界，`timeoutMs:100` 压掉 sqlite 自身 busy_timeout，构造器重试环承重把 v2 库打开并迁移至 v3、记录逐字节保留；同步机制为**轮询探测锁确已被持有**（零 busy_timeout 的 `BEGIN IMMEDIATE` 失败即为确认），替代脆弱的固定头程等待——本阶段曾实证 120ms 头程在负载下被 Node 启动时间击穿（elapsed 8ms 假绿），已修 | `packages/ledger-sqlite/test/open-retry.test.ts`（修复后连续 4 次全绿） | PASS |
| G16-A02 | `openRetry: {attempts:1}` 保留 fail-fast：撞锁一次性抛 `LEDGER_BUSY` | 同上（A02 用例；另含耗尽退避仍抛 `LEDGER_BUSY` 的稳定错误族用例） | PASS |
| G16-A03 | 非 BUSY 不重试：corrupt 库 <300ms 一次性抛 `LEDGER_CORRUPT`、更新 schema 一次性抛 `LEDGER_NEWER_SCHEMA`；顺带修复 `mapSqliteFailure` 对 `errstr`（`SQLITE_NOTADB` 等）的识别空档——修复前 corrupt 库抛裸 `ERR_SQLITE_ERROR` | 同上（A03 用例，`attempts:5` 配置下验证不消耗重试） | PASS |
| G16-A04 | `openRetry` 参数校验：非正整数 `attempts`、负 `delayMs`、NaN、非对象均抛 `TypeError` | 同上（A04 用例） | PASS |
| G16-A05 | 治理：dsh/发布面零变化；root façade 19 curated 零漂移；兼容登记 6 条目零变化；`contracts.json`/`sqlite-v3.json` 字节不变；快照漂移**仅限** `snapshots/api/ledger-sqlite/index.d.ts`（+13 行：`openRetry` 字段 + `SqliteLedgerOpenRetry` 导出）；错误码清单零新增 | `pnpm verify:architecture` 全绿 + `git diff --stat snapshots/`（仅上述一文件） | PASS |

## 2. 结论

- 打开撞写锁由内核**默认吸收**：整个打开序列（建目录 → 连库 → PRAGMA → app_id/user_version 门 → 建表/迁移）收进同步重试环，默认 `{attempts:5, delayMs:100}`（最坏约 400ms），仅 `LedgerBusyError` 触发重试；corrupt/更新 schema/app_id 不符/迁移失败照旧一次性 fail-closed；重试间显式关闭句柄、耗尽后置 `#closed` 再抛——零句柄泄漏。G12 附带发现一（"宿主应带退避重试 open"）就此在内核侧闭环，运行期写路径的 BUSY 上抛语义**未动**，不构成"静默重试"先例。
- 迁移 catch 收敛为 map-first 单一路径：迁移期 BUSY 直通进重试环（修复前会被包成 `LEDGER_MIGRATION_FAILED` 错位族），`OrdariumError` 直通、其余才包迁移失败；`#closeSilently` 死代码删除。无兼容层、无开关。
- `sleepSync` 经 `Atomics.wait` 实现同步休眠（构造器为同步路径）；`openRetry: {attempts:1}` 是想回到 fail-fast 的宿主的显式退路。
- 压测口径：open 赛跑腿两次独立运行均 6/6 opener 成功、`noLostUpdate:true`（writerSuccesses 3842 / 3752，K=4 热写 + 6 opener × 3s）；单测重试环承重用例修复同步竞态后连续 4 次全绿。

## 3. 最终命令与输出

```text
$ pnpm check
 Test Files  30 passed (30)
      Tests  171 passed (171)

$ node tools/stress-matrix.mjs --open-race   （× 2 独立运行）
open race: {"writers":4,"openers":6,"writerSuccesses":3842,"noLostUpdate":true,
            "openersOpened":6,"allOpenersSucceeded":true}
open race: {"writers":4,"openers":6,"writerSuccesses":3752,"noLostUpdate":true,
            "openersOpened":6,"allOpenersSucceeded":true}
→ evidence/G16/open-race-results.json

$ pnpm snapshots:update   （delta sheet 之后执行）
→ 漂移仅限 snapshots/api/ledger-sqlite/index.d.ts（+13 行）
$ pnpm verify:architecture
verify:architecture passed
  - dsh root façade: 19 curated exports verified
  - compatibility register: 6 entries verified
$ pnpm verify:docs
verify:docs passed (26 documents checked)
```

## 4. 未完成项

- git push、`ordarium-v1.1.0` tag 与 GitHub Release（附五包 tarball）仍由用户执行——与本 Goal 无耦合的既有交接项。
- `verify:matrix`（Docker 矩阵）仍未在本机复跑：本 Goal 零包依赖变更（ledger-sqlite 既有依赖不变），与 G12 同口径披露。
- G13/G14/G15 依各自触发条件继续休眠（docs/17 §16.8）。
