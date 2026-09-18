# Ordarium 文档索引与工程边界

Ordarium 的文档分三层：**开发者指南**（[`dev/`](dev/README.md)，面向使用者的可读投影）、**维护/审计合同**（[`12–19`](#维护与审计合同权威)，权威规范与发布事实）、**研究档案**（[`research/`](research/agent-landscape-2026-08/README.md)，分析全文，非合同）。冲突时以 12–19 为准。Palimpsest 线的规范在姊妹仓 [Palimpsest 00–11](https://github.com/orangeofcarl0-sys/palimpsest/tree/main/docs)，两线边界见根 [Palimpsest 仓库](https://github.com/orangeofcarl0-sys/palimpsest)。

**当前状态速览**：发布线 **1.3.1**、六包、SQLite schema **v4**、`HOST_CONTRACT_VERSION = 1`——权威台账见 [`19-release-history.md`](19-release-history.md) §1。

## 开发者文档（从 [`dev/`](dev/README.md) 进入）

十一篇按角色组织的指南：快速开始、核心概念、effect profiles、**错误码表**（案头参考）、授权、ledger 选择、运维面、宿主（DSH/MCP/自建）、测试套件、生命周期与恢复、**管理型 state 与变更订阅**。写插件、选 profile、查报错、做运维、观测 state 都从这里走，不需要先读 12–19。

## 维护与审计合同（权威）

| 文档 | 作用 | 地位 |
|---|---|---|
| [`12-ordarium-product-baseline.md`](12-ordarium-product-baseline.md) | 产品生态位、职责边界、包布局（内核包 + 宿主适配叶包）与非目标 | **当前产品基线** |
| [`13-ordarium-action-contract.md`](13-ordarium-action-contract.md) | Action、identity、授权、状态、恢复、管理型 state 与变更订阅、DSH/MCP 映射合同 | **当前运行合同** |
| [`14-ordarium-implementation-plan.md`](14-ordarium-implementation-plan.md) | 已实现能力、验证门、Palimpsest 复兴方向 | 当前工程基线 |
| [`15-ordarium-complete-architecture.md`](15-ordarium-complete-architecture.md) | 产品形态、权威分层、完整组件关系与运维闭环 | **当前完整架构** |
| [`16-ordarium-mermaid-architecture-atlas.md`](16-ordarium-mermaid-architecture-atlas.md) | 全部视角的 Mermaid 投影 | 当前视觉架构索引 |
| [`17-ordarium-goals-and-acceptance.md`](17-ordarium-goals-and-acceptance.md) | G0–G18 与 ORD-BOOT-0/0.1 的阶段目标、验收矩阵与发布门 | **Goal 与验收最高权威** |
| [`18-release-compat-policy.md`](18-release-compat-policy.md) | 发布兼容政策与消费者核对单（宿主中立）：release notes 行为变化五类清单、消费侧 bump 核对模板 | **发布沟通纪律**（与 [`../evidence/compatibility-register.md`](../evidence/compatibility-register.md) 互补：登记表管"层"，本文管"话"） |
| [`19-release-history.md`](19-release-history.md) | 版本与发布史：每版的档位、头条交付、消费者可见变化与证据指针 | **发布事实台账**（只追加，不回溯改写） |

## 研究档案（从 [`research/`](research/agent-landscape-2026-08/README.md) 进入）

| 文档 | 内容 |
|---|---|
| [`research/agent-landscape-2026-08/`](research/agent-landscape-2026-08/README.md) | 2026-08 多智能体架构全景的代码级取证（Grok/Kimi/Manus/Danus/OpenManus/Magentic 六系统）、Ordarium 的层级定位与复刻可行性推演、三种公共账本分类法、dsh 集成取证、两项目责任宪章 |
| [`research/vision-realization-2026-08.md`](research/vision-realization-2026-08.md) | 愿景实现评估：三级命题对账全文与实现阶梯推演；可执行门槛的权威载体在 docs/17 §16.9 |
| [`research/ORD-BOOT-0-state-change-feed-assessment.md`](research/ORD-BOOT-0-state-change-feed-assessment.md) · [`-spec.md`](research/ORD-BOOT-0-state-change-feed-spec.md) · [`-delivery-report.md`](research/ORD-BOOT-0-delivery-report.md) | 修订型 state 变更订阅原语的审计、冻结规范与交付报告（1.3.0 语义原文保留） |
| [`research/ORD-BOOT-0.1-state-change-feed-hardening-assessment.md`](research/ORD-BOOT-0.1-state-change-feed-hardening-assessment.md) · [`-spec.md`](research/ORD-BOOT-0.1-state-change-feed-hardening-spec.md) · [`-delivery-report.md`](research/ORD-BOOT-0.1-delivery-report.md) | 边界加固（limit 域、未来 cursor、页大小上限）的复现、规范与交付报告；spec supersedes ORD-BOOT-0 §5/§7 |
| [`research/palimpsest-alignment-routine-review-2026-09-06.md`](research/palimpsest-alignment-routine-review-2026-09-06.md) · [`research/palimpsest-aln4-2-confirmation-2026-09-06.md`](research/palimpsest-aln4-2-confirmation-2026-09-06.md) | 与姊妹仓的两仓对账回执与确认文书（消费 bump、conformance 案例、发布面复核） |

**研究参考，不是合同**——与 12–19 冲突时以 12–19 为准；其中"行动项"类结论进入 Goal 流程前只是提案。

## 证据链与验证入口

实现证据（delta sheets、design specs、各 Goal exit reports、Node 矩阵、release candidate 报告、stress 报告）位于 [`../evidence/`](../evidence/)；目录约定与 Delta Sheet 模板见 [`../evidence/README.md`](../evidence/README.md)。

机器验证入口见 [`../package.json`](../package.json)：

```text
pnpm check / test            全量构建 + 单元/核心测试
pnpm test:integration        SQLite reopen/migration、双进程、DSH/MCP 生命周期
pnpm test:conformance        ledger/Provider/宿主可移植 conformance
pnpm verify:architecture     依赖图、public API 快照、冻结 union、SQLite 基线、兼容登记
pnpm verify:docs             文档链接、代码围栏、README 宣称审计
pnpm test:package            六 tarball 独立消费 + 类型探针
pnpm verify:release          聚合全部 release-blocking 门
pnpm verify:matrix           Docker Node 矩阵（24.15.0 下限 + 当前线）
```

## 建议阅读顺序

- **想用起来**：根 [README](../README.md) → [`dev/01`](dev/01-getting-started.md) → [`dev/02`](dev/02-core-concepts.md) → [`dev/03`](dev/03-effect-profiles.md)。
- **想接入 state / 观测变更**：[`dev/11`](dev/11-state.md) → [`dev/06`](dev/06-ledgers.md) → [`research/ORD-BOOT-0.1-…-hardening-spec.md`](research/ORD-BOOT-0.1-state-change-feed-hardening-spec.md)。
- **想审合同**：[`13`](13-ordarium-action-contract.md) → [`15`](15-ordarium-complete-architecture.md) → [`17`](17-ordarium-goals-and-acceptance.md)。
- **想知道发了什么**：[`19`](19-release-history.md) → [`18`](18-release-compat-policy.md) → [`../evidence/`](../evidence/README.md)。
