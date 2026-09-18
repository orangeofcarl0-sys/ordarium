# Ordarium 文档

Ordarium 文档分四层。**普通开发者不需要从 Goal/证据历史开始读。**

| 层 | 什么时候读 | 入口 |
|---|---|---|
| **Guide** | 正在接入、开发或运维 Ordarium | [`dev/`](dev/README.md) |
| **Reference** | 需要精确的当前合同 | [`12`](12-ordarium-product-baseline.md)–[`17`](17-ordarium-goals-and-acceptance.md) |
| **Release** | 升级或发布 | [`18`](18-release-compat-policy.md)、[`19`](19-release-history.md) |
| **Archive** | 需要设计史、研究或交付证据 | [`research/`](research/agent-landscape-2026-08/README.md)、[`../evidence/`](../evidence/README.md) |

当前线：

```text
package version           1.3.1 published / 1.3.2 workspace
HOST_CONTRACT_VERSION     1
SQLite user_version       4
```

## 按任务进入

### 我想先用起来

1. [01 · Getting started](dev/01-getting-started.md)
2. [02 · Core concepts](dev/02-core-concepts.md)
3. [03 · Effect profiles](dev/03-effect-profiles.md)
4. [04 · Errors](dev/04-errors.md)

### 我在写宿主适配

1. [08 · Hosts](dev/08-hosts.md)
2. [05 · Authorization](dev/05-authorization.md)
3. [09 · Testing](dev/09-testing.md)
4. [13 · Action contract](13-ordarium-action-contract.md)

### 我要构建 durable project/runtime state

1. [11 · Management state](dev/11-state.md)
2. [06 · Ledgers](dev/06-ledgers.md)
3. [15 · Architecture](15-ordarium-complete-architecture.md)

### 我要排查 crash / replay / uncertain

1. [10 · Lifecycle & recovery](dev/10-lifecycle-and-recovery.md)
2. [07 · Operations](dev/07-operations.md)
3. [03 · Effect profiles](dev/03-effect-profiles.md)

### 我在维护 Ordarium 本身

1. [12 · Product baseline](12-ordarium-product-baseline.md)
2. [13 · Action contract](13-ordarium-action-contract.md)
3. [14 · Implementation map](14-ordarium-implementation-plan.md)
4. [15 · Architecture](15-ordarium-complete-architecture.md)
5. [16 · Architecture atlas](16-ordarium-mermaid-architecture-atlas.md)
6. [17 · Acceptance contract](17-ordarium-goals-and-acceptance.md)
7. [18 · Compatibility policy](18-release-compat-policy.md)
8. [19 · Release history](19-release-history.md)

## 哪些是当前合同，哪些是历史

源码与机器 snapshot 是实现事实。`12–17` 描述当前产品/运行/架构合同，`18–19` 描述发布纪律与已发布事实。

历史 Goal、Delta Sheet、实验、设计推演与 exit report 保留在：

```text
evidence/**
docs/research/**
```

它们继续承担可追溯性，但不再是普通用户的主阅读路径。

## 机器验证

```text
pnpm check                build + test
pnpm test:integration     SQLite / host integration
pnpm test:conformance     portable conformance
pnpm test:package         package consumer probe
pnpm verify:architecture  package/API/schema/compatibility invariants
pnpm verify:docs          links/fences + README claim audit
pnpm verify:release       aggregate release gate
pnpm verify:matrix        Node runtime matrix
```
