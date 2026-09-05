# Palimpsest ALN-4② 正式确认:versioned Host Adapter 现状核实与首宿主 conformance 协议(2026-09-06)

> **确认回执 + 对接协议,不是新合同**——与 docs/12–18 冲突时以 12–18 为准。本文是对 Palimpsest 仓 `docs/engineering/07-ordarium-alignment.md` §6 诉求②("versioned Host Adapter 交付时,Palimpsest 作为首宿主 conformance 案例")的正式确认。随本文同步落盘的修订:`evidence/compatibility-register.md` `COMPAT-PAL-001` 关闭为**已执行(G18)**;docs/18 修订流水记 RCP-2。核实基线:commit `ac529d0`(G18 已交付,六包 manifest 1.1.0,工作树干净)。

## 1. 事实核实(逐条带文件行号证据)

### 1a. `COMPAT-PAL-001` 条目现状

`evidence/compatibility-register.md:12` 原文(修订前):

| 列 | 值 |
|---|---|
| ID | `COMPAT-PAL-001` |
| 边界 | `HostInvocationPort` |
| 兼容来源 | 未来 Palimpsest 接入形状未知 |
| canonical target | 仅保留 versioned Host Adapter 缝,不预设字段 |
| owner | G8 执行者 |
| 移除条件或决定 | 不提前增加 Palimpsest 字段或 shim;真实需求出现时重审 |

该表由 `tools/verify-architecture.mjs:425-460` 机器校验(ID 唯一、六列非空)。**核实结论:登记表此前未随 G18 交付滚动更新,决定列仍停留在"待重审"状态——本次确认随 RCP-2 将其关闭为"已执行(G18,2026-08-29)",缝位纪律(不预设 Palimpsest 字段/shim)延续。**

### 1b. docs/17 Goal 线:Host Adapter 不是"仅有缝位无 spec"——已冻结**且已交付**

- 缝位来源:docs/17 §3 不变量 7(第 100 行)"Palimpsest 只通过未来 Host Adapter 接入,不进入首发依赖图或 Goal";§3 结构图第 87 行 `PAL -.->|"versioned Host Adapter only"| PORT`;§16 G8 第 4 项(第 737 行)"Palimpsest Runtime 稳定重构后,才实现 versioned Host Adapter"。
- **G18 已激活并完成**:docs/17 §16.10(第 800–802 行)登记——触发前置("Palimpsest Runtime 稳定重构后")经 2026-08-29 同日审计确认满足(姊妹仓 H1 交付、治理上链、32 文件/173 测试全绿),会话决议冻结 spec 并即席实施。
- 冻结 spec:`evidence/G18/design-spec.md`(依据链见其第 3–5 行,含四项已否决方案:core 最小握手、仅 testing 侧、自动派生指纹、SDK semver 作版本源);验收矩阵 G18-A01–A05 见 spec §3(第 22–30 行);退场报告 `evidence/G18/exit-report.md` 五项**全部 PASS**(第 9–15 行)。
- 交付物(spec §1)已全部落地并机器验证:core `host.ts` 三件套(`packages/core/src/host.ts:18` `HOST_CONTRACT_VERSION = 1`;`:29` `assertHostContract`;`:20` `HostContractMismatchError`)、testing 可移植 runner(`packages/testing/src/hostConformance.ts:68`)、新叶包 `@ordarium/host-kit`(curated 出口恰等,`packages/host-kit/src/index.ts:11-29`)。实现提交 `cd078a8`(2026-08-29),位于 1.1.0 发布基线之后;下次发布面已就绪(exit report §4:release notes 按 docs/18 §1 披露④新错误码 `HOST_CONTRACT_MISMATCH` + 新包面,①②③⑤无),tag/push 待用户执行。

### 1c. 宿主合同面现状:消费形态与版本协商语义

- **宿主形态**(docs/12 §9 第 187 行):"Palimpsest 将来只可能成为一个**显式调用 Action 的宿主**,不会反向改变 Ordarium 核心合同。"docs/13 §8(第 269 行):其他宿主只要能提供稳定 `source/scope/callId`、AbortSignal、分类后的 authorization evidence 和 ToolDefinition 映射,就可以复用 core。端口合同本身是宿主中立四元组:`HostInvocation = { identity, authorization?, providerPrincipalRef?, signal? }` + `port.invoke(action, input, invocation)`(`packages/core/src/host.ts:42-60`)。
- **版本协商协商什么**(docs/13 §8 第 271 行;G18 spec §1 第 9 行;core `host.ts:10-18` 注释):协商对象是**一个整数合同代数 `HOST_CONTRACT_VERSION`**,覆盖整个宿主可见合同面——`HostInvocationPort` 形状与语义、宿主可见错误族承诺、宿主侧构造面默认值(如 `SqliteLedger.openRetry`)。**它不是** Effect profile 集(那属于 Action 合同,由 contract fingerprint 机器守卫,docs/17 §7.1)、**不是** decorator 面、**不是**逐特性能力位。
- **协商方式是 exact-match 断言,不是区间谈判**:宿主装配期调 `assertHostContract(自己构建所依据的版本)`;不匹配抛 `HOST_CONTRACT_MISMATCH`(消息含 expected/actual 与 docs/18 对齐指引)fail-closed——不设多版本容忍,"容忍层即兼容层"(G18 spec §1;core `host.ts:29-33`)。bump 纪律:仅宿主可见合同语义变化时 +1,每次 bump 在 docs/13 §8 与 docs/18 记录修订(当前值 1,自 G18 起未 bump)。

## 2. G18 验收矩阵(已 PASS)与 Palimpsest 侧需实现的可测行为

G18 自身验收已闭环(exit report §1:A01 版本协商、A02 kit curated 面恰等、A03 可移植 conformance 四场景、A04 host-mcp 真适配集成、A05 治理门)。**对 Palimpsest 而言,A02/A03/A04 是其对侧可消费的全部前提**——诉求②自 G18 交付起转为"待消费者接入"(docs/17 §16.10;exit report §4)。

首宿主 conformance 案例(即"Palimpsest 跑 runner",G18 spec §5)需要 Palimpsest 侧实现以下可测行为:

| # | 可测行为 | 通过判据 |
|---|---|---|
| P1 | **装配期版本握手**:`installPalimpsest` 构造路径调用 `assertHostContract(HOST_CONTRACT_VERSION)`(自 `@ordarium/host-kit` 导入) | 当前版本通过;对 `HostContractMismatchError` 的处置是装配 fail-closed(停止构造、不捕获吞掉);测试可断言模拟 mismatch 抛出且 code=`HOST_CONTRACT_MISMATCH` |
| P2 | **port 映射真身**:Palimpsest 生产调用点 → `HostInvocationPort.invoke` 的映射显式成面(其 callId/rootCallId/lineage/actor/授权证据映射进 `HostInvocation`) | runner 第一参数传入**该映射后的 port**(非裸 runtime——对裸 runtime 跑只复证 core 自身,不构成 Palimpsest 案例) |
| P3 | **四场景全过**:`runHostAdapterConformance(port, ledger)` 对 scratch 账本运行 | ①同 callId 重放收敛单 operation、单次执行;②同 rootCallId 兄弟调用不折叠;③无授权 → `AUTHORIZATION_REQUIRED`、携带 allow → 单次执行;④lineage/actor 过缝入账不影响 identity 折叠(需传可 `list()` 的 ledger 视图) |
| P4 | **scratch 账本纪律**:runner 探针 action 真实写记录(`hostConformance.ts:17-18` 头注明令) | 案例只跑在临时账本上,绝不指向生产库 |
| P5 | **(可选加深)** `HostAdapterHarness`(kit 同样再导出)覆盖 signal/providerPrincipalRef 等可选面 | 超出 runner 四场景的深度由 Palimpsest 自选,不设门槛 |
| P6 | **登记**:跑通后按 PLMP-ALN-1 升级协议登记(预期 r4) | 姊妹仓账面记录;此后每次 `@ordarium/*` bump 按 docs/18 §2 七项核对(尤其第 7 项触达面复检) |

最低验收地板 = P1 + P3(对组装后的 runtime);完整案例主张 = P1–P3 经 P2 的真映射。二者均满足"首宿主 conformance 案例"登记资格,差异只在主张强度——建议按完整主张登记。

## 3. 对 Palimpsest 侧 conformance 基座的评估

| 申报基座 | 评估 |
|---|---|
| 35 测试文件 / 202 项测试(pnpm check,含 parity fixture v2 硬门) | **充分作为回归底座**,但性质是 Palimpsest 自身行为回归,不自动覆盖端口合同映射——runner 四场景是独立的、更窄的面 |
| `installPalimpsest` 导出面 + `tools/dsh_types.ts` 结构性宿主合同镜像 | **镜像策略与本案无冲突且互不阻塞**:G18 握手面(`HOST_CONTRACT_VERSION`/`assertHostContract`/`HostContractMismatchError`/runner)**不在被镜像的 DSH façade 内**,它来自 `@ordarium/host-kit` 新依赖线;镜像→真实 DSH manifest 的零改动切换路径照旧,conformance 案例可先于镜像切换落地 |
| 五种 effect profile 全覆盖 action 映射 + claim/report 协议 + FaultInjector/ManualClock | **超出端口合同最低门槛的业务层深度,保留自持**;G18 runner 仅用 guarded 探针,不要求 profile 全覆盖 |

**缺口清单(建议补齐后再登记)**:

1. **握手调用点**:`installPalimpsest` 装配路径中据其消费点描述尚无 `assertHostContract` 调用(如已规划请以实际为准)——落点应为构造期 fail-closed(P1)。
2. **port 映射真身未显式成面**:若当前消费经 DSH 镜像形状(工具调用 → action)而未显式暴露为 `HostInvocationPort`,需把该映射显式化为可注入对象(P2)——这是"案例证明的是 Palimpsest 而非 core"的关键。
3. **依赖线**:`@ordarium/host-kit` 需进入 Palimpsest 依赖清单(v1.1.0 已发布,可消费;kit 出口经 surface test 锁定恰等,不存在隐性面)。
4. **scratch 账本接线**:测试需能构造临时账本并传入 runner 第二参数(第三场景的记录断言需要可 `list()` 的视图)(P3/P4)。
5. **登记槽位**:PLMP-ALN-1 r4 + docs/18 §2 第 7 项触达面四元组(现状/唤醒条件/预定消费点/姿态)(P6)。

## 4. 纪律边界与 conformance harness 落点

**宿主中立纪律核实**:G18 交付物零 Palimpsest 概念——`host-kit/src/index.ts:7-8` 头注明写 "No Palimpsest-shaped or host-specific fields live here (COMPAT-PAL-001 discipline)";`HostInvocation` 四元组无任何宿主特有类型(core `host.ts:42-47`);架构门维持 core 零宿主导入(exit report A05)。内核不理解编排语义的禁令不受本案影响——Palimpsest 在本案中**至多以首宿主案例身份被引用**(docs/18 §4 先例),不进入内核合同面。

**conformance harness 落点建议:场景权威在本仓 `@ordarium/testing`,案例执行在 Palimpsest 侧自持测试。**

- **场景(what to assert)留在 kernel 侧**:runner 与 `runOperationLedgerConformance`/`runStateLedgerConformance` 同款纪律——框架不可知、violation 抛可定位错误,是端口合同的**单一事实源**(docs/17 §5.2);随 `HOST_CONTRACT_VERSION` bump 同步演进,保证案例判据永不过期。Palimpsest 侧自写一套场景会产生第二事实源,violation 时无法区分"映射错"还是"场景漂移"。
- **执行(who drives it)留在 Palimpsest 侧**:runner 框架不可知正是为此设计——Palimpsest 的 vitest 直接驱动;其镜像类型、`installPalimpsest`、claim/report 协议、FaultInjector/ManualClock 是 Palimpsest 自有合同,内核不可见也不可见(宿主中立禁止边),只能由 Palimpsest 自持测试守卫。
- **结论**:G18 spec §5 与 exit report §4"未完成项"的表述即为权威分工——"首宿主案例(Palimpsest 跑 runner)由姊妹仓按其升级协议落地并登记"。

## 5. 对接清单(回执要点)

1. **诉求②正式确认:成立且已超预期交付**——versioned Host Adapter(G18)已于 2026-08-29 冻结 spec 并即席实施完成,验收 G18-A01–A05 全 PASS;Palimpsest 无需等待任何 Ordarium 侧前置。
2. Palimpsest 侧按 §2 P1–P6 落地(缺口清单见 §3),跑通后按 PLMP-ALN-1 升级协议登记 r4。
3. 版本锚定:G18 在 manifest 1.1.0 线、1.1.0 tag 基线之后;下次 `@ordarium/*` 发布的 release notes 将按 docs/18 §1 披露④新错误码 `HOST_CONTRACT_MISMATCH` + host-kit 新包面(①②③⑤无)——Palimpsest bump 时按 §2 核对单执行。
4. 本仓随本确认的修订:`evidence/compatibility-register.md` `COMPAT-PAL-001` → 已执行(G18);docs/18 修订流水 RCP-2。
