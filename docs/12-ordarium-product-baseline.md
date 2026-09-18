# 12 · Product baseline

本文只回答三个问题：

1. Ordarium **是什么**；
2. Ordarium **拥有什么责任**；
3. 哪些责任明确属于 Host / Provider / 更高层 Runtime。

它是当前产品基线，不再承担 G0–G18 的开发过程叙事。历史设计与交付证据保留在 `evidence/` 和 `docs/research/`。

## 产品定义

Ordarium 是一个 host-neutral embedded SDK，由三层组成：

```text
Safe Action contract
+
Effect-authority runtime
+
Durable operation/state substrate
```

它的目标是让真实副作用的执行、重放、并发与恢复拥有可验证的 deterministic boundary，而不是把 Ordarium 扩张成 Agent Framework。

## 责任边界

### Ordarium owns

- versioned Action contract；
- effect profile semantics；
- Operation identity derivation；
- contract / input / logical-key digests；
- classified authorization persistence；
- claim / lease / fencing；
- durable Operation state/history；
- profile-aware recovery；
- `uncertain` 作为一等结果；
- operator inspect/reconcile-only；
- revisioned management state；
- StateRef existence checks；
- incremental state-change feed；
- HostInvocation contract；
- portable conformance tooling。

### Host owns

- Agent / Model Loop；
- tool selection；
- prompt/context assembly；
- approval UI / policy source；
- credential；
- sandbox；
- session；
- client surface；
- management state 的业务含义；
- higher-level workflow / coordination；
- 整体进程 lifecycle。

### Provider owns / proves

- stable idempotency key 是否真的有效；
- idempotency window 多长；
- 外部结果查询是否 authoritative；
- cancellation 的业务含义；
- 什么才算 Provider 侧 durable success / failure。

Ordarium 不猜这些保证。

## 核心不变量

```text
replayed / concurrent host delivery
→ stable Operation identity
→ durable evidence
→ deterministic effect decision
```

如果外部证据不足，deterministic decision 可以是：

```text
stay uncertain
```

这不是系统失败，而是对现实状态的正确表达。

## Package topology

```text
                    @ordarium/core
                    /      |      \
                   /       |       \
      ledger-sqlite     testing    host leaves
             |             |        /      \
             |             +---- host-kit  host-mcp
```

依赖原则：

```text
host leaves → kernel

kernel -/→ host leaves
```

## 当前公开事实

```text
package line              1.3.1 published / 1.3.2 workspace
HOST_CONTRACT_VERSION = 1
OperationRecord schema    2
StateRecord schema        1
SQLite user_version       4
distribution              GitHub tags / Releases
license                   MIT
```

日期化发布事实见 [19 · Release history](19-release-history.md)。

## 默认 managed deployment

```text
Host
→ HostInvocationPort / OrdariumRuntime
→ @ordarium/ledger-sqlite
→ Provider Action
```

普通部署不需要单独 daemon / network control plane。

## Safety posture

Ordarium 不宣称 arbitrary external effect 会自动变成 exactly-once。

它真正提供的是区分能力：

```text
safe to execute
safe to redispatch with same key
must query Provider
must remain uncertain
terminal success / failure / denial / cancellation
```

Effect profile 声明 Action + Provider 具有什么恢复能力。

## Data boundary

Operation record 默认保存 digest，而不是 raw input / raw business key。

Safe output / receipt 与 management state value 本来就是 caller-authored persisted data，所以它们必须由调用者保证不含 credential / secret。

## Non-goals

Ordarium 不是：

- multi-agent orchestrator；
- planner / scheduler；
- workflow DSL；
- model router；
- secret manager；
- approval product；
- sandbox；
- distributed consensus database；
- multi-host durable authority。

高层系统可以在 Ordarium 的 effect/state primitive 上构建这些语义。

