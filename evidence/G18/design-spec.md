# G18 Design Spec:versioned Host Adapter 叶包 @ordarium/host-kit(冻结·即席实施)

> 依据:docs/17 §16(G8 第 4 项"Palimpsest Runtime 稳定重构后,才实现 versioned Host Adapter"——前置 2026-08-29 审计确认满足:姊妹仓 H1 交付、治理上链、32 文件/173 测试全绿)、`evidence/compatibility-register.md` `COMPAT-PAL-001`(owner=G8 执行者,移除条件"真实需求出现时重审"已到来)、docs/18 §4(首宿主 conformance 案例候选=Palimpsest)、PLMP-ALN-1 演进清单 #4(诉求②"待 Ordarium 交付")。
> 2026-08-29 会话决议:**新叶包 @ordarium/host-kit** + **手写 `HOST_CONTRACT_VERSION` 常量** + 本 Goal 内冻结并实施。
> 已否决项:core 最小握手(把叶包推迟到第二个外部宿主——本项交付的正是首宿主接入面,且叶包形态是 G8 扩展经济性的验收载体);仅 testing 侧(版本化不进运行时缝,宿主运行时不设防);自动派生指纹(TS 类型无运行时形状,对语义漂移不设防);SDK semver 作版本源(非宿主面原因的 bump 产生假漂移信号)。

## 1. 合同骨架

- **core(`host.ts`,唯一内核增量)**:`HOST_CONTRACT_VERSION = 1`(整数常量);`assertHostContract(version: number): void`——不匹配抛 `HostContractMismatchError`(code `HOST_CONTRACT_MISMATCH`,消息含 expected/actual 与对齐指引)。**exact-match,fail-closed**:不设"旧版本容忍"路径——容忍层就是兼容层。bump 纪律:仅当宿主可见合同语义变化(HostInvocation 形状、port 语义、宿主可见错误族承诺、宿主侧构造面默认值如 `openRetry`)时 +1,修订记录 docs/13 + docs/18;新错误码经 `super("HOST_CONTRACT_MISMATCH",…)` 自动进 contracts.json 冻结面。
- **@ordarium/testing(第二增量)**:`runHostAdapterConformance(port: HostInvocationPort): Promise<void>`——从 `host-harness.test.ts` 场景移植的可移植宿主 conformance:①同 callId 重放收敛单 operation;②同 rootCallId 兄弟调用不折叠;③lineage/actor 过缝入账不影响 identity;④guarded 探针无授权 → `AUTHORIZATION_REQUIRED` 浮出、携带 allow → 通过。violation 抛 `Error("host adapter conformance violation: …")`(`runStateLedgerConformance` 同款:框架不可知,任意 runner 可驱动)。runner 自带探针 action 与 allow 证据,宿主对**临时账本**上的 port 运行。
- **@ordarium/host-kit(新叶包,首宿主接入面)**:curated re-exports 恰等——自 core:`HOST_CONTRACT_VERSION`、`assertHostContract`、`HostContractMismatchError`、`OrdariumError`、类型 `Action`/`HostInvocation`/`HostInvocationPort`/`InvocationIdentity`/`AuthorizationDecision`/`ProviderPrincipalRef`;自 testing:`HostAdapterHarness`、`runHostAdapterConformance` 及两者 options 类型。**此外无物**——root façade 零漂移(dsh 19 curated 不动);宿主仍可直接 import @ordarium/core,kit 是入口不是墙。workspace deps:`@ordarium/core` + `@ordarium/testing`;engines 同 core(>=24.0.0)。
- **架构门**:host-kit 入 `leafPackageRules`(叶包可依赖内核与 conformance kit `@ordarium/testing`;内核永不容依赖叶包——规则注释随此扩写)。预期漂移:contracts.json(包图/importScan/错误码 +1)、`snapshots/api/host-kit/*`(新)、`snapshots/api/core|testing` 声明面——**Delta Sheet 先行**,G18-005 统一 `--update`。

## 2. 边界规则

1. kit 不承载任何 Palimpsest 概念(COMPAT-PAL-001 纪律:不预设字段/shim);首宿主案例由姊妹仓在其账面登记,本 Goal 只交付面与协议。
2. 版本断言 exact-match:升级 = 消费者按 docs/18 核对单 bump pins;内核不提供多版本并存的 adapter 面。
3. `HOST_CONTRACT_VERSION` 真源在 core(`host.ts`),kit 只 re-export——不存在第二常量。
4. 叶包规则扩容仅此一家:`@ordarium/testing` 是 conformance kit 而非宿主协议面;禁止未来叶包借道引入更多内核侧依赖(规则注释写死)。
5. 快照/图漂移全部经 Delta Sheet;root façade 19 curated 零漂移;contracts.json 除声明增量外语义不动。

## 3. 验收矩阵

| ID | 场景 | 通过条件 |
|---|---|---|
| G18-A01 | 版本协商 | `assertHostContract(HOST_CONTRACT_VERSION)` 通过;不匹配抛 `HOST_CONTRACT_MISMATCH`(消息含 expected/actual 与指引);错误码进 contracts.json 冻结面 |
| G18-A02 | kit curated 面 | exports 恰等 §1 清单(surface test 逐键断言);多导出/少导出即红 |
| G18-A03 | 可移植 conformance | runner 四场景对直连 runtime 全过;violation 消息可定位到场景 |
| G18-A04 | 真适配集成 | host-mcp 以 devDep 引 `@ordarium/testing`(devDeps 不入叶包依赖门——既有 dsh devDep 先例),scratch 账本上跑 runner 全过 |
| G18-A05 | 治理 | 包图无环、core 零宿主导入;快照漂移仅限 §1 列面;root façade 零漂移;bump 纪律成文于 docs/13+docs/18;dev/04 错误码表、dev/07 接入章增补;docs/17 §16.10 登记 |

## 4. 实现切片

- G18-001:core——`host.ts` 常量/断言/错误类 + core 测试(A01);
- G18-002:testing——`src/hostConformance.ts` runner + 自测(A03);
- G18-003:host-kit 新包 + 根接线 + 架构门规则 + surface test(A02);
- G18-004:host-mcp devDep + 集成 runner 测试(A04);
- G18-005:docs(dev/04 错误码表、dev/07 接入章、docs/13+18 bump 纪律、docs/17 §16.10)+ Delta Sheet + `snapshots:update` + exit report + 全门绿 + 提交。

## 5. 承袭披露与非目标

- 首宿主案例(Palimpsest 跑 runner)由姊妹仓按其升级协议落地并登记(预期 r4)——本 Goal 的 A02/A03/A04 是其对侧可消费的全部前提;诉求②在 kit 交付后转为"待消费者接入"。
- 非目标:多版本并存容忍、adapter 自动生成/脚手架、host-kit 进 root façade、provider adapter helper 抽取(G8 第 2 项,另立)、叶包规则再扩容。
- 升级路径:第二外部宿主出现时,G8 第 1 项的叶包经济性按本包先例评估,不自动扩权。
