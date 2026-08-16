# Ordarium 文档索引与工程边界

Ordarium 的完整规范、合同与证据链分布如下；本文是 Ordarium 侧的导航入口。Palimpsest 线的规范在仓库根 [`../../docs/00–11`](../../docs/)，两线边界见根 [`README.md`](../../README.md)。

| 文档 | 作用 | 地位 |
|---|---|---|
| [`12-ordarium-product-baseline.md`](12-ordarium-product-baseline.md) | 产品生态位、职责边界、包布局（含 G9 官方插件壳）与非目标 | **当前产品基线** |
| [`13-ordarium-action-contract.md`](13-ordarium-action-contract.md) | Action、identity、授权、状态、恢复和 DSH/MCP 映射合同 | **当前运行合同** |
| [`14-ordarium-implementation-plan.md`](14-ordarium-implementation-plan.md) | 已实现能力、验证门、Palimpsest 复兴方向 | 当前工程基线 |
| [`15-ordarium-complete-architecture.md`](15-ordarium-complete-architecture.md) | 产品形态、权威分层、完整组件关系与运维闭环 | **当前完整架构** |
| [`16-ordarium-mermaid-architecture-atlas.md`](16-ordarium-mermaid-architecture-atlas.md) | 全部视角的 Mermaid 投影 | 当前视觉架构索引 |
| [`17-ordarium-goals-and-acceptance.md`](17-ordarium-goals-and-acceptance.md) | G0–G9 阶段目标、验收矩阵与发布门 | **Goal 与验收最高权威** |

实现证据链（delta sheets、design specs、各 Goal exit reports、Node 矩阵、release candidate 报告）位于 [`../evidence/`](../evidence/)；机器验证入口见 [`../package.json`](../package.json)（`pnpm verify:release` / `verify:matrix` / `verify:architecture` / `verify:docs`）。
