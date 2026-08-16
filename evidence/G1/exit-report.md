# G1 Exit Report：Core 合同冻结

> Goal revision：`ORDARIUM-GOALS-3`（docs/17 §9）
> 完成日期：2026-08-16　环境：Windows 10 (26200)、Node v24.14.1、pnpm 11.21.0、TypeScript 7.0.2

## 1. 变更范围

八个原子切片，全部附 Architecture Delta Sheet（本目录）：

| Delta | 内容 | 提交 |
|---|---|---|
| G1-001 | HostInvocationPort 冻结、`IDENTITY_REQUIRED`、HostAdapterHarness | —（并入 `7bef152`） |
| G1-002 | `@ordarium/dsh` 精选 façade + `/advanced`（COMPAT-API-002 执行） | `2ce940a` |
| G1-003 | 分类 evidence kind + `AUTHORIZATION_CONFLICT` | `3ff1817` |
| G1-004 | EffectProfile `kind` 判别 union + 派生助手 | `e457f77` |
| G1-005 | ProviderPrincipalRef + digest 绑定 + `PRINCIPAL_CONFLICT` | `4992ca2` |
| G1-006 | core 独占完整 record codec + `RESOURCE_LIMITS` + `INPUT_TOO_LARGE` | `4a84535` |
| G1-007 | LedgerCapabilities 必填声明 + eligibility gate + `LEDGER_CAPABILITY_REQUIRED` | `c7fb789` |
| G1-008 | `contractFingerprint` + `CONTRACT_DRIFT` | 本次提交 |

## 2. 验收矩阵（docs/17 §9.4）

| ID | 场景 | 证据 |
|---|---|---|
| G1-A01 | managed 无 identity | `core/test/host-port.test.ts`（fail closed，ledger 零写入） |
| G1-A02 | 矛盾授权 / 伪造 kind | `core/test/authorization.test.ts`（6 项）+ dsh `adapter.test.ts` kind 断言 |
| G1-A03 | 同 identity 不同 input | `core/test/runtime.test.ts:121`（OperationConflictError） |
| G1-A04 | 同名版本 metadata 漂移 | `core/test/fingerprint.test.ts`（4 项） |
| G1-A05 | finite idempotency 目标唯一表达 | docs/13 §1.1 + `evidence/G0/target-contract-decisions.md` §2 + `core/test/effects.test.ts` 窗口校验（持久化归 G2/G3，合同唯一） |
| G1-A06 | 嵌套损坏 fail closed | `core/test/codec.test.ts`（15 损坏类 + 11 不变量）+ `ledger-sqlite/test/sqlite.test.ts` 原生损坏注入 |
| G1-A07 | 资源上限 | `core/test/codec.test.ts` envelope 组（input/identity/lineage）+ 既有 output/receipt 上限测试 |
| G1-A08 | root/subpath 面 | `dsh/test/exports.test.ts`（值导出恰等）+ `verify:architecture` root 白名单（19 curated） |
| G1-A09 | 依赖审计 | `tools/verify-architecture.mjs`：core 零外部依赖、仅 `node:`+相对导入、无循环（contracts.json importScan） |
| G1-A10 | ledger 能力资格 | `core/test/capability.test.ts`（6 项）+ sqlite caps 声明测试 |
| G1-A11 | principal 连续性 | `core/test/principal.test.ts`（5 项） |
| G1-A12 | HostInvocationPort 冻结 | `snapshots/api/core/host.d.ts` + core 快照零宿主类型（`grep DshTool/ToolRunContext` = 0）+ `testing/test/host-harness.test.ts` |

## 3. 快照 / 依赖 / schema 演进

- API 快照：目录化全量声明（12 个 .d.ts），随各 delta 更新；错误码从 10 → 16（新增 `IDENTITY_REQUIRED`、`AUTHORIZATION_CONFLICT`、`PRINCIPAL_CONFLICT`、`INPUT_TOO_LARGE`、`LEDGER_CAPABILITY_REQUIRED`、`CONTRACT_DRIFT`）；
- 依赖图：四包 allowlist 不变，core 保持零外部依赖；dsh root 白名单机器化；
- schema：SQLite `user_version=1` 不变；record v1 新增可选 `providerPrincipalDigest`、`contractFingerprint` 字段（codec 校验），v2 目标形状维持 docs/13 §7 冻结。

## 4. 失败注入与负面覆盖

非仅 happy path：损坏记录读取即拒（内存+SQLite 原生注入）、矛盾授权/漂移/换 principal 全部"持久决定不变 + Provider 零调用"、能力不足/拓扑不覆盖零 operation、超限输入零持久化、盲重试负面断言（uncertain 不重试）维持全绿。

## 5. Compatibility Register 变化

`COMPAT-API-002` 已执行（G1-002）；无新增匿名层。

## 6. 文档同步

docs/12（PRODUCT-3）、13（CONTRACT-2 目标形状已全部实现于当前 v1 或决策冻结）、14（快照逐行更新）、15（ARCH-3 + 错误表）、16（ATLAS-3 + 错误图谱）、17（GOALS-3 状态与缺口清单）与代码同步；`pnpm verify:architecture` 快照零未解释漂移。

## 7. 未完成项（归属后续 Goal）

- v2 record/schema 原子切换、live lease 分离、heartbeat 写放大消除、pagination 统一、infrastructure error family、migration/backup、双进程与双宿主共账 fixture → **G2**；
- finite deadline 持久化后的执行期强制 → G3；
- Operations/recovery material/跨 agent 视图 → G4；
- DSH 正式类型与 host-mcp → G5；Provider conformance → G6。

## 8. 最终命令与输出

```text
pnpm check                → tsc -b 全绿；14 test files, 64 tests passed
pnpm verify:architecture  → passed；dsh root façade 19 curated；register 6 entries
```

G1 exit gate 达成：G1 全部验收 ID 有自动化证据，仓库处于"单一生产路径、全绿、快照冻结"状态，G2 可在一个 atomic slice 内切换 SQLite schema v2。
