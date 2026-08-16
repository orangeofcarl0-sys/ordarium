# G9 Exit Report：运维面与官方 DSH 插件壳

> 依据：`evidence/G9/design-spec.md`（2026-08-17 会话决议冻结）
> 完成日期：2026-08-17　环境：Windows 10 (26200)、Node v24.14.1、TypeScript 7.0.2

## 1. 决议落地核对

| 决议（spec §1/§2） | 落地 |
|---|---|
| Ordarium 以插件形式进入 DSH，统一管理与形式 | `createOrdariumPlugin`（`/advanced`）：进程级实例所有者 + 共享 ledger + 统一生命周期 |
| 自有功能仅运维面 | 四个 `ordarium_*` 工具 + `plugin.ops`，opt-in、受 OperatorAuthorization 保护 |
| 不做 action 注册面 / 调度 / 审批 UI / 凭据 | 壳内无任何此类表面；authoring 仍在 root façade 的业务插件 |
| 模型只见脱敏视图 | 工具输出 = ModelOperationView 八字段白名单（测试恰等断言） |
| reconcile 永不 execute | 委托 G4 `reconcileOnly`；absent+retrySafe → uncertain，execute spy 零增长 |

## 2. 验收矩阵（spec §3）

| ID | 证据 |
|---|---|
| G9-A01 | `dsh/test/plugin.test.ts` "owns a shared instance"（二次注册共享 ledger，同调用去重、单执行） |
| G9-A02 | "without the operations option"（无 `ordarium_*` 工具、`ops` undefined） |
| G9-A03 | "operations register the four tools"（四工具 + inspect/list model 视图白名单） |
| G9-A04 | "authorization boundary"（构造期伪造 scope 拒绝；读权限经 `ops.reconcileOnly` 得 `OPERATOR_AUTHORIZATION_REQUIRED`） |
| G9-A05 | "reconcile resolves..."（匹配落 reconciled；错配 `OPERATION_CONFLICT`）+ A05b（absent+retrySafe spy 零增长） |
| G9-A06 | "dispose follows the frozen lifecycle"（closed + `RUNTIME_CLOSED`） |
| G9-A07 | `host-mcp/test/mcp.test.ts` "dispatches the opt-in ordarium_inspect"（未 opt-in 不列出；opt-in 后分发脱敏视图） |
| G9-A08 | root façade 白名单零漂移（verify:architecture 19 curated 不变）；exports.test advanced 集 + 禁止清单更新；快照冻结 |

## 3. 审计缺漏修复（见 delta §"审计缺漏修复清单"）

host-mcp inspect 声明-分发缺漏 ✓；Palimpsest 方向文档修订（docs/14 §5、G8 spec §4）✓；docs/12 §5 / docs/13 §10 插件壳归位 ✓；recoveryMaterial 端到端消费闭合 ✓。

## 4. 最终命令与输出

```text
pnpm check                → tsc -b 全绿；26 test files, 140 tests passed
pnpm verify:architecture  → passed；root façade 19 curated；register 6 entries
node tools/verify-docs.mjs→ passed（21 documents）
```

## 5. 承袭披露

真实 DSH 插件 manifest 接线待 DSH 发布包可消费（G5/G7 同一遗留项）；届时接 manifest，合同零改动预期。
