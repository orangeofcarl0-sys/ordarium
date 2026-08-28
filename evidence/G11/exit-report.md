# G11 Exit Report:管理型 state kind(一种时间线,三种墨水)

> 依据:`evidence/G11/design-spec.md`(2026-08-29 会话决议冻结四项分叉)
> 完成日期:2026-08-29　环境:Windows 10 (26200)、Node v24.14.1、TypeScript 7.0.2
> Delta:`evidence/G11/delta-G11-001-state-kind.md`(B 加法合同 + D 边界变化)

## 1. 决议落地核对

| 会话决议 | 落地 |
|---|---|
| ① refs 一等 + 反向查询 | `StateRecord.refs` 必填;写入期存在性校验(`STATE_REF_NOT_FOUND` fail-closed);`ordarium_state_refs` 反查表 + `listStatesReferencing`(两种 ref_kind,canonical 序 + 游标) |
| ② 修订 docs/14 §5 | "两个权威、两个存储"→"管理型事件经 state 合同落共账;Palimpsest 仍为唯一语义权威,内核只存不释"(docs/14 §5、docs/13 §11、docs/15 §28 同步) |
| ③ 乐观 CAS 单原语 | `compareAndSetState(namespace, key, expectedRevision, next)`,0=创建;无 lease/fence;写门槛 = 身份 + 授权证据 |
| ④ 每修订内容摘要 | `valueDigest = digestJson(value)`,decode 期重导出——损坏在账本边界落 `LEDGER_CORRUPT`;无链式不变量(宣称纪律内) |

## 2. 验收矩阵(spec §7)

| ID | 证据 |
|---|---|
| G11-A01 | `core/test/state.test.ts` "creates on revision 0…" + "describes the conflicting current revision…" + sqlite 同名场景(并发竞态由 BEGIN IMMEDIATE 单写者串行化承载) |
| G11-A02 | "pages the revision chain…" + conformance 历史分页组(absent subject 空页) |
| G11-A03 | refs 三组:悬空 operation/state 引用拒绝、合法引用入反查索引、`listReferencing` 恰确分页(operation+state 两 kind) |
| G11-A04 | `NoStateLedger` 桩(stateRevisions: false)写入前 `LEDGER_CAPABILITY_REQUIRED`、零写入 |
| G11-A05 | 共享基建错误族覆盖:`mapSqliteFailure` 的 LEDGER_FULL 映射与既有 G2-A07 家族测试;state 写入走同一事务路径,无专用分支 |
| G11-A06 | "enforces the state value persistence limit"(maxValueJsonBytes=16 夹具) |
| G11-A07 | "honors the runtime lifecycle on writes"(quiesce→`RUNTIME_QUIESCING`;dispose→`RUNTIME_CLOSED`) |
| G11-A08 | `exports.test.ts` advanced 集 + root 禁止清单;`verify:architecture` root façade 19 curated 不变;快照冻结 |
| G11-A09 | `testing/test/state-ledger-conformance.test.ts`(MemoryLedger)+ `ledger-sqlite/test/state.test.ts` conformance 场景——同一 `runStateLedgerConformance` 双实现全绿 |
| G11-A10 | "filters operations by identity scope"(core 行为级 + sqlite json_extract 级)——预算即账本查询可表达 |
| G11-A11 | "migrates a v2 database additively and keeps every operation byte identical"(降版本重开→自动升 v3→数据逐字节保留) |

## 3. 文档同步

docs/13 §11(管理型 state 合同)、docs/14 §5(存储条款修订)、docs/15 §28(三墨水架构节)、docs/17 §16.6(G11 目标)、docs/dev/04(+2 错误码、迁移行修正)、docs/dev/06(三种墨水导览)、docs/dev/11(新章)、docs/dev/README(角色路径)。另:本会话早前已完成档案 04§6.2/05§5.3 两项快赢(dev/01 pnpm 工作区成员消费模式、dev/10 宿主职责合同项)并修正档案行动项核对结论(04§6.1 桥接、04§6.3 授权示例已被 G5/G9 满足)。

## 4. 最终命令与输出

```text
pnpm check                → tsc -b 全绿;29 test files, 165 tests passed
pnpm verify:architecture  → passed;root façade 19 curated;errorCodes 29;sqlite-v3 基线
pnpm verify:docs          → passed(26 documents)
```

## 5. 承袭披露

- **Palimpsest 迁移是姊妹仓库里程碑**:收缩自建事件日志、消费 `createStateStore`、焊 `OPERATION_UNCERTAIN` 接缝——命题二判据①(第二真实宿主共账)与判据②(真实恢复案例成文)的载体,合同零改动预期。
- Node 矩阵:engines 未变(ledger-sqlite/dsh/host-mcp `>=24.15.0`);`verify:matrix` 依赖 Docker 宿主,本机未复跑,G7 矩阵结论不受本 Goal 影响(纯 Node 层加法,无新增原生/平台面)。
- 真实 DSH 插件 manifest 接线仍待 DSH 发布包可消费(G5/G7/G9 同一遗留项)。
