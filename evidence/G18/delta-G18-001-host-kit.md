# Delta G18-001：versioned Host Adapter 叶包 `@ordarium/host-kit`

- 变更分类(docs/17 §7.2):**B 加法合同**(新叶包 `@ordarium/host-kit` + core 版本协商三件套 + testing 可移植宿主 conformance runner)+ **工具面**(架构门叶包规则扩一档)
- 依据:`evidence/G18/design-spec.md`(2026-08-29 会话决议:新叶包形态 + 手写常量 + 冻结并即席实施;G8 第 4 项"Palimpsest Runtime 稳定重构后"前置经同日审计确认满足)

## 目标结构与理由

1. **core `host.ts`**:`HOST_CONTRACT_VERSION = 1` + `assertHostContract(version)` + `HostContractMismatchError`(code `HOST_CONTRACT_MISMATCH`)。exact-match fail-closed——不设"旧版本容忍"路径,容忍层即兼容层。bump 纪律:仅宿主可见合同语义变化(port 形状/语义、宿主可见错误族承诺、宿主侧构造面默认值)时 +1,修订记录 docs/13 §8 与 docs/18。错误码经 `super("HOST_CONTRACT_MISMATCH",…)` 自动进 contracts.json 冻结面。
2. **testing `src/hostConformance.ts`**:`runHostAdapterConformance(port, ledger?)`——四场景可移植宿主 conformance(replay 收敛 / 兄弟分离 / 授权门 / lineage 过缝记录断言);violation 抛 `Error("host adapter conformance violation: …")`(`runStateLedgerConformance` 同款框架不可知纪律);探针 action 与 allow 授权证据自带,执行计数经闭包观测,账本视图可选(无则跳过记录级断言)。
3. **新叶包 `@ordarium/host-kit`**:curated re-exports 恰等 spec §1 清单(版本对 + port/identity/授权类型 + `OrdariumError` + `HostAdapterHarness` + runner);deps `core + testing`,engines >=24.0.0;root façade 零漂移——kit 是第三方宿主的一等入口,不是隔离墙。
4. **架构门**:`leafPackageRules` 增 `@ordarium/host-kit`(workspaceDeps `core + testing`;注释写死:叶包可依赖内核/默认账本/conformance kit,内核永不容依赖叶包,testing 边仅此一家)。

## 影响面

- 声明面:`snapshots/api/host-kit/*`(新包,全部 .d.ts);core 声明面(host.ts 三导出);testing 声明面(runner);dsh/ledger-sqlite 声明面零漂移;root façade 19 curated 零变化。
- 冻结面:contracts.json——packages 图 +1(host-kit 叶包)、importScan +1 条目、errorCodes +1(`HOST_CONTRACT_MISMATCH`);operationStates/guaranteeLevels/runtimeCheckpoints 四 union 不动;`sqlite-v3.json` 零变化(零 schema 变更)。
- 依赖面:host-mcp devDependencies + `@ordarium/testing`(门只扫 src/ 与 dependencies,devDeps 沿 host-mcp 已有 `@ordarium/dsh` devDep 先例);pnpm-lock.yaml 随新包/devDep 重算。

## 旧调用/旧数据的转换位置

无数据转换、无 schema 变更。既有宿主(dsh/host-mcp)行为零变化:版本握手是 opt-in 断言,未调用即维持现状(这是新增保护面,不是旧行为 shim——不存在被替换的旧默认);新宿主接入按 docs/dev/08 必须握手。`@ordarium/testing` 既有导出零变化(runner 为追加导出)。

## 旧路径删除时点

无旧路径——纯加法,无开关、无双路径、无兼容桩。

## 证明测试

- 单测(core `test/host-port.test.ts`):当前版本通过;±1 mismatch → `HOST_CONTRACT_MISMATCH`(消息含 expected/actual 与对齐指引)。
- 单测(testing `test/host-conformance.test.ts`):全场景对 volatile runtime + 账本视图通过;无账本视图时跳过记录断言;打乱 callId 的坏适配器被 replay 场景抓出(violation 消息可定位场景)。
- 单测(host-kit `test/surface.test.ts`):exports 恰等六值(多/少导出即红);`assertHostContract` 同一性(core 导出 === kit 导出,无第二常量);runner 经 kit 冒烟。
- 集成(host-mcp `test/host-conformance.test.ts`):真实适配 runtime + durable scratch 账本全过(G18-A04)。
- 治理:`pnpm verify:architecture`(漂移仅限本 delta 影响面)、`pnpm verify:docs`、全仓 `pnpm check` 于 exit report 记录。
