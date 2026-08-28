# 02 · Ordarium 的定位：引擎层、复刻可行性与内核资格

> 本文回答三个问题：Ordarium 在谱系上处于哪一层（不是和谁竞争）；以 Ordarium 为主内核能否复刻市面主要架构（不必完美）；"统一标准核心"这个宣称 today 能不能立。

## 1. 层级定位：六个生物体之下，缺一个引擎层

六个系统是**完整生物体**；Ordarium 是可被它们**各自嵌入**的器官的引擎化。因此有意义的比较对象不是"Grok vs Ordarium"，而是"每个系统体内手搓的器官 vs 它的引擎版"。

| 系统 | 体内自研器官 | 从代码看到的弱点 | Ordarium 引擎接管 | 留在宿主 |
|---|---|---|---|---|
| Danus | 事实图 + 角色门控网关 | 领域绑定（数学）、markdown 后端、单机 | 通用副作用账本、SQLite 跨进程 CAS/lease/fence | 数学语义、verifier 判官、master_guidance |
| Magentic | Task/Progress Ledger | 住在**上下文里**（compact 即失、不可撤销） | ledger 移出上下文、checkpoint/恢复、审计 | 五项自评、next_speaker、重规划 |
| Grok Bot/Build | workflow run 状态 + action_safety prompt | 状态闭在 Cursor 平台；安全 = prompt 劝说 | run/子代理操作落账、按可逆性分级的机制化（effect profile） | Rhai 编排、消息面、scheduler |
| Kimi Swarm | 黑盒编排状态 | 不可审计；并发仲裁不可见 | 并行调用的 claim/lease/fence 仲裁、跨宿主审计 | 编排循环、角色分配 |
| Manus | todo.md + 事件流 | 设计上单 agent，无共账 | 共账拓扑（多 agent 共账为一等部署形态） | 事件流、沙箱、上下文工程 |
| OpenManus | 内存 dict | 无持久化、无隔离 | ——（作为反面参照） | —— |

## 2. 谱系分析

### 2.1 共同祖先（2023-2024）与选择压力

祖先基因：AutoGen（对话式多 agent）、MetaGPT/CAMEL（角色隐喻）、Claude Code（终端 agent 形态定型——Grok Build 的 plan mode/subagent 与之同源）、Self-Consistency/Debate（采样+聚合）、browser-use 一代（LLM+工具循环原型）。

四个选择压力，每个系统都能定位到是哪几个的产物：**上下文腐烂**（→ todo.md/事件流/ledger）；**错误放大**（独立并行 17.2× → Danus verifier 唯一写权、Heavy 队长合成）；**token 经济学**（15× → 预算器官）；**副作用风险**（目前只有 prompt 劝说 + 沙箱隔离——**没有一支演化出持久化副作用协议，这是谱系上的空位**）。

### 2.2 趋同器官（独立演化 ≥3 次 = 生态位必解）

1. **持久共享状态**：Manus todo.md / Magentic ledger / Danus 事实图 / Grok workflow run——四种实现，同一器官。
2. **产出者 ≠ 判定者**：Danus verifier / Magentic progress-ledger / Anthropic citation agent。
3. **加载式工具面**：Kimi select_tools / Grok GetMcpTools / dsh 插件市场。
4. **预算机制**：OpenManus max_steps / Grok agent_budget / Kimi 把 200-300 次调用训练进权重。

### 2.3 死枝（把可靠性寄托在模型"听劝"上的分支）

自由对话式协作（AutoGen 原形态，被 ledger 结构化取代）；向量库作 agent 记忆（Manus 公开抛弃）；托管黑盒编排（AgentKit 弃用，收敛回代码）；文本劝说式止损（OpenManus，被结构化自评淘汰）。

### 2.4 当下两轴分化

- **智能密度轴**：模型密集（Kimi：循环训练进权重，harness 薄）↔ harness 密集（Grok/Manus：脚手架长）。**合流方向：训练过的模型 + 薄而可审计的 harness**。
- **状态位置轴**：状态正在**离开上下文窗口**——Magentic（上下文内消息，最脆弱）→ Manus（文件系统）→ Danus（内容寻址持久图）→ 下一步（Ordarium 所在）：把**外部副作用本身**做成持久、可撤销、带授权证据的状态。

## 3. 复刻可行性：八架构 × Ordarium 原语

> 结论：全部八种骨架可用"Ordarium 原语 + 至多一个已声明边界外的宿主模式"拼出。推演本身即内核边界审计——没有一家要求 Ordarium 违背单一职责。

| 架构 | 骨架需要内核提供 | Ordarium 对应 | 宿主侧 | 缺口/处理 |
|---|---|---|---|---|
| Grok Bot（编排者-工作者） | 派发记录、状态追踪、危险动作审批 | spawn = guarded/reconcilable Action，operation 状态机即任务生命周期，授权证据即审批卡 | subagent 运行时、transcript、升级阶梯 | 无 |
| Grok Heavy（对等聊天室） | 产出归属与审计、合成证据链 | identity.actor + source/scope 每发现一条 record；队长读 operator view 合成 | chatroom_send/wait 消息总线 | 无（消息走宿主、证据走账本） |
| Grok Build（Rhai workflow） | run 状态、pause/resume、agent_budget 计量 | run-id 作 scope；**预算 = 账本查询**（scope 下子操作计数），超限派发前拒绝 | Rhai 运行时、scheduler | 无 |
| Kimi Swarm（大规模并行） | 4000 路对共享资源仲裁 | claim/lease/fence；内容寻址 operation id 天然去重 | 角色分配、编排循环 | SQLite 单写者为已知天花板（结构可复刻，规模需分片） |
| Manus（事件流+todo） | ——几乎不需要内核 | 只管真正危险副作用（deploy、发消息） | todo.md 留沙箱文件、事件流 | 最不吃内核的架构 |
| Magentic（ledger 编排） | ledger 跨 compact/崩溃存活 | **receipt-as-checkpoint**：ledger 修订写 record（receipt 持快照），恢复 = 重放至最新 | 五项自评、重规划 | 快照查询弱（复刻够用） |
| Danus（事实图） | 内容寻址事实、依赖边、撤销 | 事实 = idempotent Action（内容寻址去重白得）；verifier 判定落 receipt | predecessor 边、revoke 级联 → 撤销即新事件 | 依赖图查询弱 |
| Anthropic（研究） | 并行检索 + 引用核验分离 | 同 Grok Bot；核验结论 = 独立 operation 可审 | subagent 池、LLM-as-judge | 无 |

**三个反复出现的宿主模式**（复刻推演的收敛结果）：
1. 消息总线 → 宿主（账本记"谁做了什么"，不记"谁对谁说了什么"）；
2. 规划/图状态 → receipt 快照模式或宿主文件（应文档化为一等惯用法）；
3. 极限规模 → 单写者天花板（分片/排队属 v2）。

**两个内核洞察**（复刻推演的产出，均有通用价值）：
- **预算即账本查询**：agent_budget 不需自建计数器——按 scope 的账本派生视图；Grok Build 自建计数器是反例。
- **撤销即新事件**：append-only 账本下 revoke 就是一条新 record，级联 = 按依赖查询 + 逐条撤销事件；Danus 的级联撤销 + 撤销日志是实物参照。

## 4. 内核资格判据（宣称的三级拆分）

- **命题一"dsh 生态的 Safe Action 内核已足够"——是**：effect profile 五分类、operation 生命周期、跨进程 CAS/lease/fence、uncertain/reconcile、OperatorAuthorization、双宿主、稳定错误码合同、140 测试 + 发布流程（v1.0.0）。
- **命题二"可嵌入任意 harness 的引擎已足够"——架构成立、实证未证**。可证伪判据：① ≥2 非自建宿主真实共账；② 一次真实恢复案例成文；③ conformance kit 出现外部使用者；④ swarm 并发压测数据；⑤ 第二领域嵌入实证。语义缺口需显式决策：操作间依赖图与知识层（plan/学习状态）目前不在 record 模型——要么加原语，要么把拒绝写进合同。
- **命题三"统一标准"——不是现在的属性，是市场位置**。反证：六系统全部垂直整合（自拥模型+harness+基建），无动机采纳外部内核（Danus 三小时自搓事实图为证）。标准化的缝隙在长尾（无厂商资源的 harness 作者、跨厂商组合、被事故教育的团队）。路径：第二真实宿主 → conformance 被外部引用 → 公开恢复案例 → 被第三方引用。每一步可证伪。
