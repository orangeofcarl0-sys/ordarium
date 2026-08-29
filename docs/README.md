# Ordarium 文档索引与工程边界

Ordarium 的文档分两层：**开发者指南**（`dev/`，面向使用者的可读投影）与**维护/审计合同**（12–18，权威规范）。两层冲突时以 12–18 为准。Palimpsest 线的规范在仓库根 [Palimpsest 规范 00–11](https://github.com/orangeofcarl0-sys/palimpsest/tree/main/docs)，两线边界见根 [Palimpsest 仓库](https://github.com/orangeofcarl0-sys/palimpsest)。

## 开发者文档（从 [`dev/`](dev/README.md) 进入）

十篇按角色组织的指南：快速开始、核心概念、effect profiles、**错误码表**（案头参考）、授权、ledger 选择、运维面、宿主（DSH/MCP/自建）、测试套件、生命周期与恢复。写插件、选 profile、查报错、做运维都从这里走，不需要先读 12–18。

## 维护与审计合同（权威）

| 文档 | 作用 | 地位 |
|---|---|---|
| [`12-ordarium-product-baseline.md`](12-ordarium-product-baseline.md) | 产品生态位、职责边界、包布局（含 G9 官方插件壳）与非目标 | **当前产品基线** |
| [`13-ordarium-action-contract.md`](13-ordarium-action-contract.md) | Action、identity、授权、状态、恢复和 DSH/MCP 映射合同 | **当前运行合同** |
| [`14-ordarium-implementation-plan.md`](14-ordarium-implementation-plan.md) | 已实现能力、验证门、Palimpsest 复兴方向 | 当前工程基线 |
| [`15-ordarium-complete-architecture.md`](15-ordarium-complete-architecture.md) | 产品形态、权威分层、完整组件关系与运维闭环 | **当前完整架构** |
| [`16-ordarium-mermaid-architecture-atlas.md`](16-ordarium-mermaid-architecture-atlas.md) | 全部视角的 Mermaid 投影 | 当前视觉架构索引 |
| [`17-ordarium-goals-and-acceptance.md`](17-ordarium-goals-and-acceptance.md) | G0–G9 阶段目标、验收矩阵与发布门 | **Goal 与验收最高权威** |
| [`18-release-compat-policy.md`](18-release-compat-policy.md) | 发布兼容政策与消费者核对单（宿主中立）：release notes 行为变化五类清单、消费侧 bump 核对模板 | **发布沟通纪律**（与 `evidence/compatibility-register.md` 互补：登记表管"层"，本文管"话"） |

## 研究档案（从 [`research/`](research/agent-landscape-2026-08/README.md) 进入）

[`research/agent-landscape-2026-08/`](research/agent-landscape-2026-08/README.md)：2026-08 多智能体架构全景的代码级取证（Grok/Kimi/Manus/Danus/OpenManus/Magentic 六系统）、Ordarium 的层级定位与复刻可行性推演、三种公共账本分类法、dsh 集成取证、两项目责任宪章。**研究参考，不是合同**——与 12–18 冲突时以 12–18 为准；其中"行动项"类结论进入 Goal 流程前只是提案。

[`research/vision-realization-2026-08.md`](research/vision-realization-2026-08.md)：愿景实现评估（2026-08-29）——三级命题对账全文、1.1.0 净贡献与实现阶梯推演；可执行门槛的权威载体在 docs/17 §16.9。

实现证据链（delta sheets、design specs、各 Goal exit reports、Node 矩阵、release candidate 报告）位于 [`../evidence/`](../evidence/)；机器验证入口见 [`../package.json`](../package.json)（`pnpm verify:release` / `verify:matrix` / `verify:architecture` / `verify:docs`）。
