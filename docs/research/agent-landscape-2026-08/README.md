# 研究档案：2026-08 多智能体架构全景与 Ordarium 定位（索引）

本目录将 2026-08 一次完整的架构调研固化存档：对 Grok / Kimi / Manus / Danus / OpenManus / Magentic 六个系统的**代码级取证**，以及由此推导出的 Ordarium 定位、内核洞察与账本分类法。它是一次对话中 Ordarium 相关结论的完整外化——此后对话可弃，本档案为准。

## 溯源与纪律

- 取证方式：真实仓库浅克隆逐文件阅读（Danus / OpenManus / Magentic）、第三方提取的系统 prompt 原文抓取（Grok / Kimi）、官方模型卡与工程博客。所有关键引文标注来源路径。
- **泄露材料的使用边界**：Grok 的 prompt 来自第三方提取仓库（[`asgeirtj/system_prompts_leaks`](https://github.com/asgeirtj/system_prompts_leaks)），2025-08 Xuechen Li 案涉 xAI 源码从未公开（详见 [`01`](01-architecture-survey.md) §1.4）。本档案仅作研究与设计参考引用，全部标注 artifact-verified 与 inferred 的区分。
- 宣称纪律与 README 相同：不出现无限定的 exactly-once / tamper-proof 类表述。

## 阅读顺序

| 文件 | 内容 |
|---|---|
| [`01-architecture-survey.md`](01-architecture-survey.md) | 六系统代码级取证：Grok 三 prompt / Kimi 双层 / Manus 脚手架 / Danus 五层 / OpenManus / Magentic + 框架背景（Anthropic / OpenAI / Google 扩展研究） |
| [`02-ordarium-position.md`](02-ordarium-position.md) | Ordarium 的层级定位（引擎 vs 生物体）、谱系分析（趋同器官 / 死枝 / 两轴分化）、八架构复刻可行性、内核资格判据 |
| [`03-ledger-taxonomy.md`](03-ledger-taxonomy.md) | 对话型 / 证据型 / 管理型三种公共账本的完整推演：契约矩阵、分家 vs 统一时间线、保留类、落地次序 |
| [`04-dsh-integration-notes.md`](04-dsh-integration-notes.md) | dsh 插件机制取证、@ordarium/dsh 与 dsh-tools 的桥接合同、消费模式（npm / pnpm）、已知事故与教训 |
| [`05-palimpsest-charter.md`](05-palimpsest-charter.md) | 两项目责任宪章：Ordarium 证据引擎 × Palimpsest 管理层参考实现；组合契约；Palimpsest 双轴审计 |

## 一句话总纲

谱系上六个生物体在"持久共享状态 / 产出者≠判定者 / 加载式工具 / 预算机制"四个器官上独立趋同——这个器官层已成熟到可被抽取为引擎；Ordarium 是该引擎（证据型账本已实现，管理型 record kind 为既定下一步），Palimpsest 是管理层的参考实现与头号证明场。
