# 05 · 两项目责任宪章：Ordarium × Palimpsest

> Palimpsest（新线 v0.1.2，`palimpsest-dsh`）是 Ordarium 的姊妹工程：管理层的参考实现 + 头号证明场。本档案定义两项目的责任边界、组合契约，并记录 2026-08 对 Palimpsest 的双轴审计。

## 1. Palimpsest 现状（artifact-verified，仓库逐文件）

`src/` 模块即管理层器官清单：`scheduler`（一次一事件确定性状态机，纯控制器：只看投影、每决策至多追加一事件）、`allocate`（角色槽位：implementer 2 / soft cap 8 / hard cap 20，claim 时 fail-closed）、`select`（递归两两锦标赛：判官只见紧凑摘要、平局归首保重放稳定、`PairwiseJudge` 接口显式承认 LLM 判官破坏重放性）、`evidence`（**门禁 DSL** + evidence graph + 失效传播）、`state`（SQLite append-only **哈希链**事件日志 + projector + 快照）、`effects/runtime.ts`（Ordarium Safe Actions 的消费面）、`tools`（9 工具 + CLI + 技能三入口同一控制器）。

三条设计公理（README 原文）：
> "worker 自述不构成证据；证据仅由确定性门禁产生。晋升必须通过已注册门禁。"
> "每次计划修订生成新版本，旧版本与旧证据按绑定关系保留并自动失效。"
> "进程与会话可在任意时刻中断，重启后从断点继续。"

**门禁 DSL**（`evidence/gate_dsl.ts`）：`GateDefinition {gate_id, version, subject_type: attempt|commit|task, require: all|any 子句链}`；子句 = `exists/count/not` × 白名单谓词（`process_exit_zero`、`tests_pass`、`lint_pass`、`expected_files_exist`…）；纯函数、永不执行工具；`INCOMPLETE ≠ FAIL`（"缺证据不等于证据不存在"）；输出 `evidence_used` 与 `next_evidence_needed`（Evidence Demand Generator，不是 verdict oracle）。

**分配器 U×V 象限**（`allocate/allocator.ts`，raw-notes §35）：高不确定+易验证 → 8 候选并行；中不确定 → 4；高不确定+弱验证 → **不增采样**，改派强推理 + 判别性实验。——Anthropic 用 prompt 做的 effort sizing、Kimi 训练进权重的调用预算，Palimpsest 做成了代码策略。

## 2. 器官级比较（vs 调研六系统）

| 器官 | 市场形态 | Palimpsest | 评价 |
|---|---|---|---|
| 计划状态 | Magentic：上下文内单条消息（compact 即失） | 哈希链事件日志 + 版本修订 + 失效绑定 | "状态离开上下文窗口"趋势的完成态 |
| 产出者≠判定者 | Danus LLM verifier；Magentic LLM judge；Grok prompt 劝说 | **确定性门禁**（全谱系唯一非 LLM 判定） | 最锋利的差异化 |
| 失效/撤销传播 | Danus 事实级联 revoke | 计划版本失效连带绑定证据自动失效 | 同源器官独立演化（趋同） |
| 并发预算 | Grok agent_budget（次数） | 角色槽位（资源形状） | 互补 |
| 候选选择 | 无一家形式化 | 锦标赛（多候选 → 确定性选择） | 谱系独有 |
| 证据落账 | 各家自研 | **外包给 Ordarium**（release tarball 消费） | 唯一做了内核/宿主分离 |

## 3. 责任宪章

- **Ordarium = 证据型时间线引擎**（管理型 state kind 为既定 Stage 1，见 [`03`](03-ledger-taxonomy.md)）：宿主中立、领域无知；副作用承诺、授权、恢复。
- **Palimpsest = 管理层参考实现 + 头号证明场**：① 拥有管理层的模式与策略（计划模式、门禁、槽位、锦标赛、会话恢复/mode）——宿主特定所以属于生物体，但必须做成可移植设计（"general"期望的落点：执行器协议即可移植接缝）；② 用真实负载证明内核——它是 Ordarium 内核资格测试里的"第二宿主"项；③ 守住对话型边界——对话留宿主传输层，Palimpsest 的贡献是纪律："自述不构成证据"即"对话型记录永不自动升级为证据型"的宪法级表述。
- **组合契约**：计划修订**引用** Ordarium operations 作为证据基础；版本失效沿引用把绑定证据传播失效（"绑定关系保留并自动失效"的现有实现）；门禁消费 operation 证据作为输入。
- **禁止令（双方宪章各一条）**：Palimpsest 不得自写 CAS/fence/锁（一切并发与恢复消费 Ordarium）；Ordarium 不得伸手编排/消息（引擎一旦做编排就退化为框架）。

## 4. Palimpsest 双轴审计（2026-08）

**严谨性：三项强、一处缝未焊。**
- 可溯 ✓✓：哈希链事件存储（620 行）+ projector + 快照 + evidence graph + 失效绑定——全谱系最强之列。
- 确定 ✓✓：一次一事件调度器；门禁 DSL（纯函数、白名单、INCOMPLETE≠FAIL）；锦标赛平局归首。**全谱系唯一非 LLM 判定**。
- 恢复 ✓计划层 / ✗副作用层：全 `src/` 无 `OPERATION_UNCERTAIN`/reconcile 处理——Ordarium 的恢复语义未被消费，promotion 操作落 uncertain 时无从处置（**待焊接缝**）。
- 安全 ✓ 结构性：副作用全走 Safe Actions；门禁纯函数；fail-closed 槽位；attempt 绑定项目版本 + 隔离工作区。worker 工作区隔离强度待专项审计。

**灵活性：拓扑内自适应是亮点，跨拓扑是空白。**
- ✓ 编排者-工作者原生形态（强于 Grok Bot——多确定性门禁）；Magentic 式 ledger 的持久化超集；Danus 式验证晋升同构。
- ✓ **U×V 自适应并行**是真·架构自适应（effort sizing 的代码化）。
- ✗ 跨拓扑：角色词汇表 schema 封闭（TaskRole 五种，"frozen aggregate"）；无 workflow 脚本面；无对等通道抽象；hard cap 20 + 单机 SQLite。
- ✗ **自发重构自身架构**：能调整并行度与计划内容，不能调整架构本身；`GateDefinition` 有 version 字段但不在事件存储里（差半步）。

**总判词**：当前 Palimpsest = "严谨优先的固定形态编排器"——该定位合格且判定器官全谱系最严格；作为自重构通用底座未合格。

**通往双轴兼得的唯一动作**：把 gate DSL 的成功模式推广——**角色表、阶段图、门禁注册表全部上哈希链**成为事件溯源的声明式定义；"架构调整" = "一次计划修订 + 通过晋升门禁"——**系统只能通过自己的证据门禁重构自己**。Grok Build 的 workflow 脚本退化为带门禁的阶段图定义，Heavy 的对等通道退化为通道型角色定义，而每次自修改可溯、可回滚、确定性可验证。随后两件小事：焊 `OPERATION_UNCERTAIN` 接缝（同时完成 Ordarium 内核资格测试的第二宿主项）；worker 隔离强度审计。

## 5. 对 Ordarium 的直接含义

1. Palimpsest 即"第二真实宿主"资格判据的载体——它对 operation ledger 的每一类消费（promotion、失效传播、门禁查询）都是内核合同的实战检验。
2. 管理型 state kind（Stage 1）的第一个需求方就是 Palimpsest：计划修订上链的现状是自建事件日志，若内核提供 state kind，Palimpsest 可收缩自建面、两时间线合一。
3. `OPERATION_UNCERTAIN` 接缝的缺失是双向的教训：内核提供了恢复语义，宿主必须消费——docs/dev/10 的宿主职责清单应把"处理 uncertain"列为显式合同项。
