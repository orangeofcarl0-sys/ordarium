# 17 · Goals & acceptance contract

> 文件名保留用于历史链接。G0–G18 与 ORD-BOOT 的阶段交付证据继续保留在 `evidence/`。本文现在只描述 **当前 main / release 必须持续成立的 acceptance contract**。

## 产品目标

Ordarium 应持续保持：

1. host-neutral；
2. embedded-first；
3. 外部 effect guarantee 显式化；
4. managed local write crash-durable；
5. uncertainty honest；
6. 足够小，可以作为高层 runtime 的 substrate；
7. guarantee 可以通过 portable conformance 证明。

## Safety invariants

```text
Action != Operation
Invocation != Operation
Operation != Attempt

Identity != Authorization
ActionAuthorization != OperatorAuthorization

SemanticHistory != LiveLease

StateRef != StateSemantics
Cursor != Authority

HostAdapter != Kernel

Uncertain != Failed
```

## Effect invariants

- 只有 `read-only` 声明无外部副作用；
- managed write 必须授权；
- guarded ambiguity 不 blind retry；
- idempotent redispatch 使用同一 operation key；
- finite idempotency deadline 不续期；
- reconcilable recovery 先 query；
- reconcile-only 永不 dispatch；
- unmanaged 永远是显式 weak mode。

## Ledger invariants

- managed capability 来自显式 `LedgerCapabilities`；
- capability 不足必须在 Provider dispatch 前拒绝；
- semantic CAS 是 mandatory port semantics；
- live lease renewal 不产生 semantic history；
- fencing 保护 takeover；
- durable storage failure 不 silent fallback 到 MemoryLedger；
- custom ledger 的等价 guarantee 必须有 conformance evidence。

## State invariants

- state write = revision CAS；
- refs 在 commit 前 existence-check；
- ref 不自动等于 invalidation / authority；
- value semantics 属于 Host；
- change-feed order 只表示 ledger observation order；
- change-feed limit 有上界；
- malformed/future cursor fail closed；
- cursor opaque。

## Host invariants

- core 不含 host-framework-specific type；
- `HostInvocationPort` 是稳定入口；
- Host 保持 admission / approval / credential / session / sandbox authority；
- Host contract exact-match mismatch fail closed；
- 新 Host 是 leaf package，不反向成为 kernel dependency。

## Data invariants

Ordarium 设计上不持久化：

```text
raw Action input
raw logical business key
credential / token / private key
unfiltered provider stack / response
```

Output / receipt / state value 是 caller-authored persisted data，因此 caller 必须自己保证脱敏。

## Compatibility invariants

`verify:architecture` 必须持续保护：

- package dependency graph；
- public API snapshot；
- frozen error/state/effect/checkpoint unions；
- SQLite schema baseline；
- compatibility register。

Intentional drift 必须与 Architecture Delta Sheet + snapshot update 同批出现。

## Required gates

普通 change：

```bash
pnpm check
pnpm verify:architecture
pnpm verify:docs
```

涉及 storage / host / release 时，按触达面增加：

```bash
pnpm test:integration
pnpm test:conformance
pnpm test:package
pnpm verify:matrix
pnpm verify:release
```

## 必须长期保留的 executable scenarios

- identical replay；
- conflicting replay；
- concurrent claim；
- lease expiry takeover；
- crash after claim；
- crash after dispatch；
- guarded uncertainty；
- idempotent same-key recovery；
- finite-window expiry；
- 全部 reconcile outcomes；
- reconcile-only zero-dispatch；
- Provider principal conflict；
- ledger capability refusal；
- runtime quiesce/dispose handoff；
- state CAS conflict；
- missing StateRef；
- change-feed resume；
- invalid/future cursor；
- SQLite forward migration；
- host contract mismatch；
- host adapter conformance。

## 当前 non-goals

Acceptance 不要求：

- distributed multi-host consensus；
- remote worker protocol；
- Agent scheduler；
- workflow semantics；
- secret management；
- standalone daemon；
- 移除既有 legacy 叶包（其弃用状态与迁移路径由 release notes 与兼容政策承载）。

## 变更等级（原 §7.2，现行有效）

任何触及 public API、record/ledger schema、identity/state/recovery/error 语义、宿主映射或 Provider capability 的变更，先归类再动手：

| 等级 | 例子 | 要求 |
|---|---|---|
| **A** 内部等价 | 私有函数拆分、文件内聚重构、性能优化 | 原行为测试绿 + dependency/API/schema diff 为零 |
| **B** 加法合同 | 新的只读 filter、可选能力位、新错误码、**弃用标记等元数据** | API snapshot + 默认行为 + 资源上限 + 文档；不得改变旧 operation 解释 |
| **C** 破坏性合同 | identity/state/record 字段、error code 改义、Action profile 改义 | 首发前 clean break；发布后 semver + migration/deprecation；更新全部 contract fixtures |
| **D** 边界变化 | core 引入宿主类型、新包取得 state authority、Provider SDK 进入 core | 默认拒绝；先修订产品架构，不得以 adapter 名义掩盖 |

等级决定 release 档位与 docs/18 §1 的披露类别；每份 Delta Sheet 首行必须写明等级。

## 证据要求（原 §18，现行有效）

每个交付批次退出时必须留下：

1. `goal-id` / 批次标识、目标 revision、完成日期；
2. 实际变更的 package / port / schema / API；
3. Architecture Delta Sheet（模板与目录约定见 [`../evidence/README.md`](../evidence/README.md)）；
4. public API diff、依赖图 diff、schema/migration diff；
5. 验收 ID → test / fixture / report 的映射；
6. 失败注入与负面测试（不只 happy path）；
7. Compatibility Register 变化（若有）；
8. `docs/12–19` 同步结果；
9. 未完成项及其归属；
10. 最终命令、环境与输出摘要。

**Definition of Done**：验收 ID 全部有自动化或可重复的人工证据；`pnpm check` 与相关 integration/conformance/package 门全绿；API/依赖/schema diff 只含批准变化；无新增跨包环或双权威；兼容登记无匿名项；状态已回写 `14`、架构变化已回写 `13/15/16`；错误路径与成功路径同等覆盖。

## 历史结构指针（2026-09-18 重写）

本文在 2026-09-18 重写前承载 G0–G18 Goal 注册表与各阶段追加节（§16.x）等开发过程叙事；重写后正文只保留当前 acceptance contract。旧的 section 引用按此对照：

| 旧引用 | 现在的家 |
|---|---|
| `§6` 兼容层政策（含 `COMPAT-*` 预见清单） | [`../evidence/compatibility-register.md`](../evidence/compatibility-register.md)（机器登记）+ [18](18-release-compat-policy.md) |
| `§7.1` 冻结物 / `§7.2` 变化等级 | 本页「变更等级」+ 「Compatibility invariants」 |
| `§11.3` 等 G 阶段交付物节 | `evidence/G<goal>/` |
| `§16.x`（G9/G11/G16/G18、ORD-BOOT-0/0.1 追加节） | `evidence/G<goal>/`、`evidence/ORD-BOOT-*/`、[19](19-release-history.md) |
| `§18` Evidence Bundle / DoD / 验证入口 | 本页「证据要求」+ [`../evidence/README.md`](../evidence/README.md) |
| `§16 第 6 项` DSH 适配器归属重审双条件 | [`../evidence/G8/design-spec.md`](../evidence/G8/design-spec.md) + `COMPAT-DSH-002` |

## 历史证据

`evidence/`：

- Goal specs；
- delta sheets；
- exit reports；
- release candidate evidence；
- matrix/stress reports；
- compatibility register。

`docs/research/`：

- dated assessment；
- landscape / comparative research；
- delivery reasoning archive。

这些历史材料继续保留，但不回到普通开发者主阅读路径。
