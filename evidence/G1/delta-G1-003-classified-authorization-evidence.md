# Delta G1-003：分类 authorization evidence 与 `AUTHORIZATION_CONFLICT`

- 变更分类（docs/17 §7.2）：C 破坏性合同变化（`AuthorizationDecision` 新增必填 `kind`，private 阶段 clean break）
- 影响面：public API（types/errors）/ 语义（授权一致性）/ 宿主映射（dsh 默认 evidence 分类）
- 依据：docs/13 §4、docs/17 GOALS-3 §9.2.2、G1-A02；evidence/G0/target-contract-decisions.md §3

## 目标结构与理由

1. `AuthorizationEvidenceKind = "host-admission" | "policy-decision" | "human-approval"` 进入 core 类型；`AuthorizationDecision.kind` 必填，运行时校验非法 kind（TypeScript 编译期 + runtime assert 双层）。
2. 新错误码 `AUTHORIZATION_CONFLICT`（`AuthorizationConflictError`）：同 operation 已有 durable decision 时，后续矛盾证据（allow↔deny）在进入状态机前被拒绝，首个持久决定保持不变。
3. 隐式 allow（`requiresAuthorization=false` 的 profile）由 core 分类为 `kind=host-admission, source=implicit:<guarantee>`。
4. dsh 默认 tool-body admission evidence 明确携带 `kind: "host-admission"`； Ordarium 不从 source 字符串猜测 kind，也不伪造 human-approval。
5. 矛盾检测点在 `#runInternal` 入口（`#assertAuthorizationConsistent`）：先验证 incoming evidence 合法性，再与持久化 decision 比对；terminal 状态（succeeded/denied）同样先报 conflict，符合 G1-A02"首个 durable decision 保持不变并返回 AUTHORIZATION_CONFLICT"。

## 旧调用/旧数据的转换位置

无 durable 数据迁移（v1 record 的 authorization 字段在私有阶段随合同重建；SQLite 基线 fixture 同步）。仓库内调用者一次性更新：runtime/dsh/testing 测试的 decision 字面量补 `kind`。

## 旧路径删除时点

本变更集内已完成：无 kind 的 AuthorizationDecision 不再可构造（类型层）或进入持久化（运行时 assert）。

## 证明旧路径不再产生状态的测试

`packages/core/test/authorization.test.ts`（6 项，映射 G1-A02）：

- durable allow 后矛盾 deny → `AUTHORIZATION_CONFLICT`，record 仍 succeeded/allow，execute 计数不变；
- durable deny 后矛盾 allow → `AUTHORIZATION_CONFLICT`（而非 ActionDenied），record 仍 denied；
- 一致 evidence 重入 → 正常去重，无 conflict；
- 非法 kind → 运行时拒绝，record 停在 proposed 且无 authorization 持久化；
- 受信 human-approval 证据原样持久化（不篡改 kind/source）；
- read-only 隐式 allow 持久化为 `host-admission`/`implicit:read-only`。

另：dsh adapter 测试断言默认 admission 记录 `kind=host-admission`（不伪称人工批准）。

## 需要同步更新的文档

docs/14 §1、docs/17 §2.1/§2.2、本 delta sheet。

## 快照变化

`snapshots/api/core/*`（types/errors/runtime 声明）、`snapshots/api/dsh/advanced.d.ts`、`snapshots/api/testing/index.d.ts`；`snapshots/contracts.json`（errorCodes 增加 `AUTHORIZATION_CONFLICT`）；`snapshots/sqlite-v1.json`（fixture authorization 增加 `kind` 字段）。
