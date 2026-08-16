# 05 · 授权

Ordarium 不实现审批策略——它**消费、分类、持久化**宿主的授权证据，并检测矛盾。

## 三类证据（kind）

| kind | 含义 | 不能宣称 |
|---|---|---|
| `host-admission` | 原生工具管道已准许进入工具体 | 人工点击或特定 policy 已通过 |
| `policy-decision` | 宿主明确命名的 guard/policy 给出决定 | 人工确认 |
| `human-approval` | 宿主审批系统给出可审计的人类决定 | Provider 已执行或结果已成功 |

managed profile（`guarded`/`idempotent`/`reconcilable`）在 dispatch 前必须有 `allow`；`read-only` 隐式允许（归类 `host-admission`，source 为 `implicit:<kind>`）。

## DSH 侧的默认与定制

默认：工具体穿过 DSH admission 管道后，Adapter 记录 `{ decision: "allow", kind: "host-admission", source: "dsh:tool-body-admitted" }`——**这不是人工批准**。

更强证据经 `authorize` 钩子映射（插件或 per-action binding 提供）：

```ts
import { asDshTool } from "@ordarium/dsh/advanced";

const tool = asDshTool(action, {
  runtime,
  authorize: async () => ({
    decision: "allow",
    kind: "policy-decision",
    source: "dsh:policy:payments",   // 宿主里真实存在的命名 policy
  }),
});
```

## 不可覆盖与矛盾

同一 operation 的**首个持久授权决定不可变**——授权不是撤销通道。后续矛盾证据（先 allow 后 deny，或反之）得到 `AUTHORIZATION_CONFLICT`，持久决定原样保持。已 dispatch 的 allow 只能通过取消与 Provider reconciliation 处理。

## OperatorAuthorization（另一条边界）

运维面（[07](07-operations.md)）使用**独立**的 `OperatorAuthorization`，不复用 Action 授权：

```ts
const authorization = {
  operator: "op-1",
  source: "dsh:operator-command",      // 受信宿主命令注入
  grantedAt: new Date().toISOString(),
  scope: "operations:reconcile",       // 读操作默认 "operations"
};
```

模型/普通工具输入**无法**自授予——伪造的 scope 在构造期就会被 `OPERATOR_AUTHORIZATION_REQUIRED` 拒绝。
