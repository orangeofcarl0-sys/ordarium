# 07 · 运维面（Operations）

`uncertain` 必须可见、可安全处置——这就是运维面。它**默认不存在**，宿主必须显式注册并提供授权。

## 官方插件壳（推荐接入方式）

`createOrdariumPlugin`（`@ordarium/dsh/advanced`）是进程级 Ordarium 实例的所有者，也是运维面的受信注入点：

```ts
import { createOrdariumPlugin } from "@ordarium/dsh/advanced";

const plugin = createOrdariumPlugin({
  // databasePath / runtime / authorize / scopeId / recoveryMaterial 同前
  operations: {
    authorization: {               // 宿主命令构造后注入；伪造在构造期被拒
      operator: "op-1",
      source: "dsh:operator-command",
      grantedAt: new Date().toISOString(),
    },
  },
});

plugin.register(ctx, [myAction]);  // action 正常注册
// 可选的四个运维工具同时注册：
//   ordarium_inspect / ordarium_list / ordarium_history / ordarium_reconcile
await plugin.dispose();            // quiesce → unregister → drain → close
```

不提供 `operations` 时：四个工具不注册，`plugin.ops` 为 `undefined`——模型看不到任何运维面。

## 进程内 API（operator 审计视图）

`plugin.ops`（或 core 的 `createOperations({ runtime })`）给宿主命令用，返回**完整**审计视图（含 identity/lineage/授权证据/错误/uncertainty 原因）：

```ts
const view = await plugin.ops!.inspect(operationId, /* authz 已在构造期绑定 */);
const page = await plugin.ops!.list({ state: "uncertain" });
```

**模型看到的工具**则只有脱敏八字段视图（operationId、action/version、effectKind、state、attempts、updatedAt、安全 reasonCode）——没有 reason 原文、actor、lineage、结果全文。

## reconcile-only：唯一的安全处置

`ordarium_reconcile` 工具（和 `ops.reconcileOnly`）只调用 Provider **查询**，永不执行——即使查询返回"确认不存在且可安全重发"也保持 `uncertain`（重发只属于正常运行时）。调用方需提交恢复材料：原 action 名 + 原输入 + 原身份；任何一项与持久摘要不匹配 → `OPERATION_CONFLICT`，Provider 零调用。

会话找回（优先级更高）经 `recoveryMaterial` 绑定提供，但解析结果仍要过同一验证器。

## 可见什么

| 视图 | 字段 |
|---|---|
| 模型（工具输出） | 八字段脱敏白名单 |
| operator（`ops.*`/审计） | 完整视图 + `resultRef.digest`（结果全文不出投影） |
| ledger | 仅摘要与安全载荷（见 [02](02-core-concepts.md#secret-边界)） |
