# G17 Design Spec:操作间依赖图原语(冻结·休眠)

> 依据:`docs/research/agent-landscape-2026-08/02-ordarium-position.md` §3(内核洞察"撤销即新事件")与 §4(语义缺口:操作间依赖图——"要么加原语,要么把拒绝写进合同"的第三条路:冻结休眠 spec)、`docs/17` §16.9 实现阶梯、G11 state 合同(`packages/core/src/state.ts`:namespace/key/revision CAS/value/refs、`listReferencing` 反查、`assertRefsExist` 前置校验)。
> 性质:**休眠 Goal——冻结设计而非排期**。触发条件:任一宿主(含姊妹仓 Palimpsest)在真实消费中需要(a)跨操作依赖审计(派生/绑定关系反查)或(b)级联失效/撤销协议的标准化("撤销即新事件");Palimpsest 失效传播从自建 evidence graph 迁移到内核 refs 即天然触发源(宪章组合契约:"计划修订引用 operations 作为证据基础,版本失效沿引用传播失效")。
> 2026-08-29 会话决议:冻结休眠 spec(否决"合同显式拒绝"——拒绝关门,失去触发即实施的能力;否决"暂不挂账"——档案遗留项悬而未决)。数据模型取**边即管理型 state record**(零合同面变更);**一等依赖端口**列为已否决项,升级判据见 §5——若触发,按本 spec 实施而非重新设计。

## 1. 合同骨架

- **零内核合同面变更**:依赖边不是新 record kind、不是新 port 方法、不是新 schema、零新错误码。边 = 管理型 state record(G11),落在保留命名空间——G11 的 refs 一等 + 反向查询 + 乐观 CAS 单原语本就是为"组合语义住 state 层"而设,本原语是该决议的首个约定级消费者。
- **保留命名空间**:`ordarium.deps.v1`。前缀 `ordarium.` 为内核/约定保留,宿主 state namespace 不得占用(保留规则随本 spec 冻结,docs/dev/11 增补)。
- **边形状**(约定,conformance 承重):每个 dependent(后继操作)一条 record——`key` = dependent operationId;`refs` = prerequisites(前置操作)的 StateRef 数组(复用既有 codec,不新发明);`value` = 对象且必含 `edgeKind`(非空字符串,如 `"derived-from"` / `"evidence-for"` / `"supersedes"`),其余字段自由。方向语义:"该操作依赖什么" = `get(ns, dependentOpId)`;"什么依赖该操作" = `listReferencing(该 operation 的 ref)`——反查白得。
- **边生命周期**:依赖集变化 = state revision CAS 修订(`STATE_REVISION_CONFLICT` fail-closed,复用);边撤除 = 新修订 `value.revoked: true`(append-only 语义,反查方按最新修订解释),不引入删除方法。
- **级联撤销协议("撤销即新事件")**:内核**只计算不执行**。触发后新增 core 纯函数助手 `planDependencyCascade`(输入:账本读取面 + root StateRef 集 + `{ cyclePolicy: "reject" | "allow" }`,默认 reject):输出 result union——`{ ok: true, plan }`(按拓扑序排列的逐节点动作清单,动作 = 宿主侧"写终态 operation 事件 / 写 state 修订"的**描述**,非执行指令)或 `{ ok: false, reason: "cycle", cyclePath }`。宿主按 plan 自行写入;助手零写副作用、不调度、不重试。
- **conformance**:testing 新增 `runDependencyConformance`,约定承重:保留命名空间拒宿主占用、边形状 codec、反查对称性(写边后 listReferencing 必见)、修订 CAS 语义、`revoked` 解释唯一性。双账本实现(runOperationLedgerConformance 同模式)。

## 2. 边界规则

1. 引擎不执行:级联计划是纯函数输出,写入动作永远属于宿主;内核不得按边存在而触发任何行为(宪章禁止令:Ordarium 不得伸手编排)。
2. 边是审计拓扑,不是调度邻接表:边的存在不授予执行权、不进入 operation 状态机、不参与恢复判定。
3. `ordarium.` 前缀保留;`ordarium.deps.v1` 的 value/refs 形状由 codec 复用 + conformance 承重,不进 `contracts.json`(state value 是 JsonValue,不在 operation codec 冻结面)。
4. 零错误码新增:`STATE_REVISION_CONFLICT`/`STATE_REF_NOT_FOUND` 复用;环拒绝是助手返回值(result union),不走抛错路径。
5. root façade 预期漂移仅限:助手导出 +1(core 声明面),curated 表同步——切片内写明,快照漂移不得越界。

## 3. 验收矩阵

| ID | 场景 | 通过条件 |
|---|---|---|
| G17-A01 | 约定 conformance | 保留 ns 拒宿主占用;边形状全过;反查对称;修订 CAS 与 `revoked` 语义双实现一致 |
| G17-A02 | 级联计划纯度 | 任意输入零写副作用(plan-only);reject 模式给出完整环路径;allow 模式按拓扑序输出且不重复计节点 |
| G17-A03 | 宿主执行协议 | 按 plan 逐节点写入后,重跑 `planDependencyCascade` 输出空计划(幂等由"计划从当前账本态重导出"保证);中途失败留痕可续 |
| G17-A04 | 表面治理 | 错误码零新增;兼容登记零新增;快照漂移仅限 §2.5 声明面;root façade curated 同步 |

## 4. 实现切片

- G17-001:core——保留 ns 常量 + `planDependencyCascade` 纯函数(唯一 core 增量);
- G17-002:testing——`runDependencyConformance`(G17-A01);
- G17-003:docs——docs/dev/11 增补(约定指南 + 保留 ns 规则)、docs/17 归位(§16.8 解除休眠记录);
- G17-004:delta + snapshots + exit + 全门绿 + 提交。

## 5. 承袭披露与非目标

- 已否决:**一等依赖端口**(OperationLedger 新方法 + SQLite v4 依赖表 + `DEPENDENCY_CYCLE` 写路径拒环)——为零需求方设计付 v4 迁移全价,且边进入写路径语义后距"引擎按边执行"仅半步,宪章禁止令高压区;**边作为 operation record kind**——关系不是副作用,类别混淆;**内核执行级联**——编排化,违宪章。
- 升级判据(不自动升级,须新 spec 重新决议):宿主真实需要**写路径引擎校验**的 DAG 不变量(如环拒绝成为合同而非助手语义)或专用索引性能面(反查在当前规模劣化)。
- 非目标:执行调度、跨账本/远程边、边上的授权语义、知识层建模(学习状态)——知识层由 G11 state 各 namespace 自行承载,不设全局原语。
