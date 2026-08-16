# G0 基线报告：架构冻结与机器化证据

> Goal revision：`ORDARIUM-GOALS-2`（docs/17 §8）
> 日期：2026-08-16　执行环境：Windows 10 (26200)、Node v24.14.1、pnpm 11.21.0（manifest 声明 11.16.0）、TypeScript 7.0.2

## 1. 命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm check` | 通过；tsc composite build 全绿，Vitest 5 文件 17 测试全部通过（core 2+9、testing 1、dsh 3、ledger-sqlite 2） |
| `pnpm verify:architecture` | 通过；见 §2 |
| `pnpm snapshots:update` | 生成 6 份快照（4×API、contracts.json、sqlite-v1.json），与 Delta Sheet 绑定提交 |

负面测试（证明 gate 有牙，G0-A03）：

- 篡改 `snapshots/contracts.json` 的一个错误码后运行 `pnpm verify:architecture` → 失败，精确报出漂移文件、行号与 stored/current 差异，exit code 1；
- 随后 `pnpm snapshots:update` 恢复，再次 verify 通过。

## 2. verify:architecture 覆盖项

`ordarium/tools/verify-architecture.mjs`，无第三方依赖，单命令完成：

1. 先执行 `pnpm run build`，保证快照来自当前源码；
2. 包集合 = 冻结四包（core/ledger-sqlite/dsh/testing）；声明依赖与 src 实际 import 双向核对；workspace 依赖按 allowlist 检查（core 零依赖、ledger-sqlite→core、dsh→core+ledger-sqlite、testing→core）；外部依赖必须为零；core 只允许 `node:` 内建 + 相对导入；依赖图 DFS 查环；
3. public API 快照：每包 `dist/src/index.d.ts` 全文入 `snapshots/api/`；export map、包图、import 扫描入 `snapshots/contracts.json`；
4. 冻结 union 提取：10 个错误码、10 个 OperationState、5 个 GuaranteeLevel、3 个 RuntimeCheckpoint；
5. SQLite 基线：确定性 fixture（create rev0 → CAS rev1）→ `SqliteLedger` close → **reopen** 断言 record round-trip 与双 revision history → 只读转储 PRAGMA（`application_id=0x4F524441`/ORDA、`user_version=1`、`journal_mode=wal`）、schema SQL、两表行内容入 `snapshots/sqlite-v1.json`；
6. Compatibility Register 解析校验：6 项登记，ID 唯一且六列（边界/来源/target/owner/移除决定）非空。

## 3. 当前 public surface 摘要

见 `snapshots/contracts.json` 与 `snapshots/api/*.d.ts`。要点：四包均 `private: true`、0.2.0、单 `"."` 入口（无 subpath —— `/advanced` 是 G1 切换项，登记 `COMPAT-API-002`）；dsh 根入口当前宽 `export *` core 并重导出 `SqliteLedger`；`OperationLedger` port 尚无 `LedgerCapabilities`。

## 4. 架构追溯（G0-A05）

| docs/17 §3 目标框 | 当前落点 | 备注 |
|---|---|---|
| Action DSL | `packages/core/src/action.ts`、`json.ts` | docs/13 |
| `@ordarium/core` 唯一语义 | `core` 包 runtime/types/ledger | 无第二状态源 |
| HostInvocationPort | `dsh` 包内 `DshToolRunContext` 结构映射 | 正式 port 在 G5 抽取（COMPAT-DSH-001） |
| OperationLedgerPort | `core/src/types.ts` `OperationLedger` | capability 合同 G1 冻结（COMPAT-LEDGER-001） |
| SQLite reference ledger | `@ordarium/ledger-sqlite` | WAL/FULL/STRICT，见 sqlite-v1.json |
| MemoryLedger | `core/src/ledger.ts` | volatile 合法弱模式 |
| `@ordarium/testing` | `testing` 包 | FaultInjector/ManualClock/fixedIdentity |
| OperationsPort | 未实现 | G4 交付 |
| author root / advanced | 当前合一（宽导出） | G1 切换（COMPAT-API-002） |
| Provider side | `Action.execute/reconcile/cancel` 内联合同 | conformance G6 |

## 5. 验收映射

| ID | 证据 |
|---|---|
| G0-A01 | §1：`pnpm check` 绿，17 测试计数在案 |
| G0-A02 | §2.2：包集合/allowlist/环检查机器化；core 无 DSH/Provider/SQLite 依赖 |
| G0-A03 | §2.3 + §1 负面测试：无解释 diff 必然 fail gate |
| G0-A04 | §2.5：sqlite-v1.json 固定 PRAGMA/schema/record，含 reopen 断言 |
| G0-A05 | §4 追溯表；12–17 对同一职责无冲突表述 |
| G0-A06 | `target-contract-decisions.md`：façade/profile/auth/principal/record/lease/pagination/capability/Node policy 全部单一 target，未决项为零 |
| G0-A07 | `../compatibility-register.md`：6 项全部有 owner 与移除决定，机器校验通过 |

G0 exit gate（docs/17 §8.4）：public、schema、dependency 三类 diff 均可自动产生（§2.3/2.5 + contracts.json），target record/lease 模型已冻结（决策单）。

## 6. 已知缺口（非 G0 范围，归属后续 Goal）

与 docs/17 §2.1 一致：managed direct run 随机 identity（G1）、矛盾授权无 conflict（G1）、record codec 浅校验（G1）、heartbeat 追加完整 revision snapshot 写放大（G2）、无 infrastructure error family（G2）、无 Runtime 生命周期与有界 drain（G3）、无 Operations/recovery material（G4）、DSH 私有类型与 fixture 不足（G5）、Provider conformance 未证（G6）、四包 private 无 tarball 消费验证（G7）。

## 7. 未完成项

无 G0 遗留。`verify:docs`、`test:integration`、`test:conformance`、`test:package`、`verify:release` 等命令按 docs/17 §18.3 属后续 Goal 交付时建立，本阶段不预置空壳。
