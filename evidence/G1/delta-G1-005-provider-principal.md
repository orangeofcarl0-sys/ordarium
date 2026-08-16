# Delta G1-005：ProviderPrincipalRef 与持久 digest 冲突

- 变更分类（docs/17 §7.2）：B 加法合同（新可选字段/错误码）+ 语义收紧（principal 连续性 fail closed）
- 影响面：public API（types/action/host 声明、新错误码）/ 语义（operation 绑定）/ testing harness
- 依据：docs/13 §2、docs/17 GOALS-3 §9.2.8、G1-A11；evidence/G0/target-contract-decisions.md §4

## 目标结构与理由

1. `ProviderPrincipalRef { namespace, subject }` 为瞬态内存对象：经 `ActionRunOptions`/`HostInvocation` 可选传入，run() 入口即校验（非空、≤256 字符），原始值与 credential 永不进入 record。
2. record v1 增加可选 `providerPrincipalDigest`（canonical SHA-256，64-hex）：首次出现时通过 CAS 绑定（创建时随 create 落库，或对未绑定记录在重入时采纳）；绑定后成为同 operation 的连续性冲突字段。
3. 新错误码 `PRINCIPAL_CONFLICT`（`PrincipalConflictError`）：绑定记录重入时 digest 不一致**或 ref 缺失**（无法证明连续性）都 fail closed，Provider 不被调用，持久 digest 不变。
4. digest 不替代 logical key（不参与 operationId 推导）；它的作用是把"作者忘写 account namespace 的业务 key"从静默换号执行变成显式失败。
5. `HostAdapterHarness` 增加 `providerPrincipalRef` 调用选项，宿主 conformance 可覆盖。

## 旧调用/旧数据的转换位置

无 durable 数据迁移（可选字段，旧记录无 digest 视为未绑定）。仓库内无既有 principal 调用者。

## 旧路径删除时点

不适用（纯新增路径）；绑定语义自本切片起即为唯一行为。

## 证明旧路径不再产生状态的测试

`packages/core/test/principal.test.ts`（5 项，映射 G1-A11）：

- 同 principal 重入复用 operation；record 只含 64-hex digest，JSON 全文不含 namespace/subject 原值；
- 换 principal → `PRINCIPAL_CONFLICT`，record 仍 succeeded 且 digest 不变，execute 计数不变（Provider 未再调用）；
- 绑定后缺失 ref → `PRINCIPAL_CONFLICT`（无法证明连续性）；
- 未绑定记录首次见到 ref 时采纳（CAS），之后换号冲突；
- malformed ref（空 namespace / 257 字符 subject）在 ledger 写入前拒绝（测试曾抓到"先落库后校验"缺陷并修复为入口校验）。

## 需要同步更新的文档

docs/14 §1、docs/15 §25（错误表新增 `PRINCIPAL_CONFLICT`）、docs/16 §9.2（错误图谱）、docs/17 §2.2 G1 状态、本 delta sheet。

## 快照变化

`snapshots/api/core/*`（types/action/host/errors/runtime）、`snapshots/api/testing/index.d.ts`；`contracts.json`（errorCodes 增加 `PRINCIPAL_CONFLICT`）；`sqlite-v1.json`（fixture 的 authorized 记录增加 `providerPrincipalDigest`）。
