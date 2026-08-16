# Delta G9-001：运维面与官方 DSH 插件壳

- 变更分类（docs/17 §7.2）：B 加法合同（`/advanced` 新导出 + core 导出一个校验函数）+ 审计缺漏修复
- 依据：`evidence/G9/design-spec.md`（2026-08-17 会话决议冻结）

## 目标结构与理由

1. **`packages/dsh/src/plugin.ts` → `/advanced` 导出 `createOrdariumPlugin(options)`**：
   - 进程级实例所有者：默认构造 durable runtime（local-multi-process 拓扑）；`databasePath`/`runtime` 注入语义与 createDshOrdarium 一致；
   - `register/tool` 复用既有 asDshTool；`dispose/close` 走 G3 字面序；
   - **opt-in 运维面**：`operations.authorization` 提供时——构造期经 core 导出的 `assertOperatorAuthorization` 校验（伪造 scope/缺失字段在注册任何工具前失败）；注册四个 `ordarium_*` 工具（inspect/list/history/reconcile）；`plugin.ops` 进程内 API（operator 审计视图）；
   - 工具输出 = `projectModelView`（脱敏八字段白名单）；reconcile 工具经 `operationIdentityPreview` 重推导 operationId 后委托 G4 `reconcileOnly`（永不 execute）；recoveryMaterial 绑定由壳持有（G4 来源 1）。
2. **host-mcp 审计缺漏修复**：`ordarium_inspect` 此前在 `tools/list` 声明但 `tools/call` 未分发（返回 Unknown tool）——补齐分发：opt-in 授权在场时经 ledger + `projectModelView` 返回脱敏视图；未 opt-in 时明确 `OPERATOR_AUTHORIZATION_REQUIRED` 错误结果。
3. **core 最小增量**：`assertOperatorAuthorization` 从私有改为导出（G4 权限门的唯一实现被插件壳复用，不复制第二份校验）。
4. **root façade 零漂移**：插件壳只在 `/advanced`；root 白名单机器检查与 exports.test 同步扩充（`createOrdariumPlugin` 入 advanced 集、入 root 禁止清单）。

## 审计缺漏修复清单（本 Goal 一并处理）

| 缺漏 | 修复 |
|---|---|
| host-mcp inspect 声明未分发 | 见上 §2；G9-A07 测试 |
| docs/14 §5 Palimpsest 方向未随 2026-08-17 决议修订 | 改为"DSH 插件形态复兴、进程内消费；versioned adapter 降为次选" |
| G8 spec §4 同上 | 加方向修订注记 |
| docs/12 §5 / docs/13 §10 未反映插件壳 | 插件壳入表面表；ops 注册点改指壳 |
| recoveryMaterial 绑定无端到端消费方 | 壳持有绑定 + G4 reconcileOnly 来源 1 语义闭合 |

## 证明测试

`packages/dsh/test/plugin.test.ts`（8 项，G9-A01–A06 + 回归）：共享实例去重、ops 默认缺席、四工具 + model 视图白名单恰等、构造期伪造 scope 拒绝 + 读权限不能 reconcile、reconcile 材料匹配落 reconciled/错配 `OPERATION_CONFLICT`、absent+retrySafe execute spy 零增长、dispose→closed→`RUNTIME_CLOSED`、operator 路径 uncertain 可见。`packages/host-mcp/test/mcp.test.ts`（+1，G9-A07）：未 opt-in 不在 tools/list；opt-in 后分发返回脱敏视图。

## 快照变化

`api/dsh/plugin.d.ts`（新）、`api/dsh/advanced.d.ts`（再导出）、`api/core/operations.d.ts`（导出校验函数）；`contracts.json` 无 union/错误码变化。

## 环境约束（承袭）

真实 DSH 插件 manifest 接线仍待 DSH 发布包可消费（G5/G7 同一遗留项）；结构合同已就绪，届时接 manifest 即可。
