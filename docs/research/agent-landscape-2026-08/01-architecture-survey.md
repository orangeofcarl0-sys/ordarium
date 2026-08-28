# 01 · 六系统代码级取证

> 取证日期 2026-08-17 至 2026-08-29。每个系统标注：取证来源、结构（拓扑）、管理（控制权/状态/权限）、策略（决策所在层）。artifact-verified = 亲手抓取的文件原文；inferred = 由行为/文档推断。

## 1. Grok（xAI）——三个 prompt，三种拓扑

### 1.1 取证来源

- 提取仓库 [`asgeirtj/system_prompts_leaks`](https://github.com/asgeirtj/system_prompts_leaks) 的 `xAI/` 目录：`grok-bot.md`（4719 行）、`grok-expert.md`（598 行）、`grok-build.md`（1304 行）、另有 grok-3 至 grok-4.5 各版本。以下引文均自 raw 原文。
- 2025-08-29 xAI 起诉前员工 Xuechen Li 案：被指下载整个 Grok 代码库上传至 OpenAI 服务器，**该源码从未公开**（[Reuters](https://www.reuters.com/legal/litigation/musks-xai-sues-engineer-allegedly-taking-secrets-to-openai-2025-08-29/)；xAI 诉 OpenAI 本体的商业秘密主张后被驳回，[Courthouse News](https://www.courthousenews.com/judge-tosses-xai-claims-that-openai-stole-trade-secrets/)）。

### 1.2 grok-bot（桌面助手）——编排者-工作者 + 外包编码

- **回合协议**：SendMessage 是唯一对用户出口（"Your plain assistant text is an inner monologue the user never sees"）；reply-first 规则；"ack ≠ delivery"（开工确认不等于交付结果）。
- **结构**：主 agent 经 `Task` 工具派发 **10 种类型化后台 subagent**：computerUse、browserUse、debug、videoReview、vmSetupHelper、watchVideo、cursor-guide、explore、shell、generalPurpose；配 `CheckSubagent`（状态 + live transcript）、`MessageSubagent`（强插指令但保留上下文）、`StopSubagent` 三个控制工具。卡死判定写入 prompt："A stalled computerUse subagent looks identical to a busy one from the outside: no recent tool activity, the same screen for a while, or the same action repeating means it's stuck, not progressing."
- **管理：升级阶梯**（最便宜最可靠优先，明文禁止跳级）：记忆/文件 → MCP 连接器 → Web → 已登录浏览器 → 桌面 GUI → 交还用户。
- **代码工作全部外包**：`CloudAgent` 工具（Cursor 云编码 agent，远端 VM 开 PR）；"Never clone a repository, onto your own computer or the user's"。**Grok Bot 实际构建在 Cursor 基础设施上**（Origin 源码平台、Cursor 账号插件系统、Cursor 云 VM）。
- 运行时：box = Docker 容器或 anyrun pod；`ExternalShell`/`ExternalRead` 触达用户真机（每次动作需用户审批卡）；routines（定时唤醒）、channels、memory 文件模板。

### 1.3 grok-expert（Heavy 模式）——聊天室协议，非投票共识

原文（artifact-verified）：

> "You are Grok and you are collaborating with Harper, Benjamin, Lucas. As Grok, you are the team leader… The other agents… are given the same prompt and tools as you are, except only you have render components."

- 四个**同模型** agent 进命名聊天室；协作靠两工具：`chatroom_send`（to: Benjamin/Harper/Lucas/All；**消息注入语义**：对方在思考→作为函数轮次直接插入；对方在工具调用中→追加到该调用的函数响应）；`wait`（阻塞等队友/异步工具，单次 ≤120s、全局 ≤200s）。
- 工具面：code_execution（Python 3.12.3 stateful REPL）、browse_page、view_image、web_search、x_keyword_search、x_semantic_search、x_user_search、x_thread_fetch、view_x_video、conversation_search、search_images；渲染组件（citation/image/file）仅队长可用。
- **结论**：第三方博客描述的"4 路并行 + 辩论 + 共识投票"不准确——实际是 leader 合成的点对点消息协议。

### 1.4 grok-build（CLI 编码 agent）——代码即编排

- `<action_safety>` 原文：*"Weigh each action by how easily it can be undone and how far its effects reach. Local, reversible work… is fine to do freely."* *"One approval is not a blank check."*（与 Ordarium 的 effect-profile / 再授权哲学同构，但只是 prompt 层劝说。）
- 27 个工具定义，编排相关：`spawn_subagent`（四类：general-purpose / explore / plan / Explore；默认后台、按 agent id 可续）；`scheduler_create/delete/list`（定时任务，间隔 ≥60s，上限 50 个，7 天过期）；`monitor`（stdout 流式回聊天）；**`workflow`**——Rhai 脚本编排：`agent()` / `parallel()` 原语，`agent_budget` 子代理调用绝对累计上限（默认 128、上限 1024，"A panel that would exceed the remaining budget is rejected before any of its children launch"），pause/resume/stop + `resume_from_run_id`（同进程），脚本持久化 `.grok/workflows/*.rhai`。

## 2. Kimi（Moonshot AI）——模型层协议 + harness 层加载式工具

- **K3 harness**（提取 prompt，611 行）：**加载式工具系统** `select_tools`——多数工具不常驻，仅以名字广播（`tools_added`/`tools_removed` 增量日志），调用前必须加载；常驻仅 todo/ipython/shell/web_search。插件系统（MCP 工具命名 `mcp__plugin-<plugin>_<server>__<tool>`，append-only 差量日志）；技能系统（capability × artifact 分级、用户技能压倒内建、内建冲突时 artifact 技术约束胜出）；沙箱仅 `/mnt/agents` 持久化（output/tmp/upload 分区）；cron 工具为加载式。
- **Swarm**（[官方页](https://www.kimi.ai/zh-hans/resources/multi-agent)）：编排 300+ 子代理、最多 4000 并行工具调用；角色自动分配（研究员/分析师/撰稿人/软件工程师/演示制作）；写作 = 层级模式（manager → 调研 agent / 撰写 agent / 编辑 agent）；内置 `deep-research-swarm`、`pptx-swarm`、`report-writing`、`webapp-building`。**关键事实：swarm 在 K3 单体 prompt 中完全不存在——编排层对单个 agent 不可见。**
- **K2 wire format**（`chat_template.jinja` 原文）：`<|im_system|>tool_declare` + JSON 声明工具；调用输出 `<|tool_calls_section_begin|><|tool_call_begin|>functions.<name>:<index><|tool_call_argument_begin|>{args}<|tool_call_end|>…<|tool_calls_section_end|>`（原生 special token，**单 section 多调用 = 协议级并行**）；工具结果回填 `## Return of {tool_call_id}`。
- **K2-Thinking**（[模型卡](https://huggingface.co/moonshotai/Kimi-K2-Thinking)）："stable tool-use across **200–300 sequential calls**"；评测步数上限 HLE 120 步（每步 48k 思考预算）/ agentic search 300 步（每步 24k）；原生 INT4、256k 上下文。
- **Kimi-Researcher**（[官方博客](https://moonshotai.github.io/Kimi-Researcher/)）：端到端 agentic RL（REINFORCE，无 SFT、无工作流模板）；结果奖励 + γ 衰减偏爱短轨迹；turn-level partial rollout + replay buffer（≥1.5× 加速）；三工具（并行内部搜索、文本浏览器、代码执行）；平均 23 步 / 200+ URL / 70+ 搜索；上下文剪枝支撑 50+ 轮；K8s 统一沙箱 + **MCP 有状态可重连会话**。

## 3. Manus——最克制的脚手架，最强的上下文纪律

- **29 工具**（[提取镜像](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools) `Manus Agent Tools & Prompt/tools.json`）：message 2（notify/ask）、file 5（read/write/str_replace/find_in_content/find_by_name）、shell 5（exec/view/wait/write_to_process/kill_process）、browser 12、info_search_web 1、deploy 2（expose_port/apply_deployment）、make_manus_page 1、idle 1。
- **agent loop 六步**（`Agent loop.txt` 原文）：Analyze Events → Select Tools → Wait for Execution → Iterate → Submit → Standby；**每次迭代恰一个工具调用**；事件流结束于 idle 终态。
- **模块注入**（`Modules.txt`）：事件流里混入系统生成的 Planner 模块（"编号伪代码 + 步骤状态 + reflection"）、Knowledge 模块、Datasource 模块——agent 只读不回。todo.md 纪律：按 planner 输出创建、每完成一项 `file_str_replace` 打勾、计划大改时重建。
- **上下文工程**（[官方博客](https://manus.im/blog/context-engineering-for-ai-agents-lessons-from-building-manus)）：把上下文当有限 RAM；KV-cache 感知（append-only、稳定前缀）；todo.md 复述目标；工具结果压缩后即弃；**文件系统即外存、无向量库**（每会话全新沙箱，检索靠 grep/glob）；委托双通道——简单子任务函数调用传最小指令，复杂子任务文件传递。

## 4. Danus（FrenzyMath）——与 Ordarium 同构的已验证系统

来源：[arXiv:2607.06447](https://arxiv.org/abs/2607.06447)、[仓库](https://github.com/frenzymath/Danus)（浅克隆逐文件阅读）。此前身 Rethlas（arXiv 2604.03789）；本分支（codex orchestrator）已解决 YTD 问题（arXiv 2608.19301）；main 分支换 Claude Code 编排器。

- **五层**（ARCHITECTURE.md）：① 主 agent（conducts, never does math）→ ② 策略合成（periodic elaboration → master_guidance）→ ③ worker 群（每轮 = 1 个 codex 会话）→ ④ cold-start verifier（正确 ⟺ 无 critical_errors 且无 gaps）→ ⑤ 事实图（唯一事实来源）；全部读写过 ⑥ role-gated 网关（6 工具）。
- **权限骨架**（`danus/gateway/roles.py`，50 行纯数据）：`ROLE_TOOLS` 表——worker 独有 `fact_submit`；main 无 fact_submit（"the agent that steers the search structurally cannot introduce unverified mathematics"）；verifier 只读。未知角色回落最受限只读集（"a typo can never grant write access"，fail-closed）。
- **事实图**（`danus/core/factgraph.py` + `schema.py`）：每事实一个 markdown 文件（YAML frontmatter：fact_id/problem_id/author/predecessors/glossary_introduces + statement/proof/intuition）；`compute_fact_id` = 规范化（空白折叠）+ 排序（predecessors/glossary）后 SHA-256 取 16 hex——"Same content → same id → natural dedup"；external_refs 故意不参与哈希（可变元数据不得扰动 ID 破坏 DAG）。`revoke` 级联撤销全部 descendants，移入 `_revoked/`，JSONL 撤销日志（含 `revoked_as_dependent_of`）。
- **写入门**（`server.py` `fact_submit`）：唯一写路径；glossary 覆盖检查 advisory；verifier HTTP 调用；**accept 才落图**；reject 返回修复提示零写入；**"Once a verdict exists, the verification outcome is always recorded to global memory — accept, reject, or accept-but-write-failed — so a verdict is never stored by nobody."**
- 规模：3,157 已验证事实 / 8,616 依赖边 / 最长链 54（论文报告）。

## 5. OpenManus——复刻了形，没复刻到神

来源：[FoundationAgents/OpenManus](https://github.com/FoundationAgents/OpenManus)（浅克隆）。`app/agent/base.py`：`BaseAgent` 状态机（IDLE/RUNNING/FINISHED/ERROR，`max_steps` 默认 10）；`is_stuck()` = 统计重复响应次数；`handle_stuck_state()` = 注入一句 prompt（"Observed duplicate responses. Consider new strategies…"）——纯文本劝说，无结构化机制。规划 = `PlanningTool`（进程内存 dict）。与闭源 Manus 的三个本质差距：观察驱动 vs 响应驱动、无模块注入、上下文纪律缺失。MetaGPT 同团队 3 小时复刻。

## 6. Magentic（原 Magentic-One）——ledger 编排器的生产化归宿

来源：[microsoft/agent-framework](https://github.com/microsoft/agent-framework) `python/packages/orchestrations/agent_framework_orchestrations/_magentic.py`（1810 行，抓取原文）。

- **TaskLedger**：`facts` + `plan`；facts 强制四分类——请求给定 / 需查找 / 需推导 / **记忆或猜测**；ledger 渲染为**单条 assistant 消息**（上下文内），编辑语义显式（"adding new guesses, moving educated guesses to verified facts"）。
- **ProgressLedger**（每步刷新）：五项各带 answer/reason/critique/confidence——`is_request_satisfied`、`is_in_loop`、`is_progress_being_made`、`next_speaker`、`instruction_or_question`；stall 由结构化自评驱动重规划或终止（对比 OpenManus 的文本劝说高一个量级）。
- 生态：官方 `magentic_checkpoint.py`（编排检查点）、`magentic_human_plan_review.py`（人类审批计划）示例已存在。

## 7. 框架背景（定量框架）

- **Anthropic**（[工程博客](https://www.anthropic.com/engineering/multi-agent-research-system)）：orchestrator-worker（lead agent + 并行 subagent 独立上下文）；比单 agent Opus **+90.2%**；多 agent **≈15× chat token**；并行工具调用 **≈省 90% 时间**；教训：显式教 lead 委托与 effort sizing、LLM-as-judge + 评分表、结果导向评测、异步 checkpoint、优雅降级。配套研究记录 coordination failure / 共谋 / 破坏。
- **OpenAI**：Agents SDK 最小原语（Agent/Tool/**Handoff**/Guardrails/Session/tracing）；AgentKit 平台功能 2026-11-30 起弃用，收敛回代码化 SDK——**"编排即代码"在收敛**。
- **Google/MIT《Towards a Science of Scaling Agent Systems》**（[arXiv 2512.08296](https://arxiv.org/abs/2512.08296)，180 种配置）：错误放大系数 Aₑ——单 agent 1.0×、**独立并行 17.2×**、集中/去中心/混合 1.0–7.8×；多 agent 只在知识密集型任务上赢（赢在视角多样性 + 并行，非算力）；集中式编排对错误的抑制显著最优。**"多 agent = 更好"不普遍成立。**
