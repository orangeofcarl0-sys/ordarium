# G18 Exit Report:versioned Host Adapter 叶包 `@ordarium/host-kit`

> 依据:`evidence/G18/design-spec.md`(2026-08-29 冻结并即席实施,G8 第 4 项激活);
> 完成日期:2026-08-29;环境:win32 x64,Node v24.14.1;性质:B 类加法合同 + 新包 +
> 架构门叶包规则扩一档;零 schema 变更、零既有行为变更。

## 1. 验收矩阵

| ID | 验收项 | 证据 | 结果 |
|---|---|---|---|
| G18-A01 | 版本协商:`assertHostContract(HOST_CONTRACT_VERSION)` 通过;不匹配抛 `HOST_CONTRACT_MISMATCH`(消息含 expected/actual 与 docs/18 指引);exact-match 无容忍窗 | core `test/host-port.test.ts`(当前版本过、+1/-1 均抛、code 断言);错误码自动入 contracts.json 冻结面 | PASS |
| G18-A02 | kit curated 面:exports 恰等 spec §1 六值(surface test 逐键断言,多/少导出即红);`assertHostContract` 同一性(core 导出 === kit 导出,无第二常量) | host-kit `test/surface.test.ts` | PASS |
| G18-A03 | 可移植 conformance:四场景(replay 收敛 / 兄弟分离 / 授权门 AUTHORIZATION_REQUIRED→allow / lineage 过缝)全过;violation 消息可定位场景 | testing `test/host-conformance.test.ts`(正例 ×2 + 打乱 callId 坏适配器被 replay 场景抓出的负例) | PASS |
| G18-A04 | 真适配集成:host-mcp 以 devDep 引 `@ordarium/testing`,真实适配 runtime + durable scratch 账本跑 runner 全过 | host-mcp `test/host-conformance.test.ts` | PASS |
| G18-A05 | 治理:包图无环、core 零宿主导入;快照漂移仅限 delta 影响面(host-kit 新包 + core/testing 声明面 + contracts.json 声明增量;`sqlite-v3.json` 字节不动);root façade 19 curated 零漂移;bump 纪律成文 docs/13 §8 + docs/18;dev/04 错误码表、dev/08 接入章、docs/17 §16.10 登记 | `pnpm verify:architecture` 全绿 + `git status snapshots/` 恰等清单 | PASS |

## 2. 结论

- 宿主合同版本化落地:core 持有唯一真源 `HOST_CONTRACT_VERSION`(现值 1),`assertHostContract` exact-match fail-closed——宿主升级 = 按 docs/18 核对单 bump pins,内核不提供多版本并存的 adapter 面(容忍层即兼容层,家规禁止)。
- 可移植宿主 conformance 成套:`runHostAdapterConformance` 与 `runOperationLedgerConformance`/`runStateLedgerConformance` 同款纪律(框架不可知、violation 抛可定位错误),`@ordarium/host-kit` 一站式出口——首宿主案例(Palimpsest)的全部对侧前提就绪,PLMP-ALN-1 诉求②转为"待消费者接入"。
- 实施中被负例测试抓出一处自伤:runner 全部 violation 调用点初版漏写 `throw`(正例空转通过、负例红)——修正后 10 处全覆盖。这是负例测试存在的理由,记录在案。
- 压测口径:全仓 33 文件 / 179 用例(较 1.1.0 发布基线 +3 文件 / +8 用例);host-kit surface/re-export、host-mcp 集成、core 版本协商均绿。

## 3. 最终命令与输出

```text
$ pnpm check
 Test Files  33 passed (33)
      Tests  179 passed (179)

$ pnpm snapshots:update   （Delta Sheet 之后执行)
→ 漂移恰等 delta 影响面:snapshots/api/host-kit/*(新)、api/core/host.d.ts、
  api/testing/{index,hostConformance}.d.ts、contracts.json(图+1/错误码+1);
  sqlite-v3.json 字节不动
$ pnpm verify:architecture
verify:architecture passed
  - dsh root façade: 19 curated exports verified
  - compatibility register: 6 entries verified
$ pnpm verify:docs
verify:docs passed (28 documents checked)

$ pnpm test:package   （六包 tarball 消费门,离线探针版）
package-consumer passed
  - @ordarium/{core,ledger-sqlite,dsh,testing,host-mcp,host-kit}: 6 tarball
    一次安装 + ESM smoke(含 host-kit 握手/runner/harness 同一性断言)
    + tsc 声明面探针(含 host-kit 编译)

$ pnpm verify:matrix   （Docker 29.7.2,真门 pipefail;新包干净环境认证）
=== matrix leg: node:24.15.0-slim ===
Test Files  33 passed (33) / Tests 179 passed (179) / verify:architecture passed
=== matrix leg: node:24-bookworm (v24.20.0) ===
Test Files  33 passed (33) / Tests 179 passed (179) / verify:architecture passed
MATRIX_LEG_OK × 2,runner 退出码 0
```

## 4. 未完成项

- 首宿主案例:Palimpsest 按其升级协议接入 `@ordarium/host-kit` 并跑 runner,由其账面登记(预期 PLMP-ALN-1 r4);本 Goal 的 A02/A03/A04 是其对侧可消费的全部前提。
- 下一次发布面:**已就绪(同日收口)**——`tools/package-consumer.mjs` 扩至六包并在本地实测通过(smoke 断言 host-kit 握手/runner/harness 同一性;types probe 编译 host-kit 声明面);探针步骤改为离线自洽(编译器与 `@types/node` 取自仓内 pinned devDeps + `typeRoots` 指向,不再网络安装)——修复其对 registry 的网络依赖,使该门符合 docs/17 §18"发布验证必须在无外部网络环境可重复"的冻结要求(当日 registry 拉取 typescript 平台包连续 ETIMEDOUT 暴露此违约)。Docker 矩阵双腿复跑全绿(§3),新包干净环境认证完成。release notes 按 docs/18 §1 五类清单披露(④新错误码 `HOST_CONTRACT_MISMATCH` + 新包面,①②③⑤无)。
- git push(发布后文档线 + 本 Goal)与下一次版本锚定 tag 由用户执行。
