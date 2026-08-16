# Delta G1-002：`@ordarium/dsh` 精选 façade 切换（COMPAT-API-002）

- 变更分类（docs/17 §7.2）：C 破坏性合同变化（private 阶段 clean break，无外部消费者）
- 影响面：public API（dsh root/subpath export map）/ 宿主映射 / 验证工具
- 依据：docs/12 §5、docs/17 GOALS-3 §9.2.10、G1-A08；Compatibility Register `COMPAT-API-002`

## 目标结构与理由

1. dsh 源码拆为三模块：`advanced.ts`（全部 DSH 类型 + `asDshTool`/`registerActions`/`createDshOrdarium`/`defaultDatabasePath`）、`install.ts`（`installOrdarium` golden path）、`index.ts`（精选 façade，仅再导出）。
2. 根入口值导出恰为六个：`defineAction`、`defineSchema`、`effects`、`installOrdarium`、`jsonValueSchema`、`schema`；类型导出限于作者合同类型（Action/ActionDefinition/ActionExecutionContext/ActionSchema/AuthorizationDecision/EffectProfile/InvocationIdentity/JsonObject/JsonValue/ReconcileResult/InstallOrdariumOptions/CreateDshOrdariumOptions/DshOrdarium）。
3. 宽 `export * from "@ordarium/core"` 与 `SqliteLedger` 重导出删除；Runtime、Ledger、raw record、migration 不再可从 root 命名导入（透传类型引用如 `DshOrdarium.runtime` 属声明可达性，不构成命名导出）。
4. export map 固定为 `.` 与 `./advanced` 两个入口；框架作者继续显式依赖 `@ordarium/core`/`@ordarium/ledger-sqlite`。

## 旧调用/旧数据的转换位置

无 durable 数据。仓库内调用者一次性更新：`packages/dsh/test/adapter.test.ts` 改从 `../src/advanced.js` 导入。

## 旧路径删除时点

本变更集内已完成：宽根入口不存在，无 legacy façade 分支。

## 证明旧路径不再产生状态的测试

- `packages/dsh/test/exports.test.ts`：root 值导出集合与白名单**恰等**；`OrdariumRuntime/SqliteLedger/OperationRecord/asDshTool/...` 不出现在 root；`/advanced` 导出低层 API；经包名 self-import 验证 export map 解析。
- `tools/verify-architecture.mjs` 新增 root 再导出白名单检查（源级）+ export map 必须含 `.` 与 `./advanced`。

## 需要同步更新的文档

docs/14 §1（façade 状态）、docs/17 §2.1/§2.2（缺口清单与 G1 进度）、Compatibility Register `COMPAT-API-002`（已执行）。

## 快照变化

`snapshots/api/dsh/index.d.ts`（精选后表面）、新增 `snapshots/api/dsh/advanced.d.ts`、`snapshots/api/dsh/install.d.ts`；`snapshots/contracts.json`（dsh exports map 增加 `./advanced`）。
