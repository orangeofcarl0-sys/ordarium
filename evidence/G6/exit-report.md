# G6 Exit Report：Provider capability 与 conformance

> Goal revision：`ORDARIUM-GOALS-3`（docs/17 §14）；目标形状冻结于 `design-spec.md`
> 完成日期：2026-08-17　环境：Windows 10 (26200)、Node v24.14.1、TypeScript 7.0.2

## 1. 变更范围

| Delta | 内容 |
|---|---|
| G6-001 | `testing/provider.ts`：能力声明 + 指纹 + 交叉校验、确定性 ProviderFixture（七预设、三类可切换故障、fence/冲突/计数）、providerBackedAction 参考适配器、A01–A12 场景套件（双模式） |

## 2. 验收矩阵（docs/17 §14.3）

全部 12 个 ID 由 `packages/testing/test/provider-conformance.test.ts` 的 14 项测试覆盖（映射见 delta §2），关键断言均为"业务效果计数"而非仅状态：A03 效果=1、A04 过期后 execute 冻结、A06 假 absent 零额外 execute、A07 reconcile-only spy=0、A09 stale fence 拒绝且效果单一、A12 持久 deadline 字段跨重启不变。

## 3. 防冲突要求核对（docs/17 §14.4）

- 套件消费 canonical Action/Runtime 合同（真实 `OrdariumRuntime` + `HostAdapterHarness`），无第二 Provider 执行抽象 ✓；
- Provider 行为全部在 fixture/adapter 层，core 零改动 ✓；
- 无新增 capability record 字段（消费既有 `idempotencyExpiresAt`/`providerPrincipalDigest`）✓。

## 4. 快照 / 依赖演进

`api/testing/index.d.ts` 扩展；依赖图与错误码无变化。

## 5. 未完成项（归属 G7/G8）

- 参考 recipe（mail-like/issue-like 独立集成示例）：真实 Provider adapter 属发布后生态（G8 §2），首发以 fixture 套件为准；
- credential-gated 真实 Provider 的 sandbox 证据流程：G7 发布文档项。

## 6. 最终命令与输出

```text
pnpm check                → tsc -b 全绿；25 test files, 131 tests passed
pnpm verify:architecture  → passed；快照零未解释漂移
```

G6 exit gate 达成：`idempotent/reconcilable/cancellable/fencing` 从作者自声明变为可重复验证的能力证据，且不满足声明的配对在接线前被拒绝。
