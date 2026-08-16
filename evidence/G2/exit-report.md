# G2 Exit Report：Ledger、Lease 与平台基础

> Goal revision：`ORDARIUM-GOALS-3`（docs/17 §10）；目标形状冻结于 `design-spec.md`（G2-000）
> 完成日期：2026-08-16　环境：Windows 10 (26200)、Node v24.14.1、pnpm 11.21.0、TypeScript 7.0.2

## 1. 变更范围（原子切片，附 Delta Sheet）

| Delta | 内容 |
|---|---|
| G2-000 | 设计规范冻结（`design-spec.md`：v2 schema/端口/迁移/分页/错误族/备份保留/验收映射） |
| G2-001 | record/port v2 原子切换：types/codec/MemoryLedger/runtime + 全量测试迁移 |
| G2-002 | SQLite v2 平台：lease 表、fence CAS、轻量续约、分页、infra 错误族、事务性迁移、engines 政策 |

## 2. 验收矩阵（docs/17 §10.4）

| ID | 证据 |
|---|---|
| G2-A01 迁移保真 | `ledger-sqlite/test/g2.test.ts` "migrates a v1 database transactionally..."：v1 fixture（succeeded + dispatched-with-claim）→ 字段级断言（digests/state/semanticRevision/attempt/fence/outcome）+ claim→lease 拆取 |
| G2-A02 迁移故障回滚 | 同文件 "rolls the migration back..."：损坏 v1 → `LEDGER_MIGRATION_FAILED`，`user_version=1`、v1 表结构完整 |
| G2-A03 心跳写放大 | 同文件 "keeps semantic history frozen..."：执行期多次续约，semanticRevision=3 冻结、history 不增长、`lease_revision>1`、完成后 lease 消失；Memory 侧等价断言见 `core/test/runtime.test.ts` |
| G2-A04 终态 vs 接管 | 同文件 "rejects a stale owner's terminal write..."：lease 过期接管 fence+1，旧 owner 终态 CAS 拒绝（`OPERATION_BUSY`），记录停在 uncertain |
| G2-A05 双进程竞争 | 同文件 "lets exactly one of two real node processes claim..."：真实 `child_process.spawn` × 2，一成功一 `OPERATION_BUSY`，attempts=1 |
| G2-A06 分页一致 | 同文件 "paginates list and history identically..."：23 记录 limit=7 游标遍历，Memory=SQLite 全序一致、无遗漏/重复 |
| G2-A07 infra 错误族 | 同文件 "maps infrastructure failures..."：busy（真实锁）/closed/corrupt/newer-schema/foreign-app 全部稳定 code；损坏读取 `LEDGER_CORRUPT` |
| G2-A08 备份 | 同文件 "backs up a WAL database..."：checkpoint(TRUNCATE) + 副本 reopen，current/history 一致 |
| G2-A09 旧备份恢复 | 同文件 "reconverges through the provider operation key..."：恢复后重投经同 operation key 与 Provider 事实收敛，业务效果计数不增 |
| G2-A10 Node 政策 | engines 已冻结（ledger-sqlite/dsh `>=24.15.0`，core/testing `>=24.0.0`）；**真机矩阵已闭环（2026-08-17 补录）**：Docker 双腿 24.15.0/24.19.0 各 118 测试 + verify 全绿，见 `../G7/node-matrix-report.md`（`pnpm verify:matrix` 可复跑） |
| G2-A11 能力矩阵 | `core/test/capability.test.ts`（G1-007 交付，v2 下全绿） |
| G2-A12 双宿主共账 | 同文件 "shares one ledger across two hosts..."：业务键跨宿主汇合为单 operation、默认 identity 不折叠、`identity.source` 可区分审计 |

## 3. 交付物核对（docs/17 §10.3）

事务性迁移 ✓；`ORDA`/`user_version=2`/`schemaVersion=2` ✓（快照固定）；单一 codec 无 union ✓；core/Memory/SQLite/runtime/fixtures 同切片切换 ✓；静态 capabilities + gate ✓（G1-007）；语义 CAS 与 lease 续约分离 ✓；语义 `updatedAt` 与 liveness 分离 ✓（heartbeat 零语义写，A03）；终态 owner/fence 原子验证 ✓（A04）；cursor 分页统一 ✓（A06）；稳定 infra mapping ✓（A07）；WAL 一致备份证据 ✓（A08）；no-auto-GC/保留策略冻结 ✓（design-spec §7）；Node 政策 ✓（engines，矩阵归 G7）；open 失败/能力不足 fail closed 无 fallback ✓（A07 + G1-A10）；双进程真实文件竞争 ✓（A05）；双宿主共账 ✓（A12）。

## 4. 快照 / 依赖 / 错误码演进

- `sqlite-v1.json` → `sqlite-v2.json`（三表 + lease 序列化 + user_version=2）；
- `contracts.json` 错误码 16 → 23（新增 `LEDGER_OPEN_FAILED/NEWER_SCHEMA/MIGRATION_FAILED/BUSY/CORRUPT/CLOSED/FULL`）；
- 依赖图不变（core 零外部依赖）；分包含 engines 字段；
- Compatibility Register：`COMPAT-DB-001` 已执行。

## 5. 开发中抓到并修复的缺陷

迁移边界曾对任意 JSON 直接盖 v2 章（补 `assertV1Record` 浅校验，A02 证明）；`BEGIN IMMEDIATE` 位于 try 外绕过错误映射（移入）；worker fixture 的 TS 泛型语法被裸 Node 解析（移除）。

## 6. 未完成项（归属后续 Goal）

- finite `idempotencyExpiresAt` 的执行期强制、quiesce/drain 生命周期、统一 recovery evaluator → **G3**；
- Operations/recovery material/跨 agent 审计视图 → G4（分页合同已就绪，G4 只消费）；
- Operations/recovery material/跨 agent 审计视图 → G4（已完成）；真实 DSH lifecycle → G5（已完成）；
- tarball 消费验证与发布工程 → G7；
- ~~真机 24.15+ Node 矩阵~~ → **已闭环**（`../G7/node-matrix-report.md`）。

## 7. 最终命令与输出

```text
pnpm check                → tsc -b 全绿；15 test files, 74 tests passed
pnpm verify:architecture  → passed；dsh root façade 19 curated；register 6 entries；快照零未解释漂移
```

G2 exit gate 达成：storage/lease/pagination/基础设施错误合同全部冻结并有失败注入证据；G3 可在单一 recovery evaluator 与 Runtime 生命周期上继续。
