# Palimpsest 侧 ALN-4 对齐账例行复核回执（2026-09-06）

> **性质**：对 Palimpsest 仓 `docs/engineering/07-ordarium-alignment.md`（PLMP-ALN-1）r8（PLMP-CONF-1）/ r9（PLMP-CTX-2）两轮新交付后的例行对齐复核**回执 + 澄清文书**，不是新合同。与 docs/12–18 冲突时以 12–18 为准。
> **权威序**：对齐账权威在姊妹仓 07 号（裁决 ALN-2）；本仓不单方面改写其文书。本报告落盘本仓 docs/research/，随附本侧两处文书刷新（§1）与 docs/18 RCP-3 登记（§7）。
> **基线**：请求方 r8/r9（2026-09-06，依赖 bump ordarium-v1.2.0 四行 pin）；本侧 commit `f1b62d4`（工作树干净）。复核时点 2026-09-06。

---

## 1. 任务一执行：两项文书刷新（已落盘）

### 1a. charter "待焊接缝"记载过时标注（r6 裁决 refresh 落地）

r6 行（姊妹仓 07:145）裁定："全 src/ 无 OPERATION_UNCERTAIN/reconcile 处理（待焊接缝）"已过时——H1-P1 的 `reconcileAll()`/PromotionRecoveryService + `isTransientOperationError`（UncertainOperationError 映射）即该缝；refresh 归 Ordarium 侧。已按"标注过时而非删除历史"执行：

| 位置 | 处置 |
|---|---|
| `docs/research/agent-landscape-2026-08/05-palimpsest-charter.md:5` | 头部新增【2026-09-06 勘误标注】：§4/§5.3 接缝记载已过时、原文按审计史保留 |
| 同文件 `:44` | §4 恢复项（原 41 行"待焊接缝"句）追加过时标注：焊缝实体（`reconcileAll()`/PromotionRecoveryService + `isTransientOperationError`）+ TLM/ALC 补齐 state kind 迁移面 |
| 同文件 `:56` | "通往双轴兼得的唯一动作"两件小事追加进度标注：焊缝 + 第二宿主项（PLMP-CONF-1）已完成；**worker 隔离强度审计仍未发生，继续在册** |
| 同文件 `:63` | §5.3 第 3 条追加过时标注："缺失"已过时；建议已兑现——`docs/dev/10-lifecycle-and-recovery.md:40` 现明文"处理 `uncertain` 是显式合同"（宿主职责清单第 2 条） |

### 1b. 诉求③ G11 文档补记（append-only 形状反馈）

已补记两处：

- **主载体**：`evidence/G11/design-spec.md:145-160` 新增 **§10 冻结后补记：首消费者形状反馈**——反馈内容（计数器类负载的正确形状是 append-only 主体而非覆盖式 CAS 累加槽位；覆盖式计数器在多写者下无干净合并规则：取 max 丢增量、求和双计；append-delta 把并发合并退化为交换律求和）、两处依据原文、处置结论（验证而非推翻冻结决议——append-only 主体在现行 CAS 合同内已可表达：新键 `CAS(expectedRevision:0)` 创建后不改写；是否升为一等记录形状按需求拉动另议，不预埋）。
- **Goal 线指针**：`docs/17-ordarium-goals-and-acceptance.md:753`（§16.6）句末补记一行，指向 spec §10。

**依据引用（逐条原文）**：

1. 首条反馈：PLMP-TLM-1 §1 决策记录，姊妹仓 `docs/engineering/08-telemetry-externalization-spec.md:22`（原文明言"值得 Ordarium 侧在 G11 文档中补记"；PLMP-ALN-1 r3 登记）。
2. 第二实例：PLMP-CTX-2 manifest 落账，姊妹仓 `docs/engineering/14-context-retrieval-spec.md:18`（CTX2-D2 裁决）与 `:71-73`（每 revision 一条 `CONTEXT_MANIFEST_ADDED` 事件进 canonical 审计链、幂等键不增事件 + `AttemptReport.contextManifest` 加法式可选字段；PLMP-ALN-1 r9 登记）。

**引用勘误**：来文将首条反馈出处记为"PLMP-CTX-1 §1 决策记录"；该决策记录实际落于 **PLMP-TLM-1 §1**（08 号规格 :22）——CTX-1（12 号，Context Brief 压缩器）无此记录。补记按原文出处落，已在 G11 spec §10:160 与本报告 §6 注明。属引用勘误，非账目冲突。

**诉求③状态提示**：反馈产出（Palimpsest 侧）+ 补记落地（本侧）至此闭环；姊妹仓 07 §6 诉求③行（07:113，现"进行中"）可由贵侧酌情更新——对齐账权威在贵侧，本仓不代改。

## 2. G8 item 6：DSH 适配器归属重审触发（澄清）

**载体**：commit `316b123`（docs/17 §16 第 6 项，`docs/17-ordarium-goals-and-acceptance.md:739` + `evidence/compatibility-register.md:8`）。

**完整含义**：对 2026-09-06 提出的"既然内核宿主中立，@ordarium/dsh 插件壳是否多余"问题的评估结论。判定：`@ordarium/dsh` 是**叶适配包**而非内核面——core 零宿主导入由架构门机器把关（G18 exit report A05"，`pnpm verify:architecture` 全绿"），故解散它不产生任何内核纯度收益，只付发布面代价。**双条件不成立前不拆分。**

**复审启动条件（双条件同时成立，无时钟、无主动启动者）**：

- **(a) 官方 DSH 类型可消费**——即 `COMPAT-DSH-001` 的前置约束解除（现行约束：正式 DSH 包在本环境不可消费，register:8）；
- **(b) DSH 生态愿意持有自身适配器**——适配器归属意愿是生态侧决定，本仓不代持也不强推。

两条件满足时，`@ordarium/dsh` 的宿主映射部分可迁往 DSH 仓，执行方式为 **breaking 变更：须经兼容登记（owner + 移除条件）并以 major 线执行**。

**Palimpsest 侧是否有对应义务：无。** 逐点：

1. 该触发的两个条件分别长在 DSH 官方类型可消费性与 DSH 生态意愿上，均非 Palimpsest 可触发或须配合的面。
2. **贵方 `dsh_types.ts` 镜像与本案互不阻塞**——ALN-4② 确认文书已明文（`docs/research/palimpsest-aln4-2-confirmation-2026-09-06.md` §3："镜像策略与本案无冲突且互不阻塞：G18 握手面不在被镜像的 DSH façade 内……镜像→真实 DSH manifest 的零改动切换路径照旧"）。r8 登记"④……`dsh_types.ts` 镜像与本案互不阻塞"（07:54）与本侧记载一致。
3. **"镜像→零改动切换"仅作为先例被引用**（docs/17:739 括号内），说明"宿主持有自身适配器"的可行形态，不构成对 Palimpsest 的义务或承诺。
4. **G9 运维面**：迁移实际发生时"ordarium 侧 G9 运维面随之单独裁决去留"（docs/17:739）——裁决权在本仓会话，Palimpsest 无前置义务。
5. 唯一相关注意点（既有的、非本触发新设）：若未来迁移以 major 线执行，属弃用面事件，贵方按其升级协议与 docs/18 §2 核对单第 5 项响应即可——与今天的状态无关。

## 3. 休眠 Goal 状态复核（docs/17 §16.8 + §16.10）

**G13（通信取证）——仍休眠。** 触发条件（docs/17:773，spec `evidence/G13/design-spec.md` 头部）："任一真实（非演示/非测试夹具）宿主，或 Palimpsest 复兴，提出'谁在合成/决策前对谁说了什么'的取证需求"。现状：r8/r9 五问复检第⑤问均为"无唤醒迹象"（07:147-148），本侧无需求方，无新触发。

**G14（模型工具独立 scope）——仍休眠。** 触发条件（docs/17:774，spec `evidence/G14/design-spec.md`）："操作者/运维需要跨宿主查看管理型 state（当前意图、修订历史、引用），或在 Palimpsest 复兴时随取证需要一并落地"。现状同上，无运维取证需求出现。

**关于"判据①实施预期唤醒 G14/G17"的预测**（docs/17:778、:799）：判据①虽已闭合（§4），但该预测的机制是"迁移产生跨宿主查看 state 的运维需求/失效传播迁移到内核 refs 的需要"——实际消费面未走到：refs 反查在贵方 r9 触达 grep 中仍 0 触达（07:148 ②），telemetry 试点只用 `createStateStore` 读写。**判据①闭合 ≠ 触发完成**；两 Goal 未唤醒，预测保持有效（下次触发评估仍以消费面事实为准）。

**state-kind Stage 2 规划：有设计、无排期。** Stage 2 = G13 休眠 spec（对话型 message kind + 保留类/TTL，"第三种墨水"）——设计已冻结（MessageRecord 合同骨架、SQLite v4 纯增表迁移、写入摊销 + 显式 sweep、零新错误码），纪律是"冻结设计而非排期；触发即按 spec 实施、无需重新设计"（docs/17:769）。不存在 Stage 2 的时间承诺。

**HOST_CONTRACT_VERSION：不存在向 2 演进的既定计划。** 现值 1（`packages/core/src/host.ts:18`），自 G18 交付起未 bump；bump 机制是需求拉动——"仅宿主可见合同语义变化（port 形状/语义、宿主可见错误族承诺、宿主侧构造面默认值）时 bump，每次 bump 在 docs/13 §8 与 docs/18 记录修订"（`docs/13-ordarium-action-contract.md:271`）。可预见候选核查：G13（零新错误码、纯增账本方法面）、G14（core 增量仅 `OperatorAuthorization` scope union 扩展，属运维授权面）、G17（明文"零合同面变更"）——按现行 scope 定义均**不构成 bump 事由**；最终判定在变更落地时按纪律作出并双向披露。

**对贵方的实操含义**：`assertHostContract(1)` 字面量握手无需预改。若未来发生 bump：exact-match fail-closed 意味着不会静默漂移——mismatch 抛 `HOST_CONTRACT_MISMATCH`，消息自带 expected/actual 与 docs/18 对齐指引；release notes 五类清单（新错误码类目）会同步披露。贵方 P1 握手本身即是监测点。

## 4. 命题二判据复核（docs/17 §16.9，`f1b62d4` 已登记）

**判据①（≥2 非自建宿主真实共账）——关闭依据与贵方登记一致。** 逐点对照：

| 项 | 贵方 r8（07:147） | 本侧登记（docs/17:792 + `docs/research/vision-realization-2026-08.md:19`） | 一致 |
|---|---|---|---|
| 载体 | PLMP-CONF-1：装配期 `assertHostContract(1)` 字面量握手、hostPort 全直通映射、四场景全过（36 文件/205 测试，CONF-A01–A04） | P1 装配期握手（fail-closed）/P2 port 显式成面（hostPort 直通，DSH 镜像零涉及）/P3 四场景 runner 对 scratch 账本全过/P4 scratch 纪律机器断言/P6 登记 r8；P5 明示可选未启用 | ✓ |
| 依赖 | 1.2.0 四行 pin（core/ledger-sqlite/host-kit/testing）四层一致 | 同（1.2.0 四行 pin 四层一致，CONF-A01–A04 全绿 + parity 硬门保持） | ✓ |
| 复核 | ——（贵方为交付方） | 2026-09-06 姊妹侧只读复检 + 本侧轻核证（`f1b62d4` commit message） | ✓ |

本侧闭合三证据源：docs/17 §16.9 表行（:792）、vision-realization §2/§6（:19、:57，`f1b62d4` 更新）、2026-09-06 会话裁决。命题二当前 2/5 交付（①④）、②已成文（注入式口径）、③⑤未发生。

**判据②（真实恢复案例成文）——当前状态：已成文（注入式口径）；生产首例待积。** 本侧登记（docs/17:793）："已成文（注入式口径；生产首例待积——姊妹侧 2026-09-06 复检确认生产账本尚未启用，无事件样本）"；闭合条件："生产环境首例真实恢复案例成文"；载体：贵方 SDS `03`（晋升合并 reconcilable、INV-09/10、P1 出口）+ `promotion.ts` 头注（Crash A/B 全协议）。

**预期触发路径**：贵方生产环境（真实用户负载）首次走到晋升合并 reconcile 路径并成文——即注入式成文（Crash A/B 全协议，已测试覆盖）之上的"生产首例"。该判据长在生产使用上，属外部牵引；本仓无代码待办（`f1b62d4`：production-first-case accumulation is criterion 2's own lane）。累积路径与判据③（conformance 外部使用者）同属"他者的使用"（vision-realization §6）。

## 5. 发布面复核（ordarium-v1.2.0）

| 核对项 | 结果 |
|---|---|
| tag | `ordarium-v1.2.0` → `eee2741`，**已推送 origin**（`git ls-remote --tags` 证实，对象 9ac1648/eee2741） |
| GitHub Release | published 2026-09-05T20:55:46Z，非 draft，target main |
| tarball | 六包恰等：`ordarium-{core,dsh,host_kit,host_mcp,ledger_sqlite,testing}-1.2.0.tgz`；工作区六包（core/dsh/host-kit/host-mcp/ledger-sqlite/testing）manifest 统一 1.2.0 |
| notes 五类清单（诉求①） | 齐全：①默认值"无"、②迁移"无"（schema 保持 v3）、③错误分类"无既有变化"、④新错误码 `HOST_CONTRACT_MISMATCH` + host-kit 新包面、⑤弃用面"无"——与 delta-G18-002 披露口径（④有、①②③⑤无）一致 |
| RCP 修订流水 vs `evidence/G18/delta-G18-002-release-line.md` | **一致**：RCP-2（docs/18:50）关闭 `COMPAT-PAL-001` 为已执行（G18，2026-08-29 交付）+ 确认文书指针；delta 决议 1 的发布线（tag + 六 tarball + notes 按 §1 五类披露）与实际发布面逐项吻合；notes 明文引用"docs/18 RCP-2、research/palimpsest-aln4-2-confirmation-2026-09-06.md" |
| 兼容登记 | 6 行，机器校验通过（G18 exit report A05："compatibility register: 6 entries verified"）；1.2.0 纯增交付**零新兼容层**（无 shim，符合两仓共守的无兼容层禁令）；`COMPAT-PAL-001` 已执行、`COMPAT-DSH-001` 随 `316b123` 更新指向 G8 item 6 双条件。**无新触发** |

**本侧观察项（内部整洁，非两仓冲突，列出备查）**：

1. **门数口径**：delta-G18-002 记"`verify:release --with-matrix` 七门（check / architecture / integration / conformance / docs / package / node-matrix）全绿"；公开 release notes 记"Six release gates green"（六门）；贵方 r8 记"六门 verify:release 绿"。`tools/verify-release.mjs:8-18` 证实基础六门 + `--with-matrix` 追加第七门。三处不矛盾（七门运行蕴含六门通过），但 delta 与 notes 表述不一——建议下次发布统一按实际执行口径表述。
2. **`COMPAT-LEDGER-001` 行未标"已执行"**（register:11）：其移除条件的事实面已满足——`LedgerCapabilities` 是现行合同（`packages/core/src/types.ts:207`，G11 能力门建于其上），旧"无能力描述 port 约定"已不在。待会话决议补标，本仓不因此影响任何消费面。
3. 确认文书 §2 P6 预测登记槽位"r4"，实际登记于 r8——预测漂移，无实质影响。

## 6. 两仓账目差异清单（显式回答）

对照贵方 r8/r9 全部登记与本侧账面（docs/17 §16.9/§16.10、docs/18、G18 evidence、vision-realization、确认文书）：

1. **[引用勘误，非冲突]** 来文任务 1b 依据"PLMP-CTX-1 §1 决策记录"——反馈原文实际在 **PLMP-TLM-1 §1**（08 号 :22）；CTX-1 无此记录。已按原文出处补记（G11 spec §10:160）。
2. **[口径差异，非冲突]** "六门"（贵方 r8 + 本侧 release notes）vs "七门 --with-matrix"（本侧 delta-G18-002）——见 §5 观察 1。
3. **其余全部一致**：判据①关闭依据逐点一致（§4 对照表）；1.2.0 发布面（tag/六包/notes）一致；诉求①已兑现（notes 五类清单）、②双双兑现（COMPAT-PAL-001 关闭 + RCP-2 + 确认文书）、③进行中（本侧补记动作本次闭环）；四行 pin；CONF-A01–A04；G13/G14 无唤醒迹象；refs 反查 0 触达；`dsh_types.ts` 镜像互不阻塞。
4. **待贵方酌情更新**：07 §6 诉求③行（:113）与 §2 第 7 项姿态列（:57"建议对侧 G11 文档补记"）——补记已落地（本报告 §1b），权威在贵侧，本仓不代改。

## 7. 本侧随本次复核落盘的修订

| 文件 | 修订 |
|---|---|
| `docs/research/agent-landscape-2026-08/05-palimpsest-charter.md` | 头部勘误行 + §4/唯一动作/§5.3 三处 dated 标注（§1a） |
| `evidence/G11/design-spec.md` | 新增 §10 冻结后补记（§1b；冻结文本与已否决项零改动） |
| `docs/17-ordarium-goals-and-acceptance.md` | §16.6 句末补记指针 |
| `docs/18-release-compat-policy.md` | 修订流水 RCP-3 |
| 本报告 | `docs/research/palimpsest-alignment-routine-review-2026-09-06.md` |

零代码变更、零包面变更、兼容登记零新触发、快照零漂移。
