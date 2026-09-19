# Ordarium Documentation

**第一次使用 Ordarium，不要从 Architecture 或 Gxx 历史开始。**

从一个真实问题开始：

> Provider 已经产生副作用，但进程在本地记录成功之前崩了。现在应该 retry、query，还是停止？

## Start here

| 页面 | 你会得到什么 |
|---|---|
| [5-minute Quickstart](start/quickstart.md) | 把一段普通 side-effect API call 包进 Ordarium |
| [Failure Lab](start/failure-lab.md) | 真的制造 crash-after-provider-commit，再观察恢复 |
| [Choose a profile](start/choose-a-profile.md) | 不背术语，根据 Provider 能力直接选 profile |

推荐顺序：

```text
Quickstart
→ Failure Lab
→ Choose a profile
→ 一个与你 Provider 匹配的 Tutorial
```

## Tutorials — build one complete integration

- [Provider supports an idempotency key](tutorials/provider-idempotency-key.md)
- [Provider supports authoritative reconciliation](tutorials/provider-reconciliation.md)
- [Provider has no recovery primitive](tutorials/no-recovery-primitive.md)
- [Build a Host Adapter](tutorials/host-adapter.md)

Tutorial 的目标是“跟着做完”，而不是列 API。

## How-to — solve one engineering task

- [Inspect and resolve an uncertain Operation](how-to/inspect-uncertain-operation.md)
- [Run multiple workers safely](how-to/run-multiple-workers.md)
- [Build a custom Ledger](how-to/build-custom-ledger.md)
- [Store and watch management state](how-to/store-and-watch-state.md)

How-to 假设你已经理解基础概念，只回答“怎么做”。

## Recipes — map Ordarium to real side effects

- [Payments](recipes/payments.md)
- [Email and messages](recipes/email-and-messages.md)
- [Issues and tickets](recipes/issues-and-tickets.md)
- [Cloud resources](recipes/cloud-resources.md)
- [AI agent tool actions](recipes/ai-tool-actions.md)

Recipe 不会假设某个具体 SaaS 一定具备幂等/查询能力；它会告诉你**如何根据你实际使用的 Provider 能力选择合同**。

## Concepts — understand the mental model

- [Operation identity](concepts/operation-identity.md)
- [Uncertain](concepts/uncertain.md)
- [Claim / Lease / Fencing](concepts/claim-lease-fencing.md)
- [Authorization evidence](concepts/authorization-evidence.md)
- [Provider capabilities](concepts/provider-capabilities.md)

概念页统一使用：

```text
The problem
→ 30-second answer
→ concrete example
→ failure behavior
→ common mistakes
→ reference links
```

## Developer reference

现有 `docs/dev/` 保留为 compact developer reference：

- [Developer guide index](dev/README.md)
- [Getting started](dev/01-getting-started.md)
- [Core concepts](dev/02-core-concepts.md)
- [Effect profiles](dev/03-effect-profiles.md)
- [Errors](dev/04-errors.md)
- [Authorization](dev/05-authorization.md)
- [Ledgers](dev/06-ledgers.md)
- [Operations](dev/07-operations.md)
- [Hosts](dev/08-hosts.md)
- [Testing](dev/09-testing.md)
- [Lifecycle & recovery](dev/10-lifecycle-and-recovery.md)
- [Management state](dev/11-state.md)

## Normative reference / maintainer docs

- [12 · Product baseline](12-ordarium-product-baseline.md)
- [13 · Action & runtime contract](13-ordarium-action-contract.md)
- [14 · Implementation map](14-ordarium-implementation-plan.md)
- [15 · Architecture](15-ordarium-complete-architecture.md)
- [16 · Architecture atlas](16-ordarium-mermaid-architecture-atlas.md)
- [17 · Acceptance contract](17-ordarium-goals-and-acceptance.md)
- [18 · Compatibility policy](18-release-compat-policy.md)
- [19 · Release history](19-release-history.md)

这部分是 reference，不是 onboarding。

## Research & evidence

历史材料继续保留：

```text
docs/research/**
evidence/**
```

它们负责 provenance / design history / delivery evidence，不再承担普通开发者教学。

## Coding-agent resources

- [`llms.txt`](llms.txt)：精简索引 + 核心合同
- [`llms-full.txt`](llms-full.txt)：面向 coding agent 的主文档合并文本，不包含 research/evidence 全量历史。它是**派生文件**：改完文档后用 `node tools/build-llms-full.mjs` 重新生成（`--check` 只校验是否过期、不写入）

## Machine verification

```text
pnpm check                build + test
pnpm test:integration     SQLite / host integration
pnpm test:conformance     conformance suites
pnpm test:package         packaged consumer probe
pnpm verify:architecture  API/schema/package invariants
pnpm verify:docs          links/fences/README claims
pnpm verify:release       aggregate release gate
pnpm verify:matrix        Node matrix
```
