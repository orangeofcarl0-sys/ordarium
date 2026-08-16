# G5 Exit Report：宿主产品集成（DSH 首宿主 + MCP 第二宿主）

> Goal revision：`ORDARIUM-GOALS-3`（docs/17 §13）；目标形状冻结于 `design-spec.md`
> 完成日期：2026-08-17　环境：Windows 10 (26200)、Node v24.14.1、TypeScript 7.0.2

## 1. 变更范围

| Delta | 内容 |
|---|---|
| G5-001 | `@ordarium/host-mcp` 叶包（MCP stdio 协议子集，零外部依赖）、verifier 叶包规则、dsh 硬化（结构化 ContentBlock / providerPrincipalRef / recoveryMaterial 绑定）、协议级真实客户端与双宿主共账 e2e |

## 2. 验收矩阵（docs/17 §13.3）

| ID | 证据 | 备注 |
|---|---|---|
| A01 one-install | `dsh/test/exports.test.ts`（root 恰六值导出；包名 self-import） | |
| A02 原生 pipeline | `dsh/test/adapter.test.ts` + `hardening.test.ts`（结构化 registry/上下文/signal/renderer 合同） | **真实 DSH 包 fixture 携至 G7**（环境不可消费，见 §5） |
| A03 三类 evidence | adapter.test（host-admission 默认）+ hardening.test（policy-decision/human-approval）+ mcp fixture（mcp:tool-body-admitted） | |
| A04 replay/restart | mcp.test 重投单 operation；adapter.test 稳定 callId 复用；lifecycle.test 替代 runtime 恢复 | |
| A05 parallel | G2-A12 + runtime in-flight 合并测试 | |
| A06 root/subagent | `testing/test/host-harness.test.ts` 兄弟不折叠 | |
| A07 ContentBlock | hardening.test：默认 text + 自定义 resource 块透传 | COMPAT-DSH-001 部分执行 |
| A08 HMR | lifecycle.test（quiesce→drain→handoff→closed→replacement）+ dsh dispose 字面序 | 真实 Cordis HMR 携至 G7（同 §5） |
| A09 ops tools | mcp.test：`tools/list` 无 `ordarium_inspect`（默认不注册；opt-in 需 OperatorAuthorization）+ G4-A10 | |
| A10 兼容性 | core 快照零 DSH/MCP 类型（verifier + mcp.test 符号扫描）；host 差异仅在叶包/adapter | |
| A11 root/advanced | verify:architecture root 白名单（19 curated）+ exports.test | |
| A12 MCP 第二宿主 | mcp.test：真实 stdio 子进程 initialize/list/call 往返、错误映射、重投去重 | 协议级客户端（SDK 不可得回退条款） |
| A13 双宿主共账 e2e | mcp.test：进程内 dsh + MCP 子进程共享 SQLite——业务键单记录 attempts=1、双 plain 记录 source 区分 | |
| A14 叶包隔离 | verifier `leafPackageRules`（依赖⊆core+sqlite；内核不得反向）；engines 24.15 | dsh 为 devDep-only（e2e 测试） |

## 3. 快照 / 依赖演进

新增 `api/host-mcp/index.d.ts`；`contracts.json` 增 host-mcp 条目（含 importScan：仅 core/ledger-sqlite + node 内建）；依赖图方向不变，叶间运行时依赖为零。

## 4. 开发中的修正

MCP fixture 失败动作的期望被诚实语义纠正（guarded 抛错 → `OPERATION_UNCERTAIN`，非 ACTION_FAILED）；Windows 子进程句柄异步释放 → stop 等待 close + 清理重试；`asDshTool` 从 `/advanced` 导入（root 不泄漏）。

## 5. 环境受限项（携至 G7，非静默跳过）

1. **真实 DSH 包**（官方 ToolDefinition/Cordis lifecycle/HMR fixture）：本环境无可安装的 DSH 发布物 → 以合同级 + 进程级 fixture 替代；G7 发布门前必须接入真实包补 A02/A08 终验（`COMPAT-DSH-001` 剩余部分）。
2. **官方 MCP SDK client**：协议级客户端已证明真实 stdio 往返；SDK 可得时替换 fixture 客户端，服务器合同不变。
3. Node 24.15 真机矩阵（同 G2 遗留）。

## 6. 最终命令与输出

```text
pnpm check                → tsc -b 全绿；23 test files, 115 tests passed
pnpm verify:architecture  → passed；root façade 19 curated；register 6 entries；host-mcp 叶包规则生效
```

G5 exit gate 达成（含披露项）：双宿主同 ledger 的中立性、身份/证据/生命周期映射与 ops 默认不暴露均有自动化证据；"多 agent harness 基石"的中立性宣称首次获得**真实第二宿主进程**背书。
