# Delta G5-001：host-mcp 第二宿主、dsh 硬化与叶包规则

- 变更分类（docs/17 §7.2）：B 加法合同（新叶包 + 绑定面）+ D 边界修订的既定执行（ARCH-001 叶包布局落地）
- 依据：`evidence/G5/design-spec.md` §1–§5；docs/17 §13、docs/12 §5

## 目标结构与理由

1. **`@ordarium/host-mcp` 叶包**：零外部依赖地实现 MCP stdio 协议子集（JSON-RPC 2.0：`initialize`（捕获 clientInfo.name 为 scope）/`notifications/initialized`/`ping`/`tools/list`/`tools/call`）。`tools/call` → `runtime.run`，identity `{source:"mcp", scope, callId}`；授权默认 `host-admission (mcp:tool-body-admitted)`，可用 `authorize` 供更强 kind；`OrdariumError` → `isError:true` 且只含稳定 code+安全 message（非 Ordarium 异常一律 `ACTION_FAILED` 兜底，无原文泄漏）；`stop()` → `runtime.dispose`（G3 生命周期）。ops 工具默认不注册；`operations.authorization` opt-in 才暴露 `ordarium_inspect`。运行时依赖仅 core+ledger-sqlite；`@ordarium/dsh` 仅为 devDependency（双宿主 e2e 测试用，运行时叶间依赖仍禁止）。
2. **verifier 叶包规则**：`leafPackageRules`——宿主叶包 workspace 依赖 ⊆ {core, ledger-sqlite}、外部依赖允许（host 协议面属叶包职责）；内核包依赖图不变且不得依赖叶包。根 tsconfig 增加 host-mcp project reference。
3. **dsh 硬化**：`DshContentBlock` 从私有 text-only union 改为结构化 `{type: string} & Record<string, unknown>`（COMPAT-DSH-001 部分执行：自定义 renderer 可返回宿主原生块）；`DshActionOptions.providerPrincipalRef` 绑定（瞬态，持久仅 digest）；`CreateDshOrdariumOptions.recoveryMaterial` 绑定（G4 reconcileOnly 的来源 1，暴露于返回对象）。
4. **协议级真实客户端 fixture**：测试以子进程运行服务器、按 MCP stdio 帧格式收发（非内存调用）——spec 中"SDK 不可得时回退"条款的诚实执行；后续可换官方 SDK client 而合同不变。

## 证明测试

`host-mcp/test/mcp.test.ts`（5）：initialize/list/call 往返（ops 默认缺席）、同业务键重投单 operation（identity source/scope 断言）、失败映射 isError 且无原文泄漏、**双宿主共账 e2e**（进程内 dsh adapter + MCP 子进程共享 SQLite：业务键汇合单记录 attempts=1、plain identity 双记录且 source 可区分）、core 导出面零 MCP 符号。`dsh/test/hardening.test.ts`（4）：policy/human evidence、principal 绑定 digest 化、非 text renderer 透传、recoveryMaterial 绑定。

## 快照变化

新增 `api/host-mcp/index.d.ts`；`contracts.json`（host-mcp 包条目 + engines 24.15）；`api/dsh/advanced.d.ts`（绑定与结构化块类型）。

## 环境受限披露

真实 DSH 包在本环境不可消费：A02/A08 的"官方 Cordis/HMR fixture"以适配器合同级 + 进程级生命周期 fixture 替代，**正式类型收敛与真实 HMR fixture 携至 G7 发布门**（COMPAT-DSH-001 部分执行已登记）。
