# Delta G1-001：HostInvocationPort 冻结与 IDENTITY_REQUIRED

- 变更分类（docs/17 §7.2）：B 加法合同（新增 core 导出与错误码；不改变既有 operation 语义）
- 影响面：public API（core 新增 `host.ts` 导出、`OrdariumRuntime.invoke`、`IdentityRequiredError`；testing 新增 `HostAdapterHarness`）/ 宿主映射（dsh 适配器改为消费 `HostInvocation` 类型）
- 依据：`delta-ARCH-001` 决定 1；docs/17 GOALS-3 §9.2.11、G1-A01/G1-A12

## 目标结构与理由

1. `@ordarium/core` 新增独立导出接口 `HostInvocation`（必填稳定 identity、可选分类 authorization、可选 signal）与 `HostInvocationPort`（`invoke(action, input, invocation)`）；`OrdariumRuntime implements HostInvocationPort`，`invoke` 即带宿主合同的 `run`。
2. managed 副作用（guarded/idempotent/reconcilable）直接调用 core 且无显式 identity 时，抛出稳定 `IDENTITY_REQUIRED`（新错误类 `IdentityRequiredError`），ledger 不创建 operation、Provider/execute 不被调用；随机 direct identity 仅保留给 `read-only` 与显式 `unmanaged`。
3. `@ordarium/testing` 新增 `HostAdapterHarness`：确定性模拟宿主，走端口全合同（callId 生成、rootCallId/actor/lineage 传播、authorization 注入），作为 G1 conformance 与 G5 真实适配器的测试基座。
4. dsh 适配器 `asDshTool` 的执行路径改用 `HostInvocation` 类型组装修改，证明“适配器消费端口、不拥有合同”。

## 旧调用/旧数据的转换位置

无 durable 数据。随机 direct identity 的旧逃生路径对 managed profile 直接删除（首发前 clean break，docs/17 §6.1）；`read-only/unmanaged` 行为不变。

## 旧路径删除时点

本变更集内已完成：`runtime.run` 不再为 managed profile 生成 `direct/process/randomUUID`。

## 证明旧路径不再产生状态的测试

- `packages/core/test/host-port.test.ts`：managed 无 identity → `IDENTITY_REQUIRED`、executions=0、ledger 为空；read-only/unmanaged 无 identity 仍可运行；端口进入 + replay 复用终态（executions=1）。
- `packages/testing/test/host-harness.test.ts`：同 callId replay 汇合为单 operation；同 rootCallId 的兄弟调用不折叠；lineage/actor 传播仅作审计。

## 需要同步更新的文档

docs/14 §1（实现快照）、docs/17 §2.1/§2.2（缺口清单与 G1 状态）、本 delta sheet。

## 快照变化

- `snapshots/api/core/`、`snapshots/api/testing/`、`snapshots/api/dsh/`、`snapshots/api/ledger-sqlite/`：快照布局从单文件 `api/<pkg>.d.ts` 改为**目录化全量声明快照** `api/<pkg>/**/*.d.ts`——`export *` 使 `index.d.ts` 只含转出口，单文件快照无法捕获 `host.ts` 等新增模块的真实表面（工具缺口在本切片中被发现并修复）；
- `snapshots/contracts.json`：errorCodes 增加 `IDENTITY_REQUIRED`。
