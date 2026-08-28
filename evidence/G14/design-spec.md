# G14 Design Spec:管理型 state 的运维面(冻结·休眠)

> 依据:`evidence/G11/design-spec.md` §2(发布面先例与"host-mcp 工具面需求拉动"遗留项)、`evidence/G9/design-spec.md`(ops 面模式:opt-in、构造期注入、脱敏模型视图)、docs/dev/07。
> 性质:**休眠 Goal——冻结设计而非排期**。触发条件:操作者/运维需要跨宿主查看管理型 state(当前意图、修订历史、引用),或在 Palimpsest 复兴时随取证需要一并落地。
> 2026-08-29 会话决议:**模型工具 + 独立 scope**——`ordarium_state_list` / `ordarium_state_history` 两个工具,opt-in 注入新 scope `"operations:state"`;模型见脱敏视图(无 value 全文);operator 全文走 `plugin.ops.state`。
> 已否决项:并入既有 scope `"operations"`(违背最小授权——读 state 的权限不应与读 operations 捆绑);仅进程内 API(运维面"可见性"价值打折);模型可读 value 全文。

## 1. 合同骨架

- **core 最小增量(B 类加法)**:`OperatorAuthorization.scope` union 由 `"operations" | "operations:reconcile"` 扩为 `"operations" | "operations:reconcile" | "operations:state"`;`assertOperatorAuthorization` 增加 `"operations:state"` required 档。`OrdariumOperations` 合同零改动——state 读取经壳内 `createStateStore` 构造,不另起第二读取面。
- **插件壳 opt-in(G9 模式镜像)**:`OrdariumPluginOptions.state?: { authorization: OperatorAuthorization }`;构造期 `assertOperatorAuthorization(authorization, "operations:state")`——伪造/缺失在任何工具注册前失败。未提供时:两个工具不注册、`plugin.ops.state` 为 `undefined`(docs/17 §12.2 "默认不暴露"的插件层落实)。
- **operator 审计视图**:`plugin.ops.state = { list(filter, cursor), history(namespace, key, cursor, limit), listReferencing(ref, cursor, limit) }`——含 value 全文与完整 identity 的 state 记录,宿主命令消费。
- **脱敏模型视图**(`StateModelView`,恰等白名单):`{ namespace, key, revision, valueDigest, writtenAt, senderPreview }`;`senderPreview = { source, scope }`——不含 value 全文、actor、lineage、refs 全文。**不提供 `ordarium_state_get`**:值全文对模型不可见,operator 走 `plugin.ops.state`。

| 工具名 | 输入 | 输出 | 权限 |
|---|---|---|---|
| `ordarium_state_list` | `{ namespace?, limit?, cursor? }` | `{ subjects: StateModelView[], nextCursor? }` | operations:state |
| `ordarium_state_history` | `{ namespace, key, limit?, cursor? }` | `{ revisions: { revision, valueDigest, writtenAt, senderPreview }[], nextCursor? }` | operations:state |

- **host-mcp 对齐**(G9 audit 模式):opt-in 后 `tools/call` 分发两工具,同一 projector;未 opt-in 不在 tools/list。

## 2. 边界规则

1. 独立授权面:`"operations"` scope 的授权**不能**读 state(机器断言);反之亦然;`"operations:reconcile"` 不含 state 读。
2. 模型只见脱敏视图——value 全文、完整 sender 溯源与 refs 仅 operator 视图;state 的 valueDigest 可验不可读。
3. 壳仍是唯一受信注入点:授权由宿主命令/受信配置构造传入,工具输入无法伪造(G4 边界)。
4. dispose 复用 G3/G9 字面序;state 工具随 state opt-in 注册/注销,与 ops 工具互不影响。
5. root façade 零漂移;错误码零新增(`OPERATOR_AUTHORIZATION_REQUIRED` 复用)。

## 3. 验收矩阵

| ID | 场景 | 通过条件 |
|---|---|---|
| G14-A01 | 默认缺席 | 无 `state` 选项:registry 无 `ordarium_state_*`、`plugin.ops.state` undefined |
| G14-A02 | 构造期授权门 | 伪造/缺失/错 scope(含 `"operations"` scope 试图读 state)→ `OPERATOR_AUTHORIZATION_REQUIRED`,零读取副作用 |
| G14-A03 | 注册与脱敏 | opt-in 后两工具就位;输出为 StateModelView 白名单恰等(无 value 全文) |
| G14-A04 | operator 全文 | `plugin.ops.state.*` 返回完整记录与 identity;分页恰确 |
| G14-A05 | host-mcp 对齐 | opt-in 后 tools/call 分发脱敏视图;未 opt-in 不在 tools/list |
| G14-A06 | 表面治理 | root façade 19 curated 零漂移;exports.test 覆盖;快照冻结 |

## 4. 实现切片

- G14-001:core——scope union 扩展 + 校验档(唯一 core 改动);
- G14-002:dsh 壳——state opt-in、两工具注册、`plugin.ops.state`、tests(G14-A01–A04、A06);
- G14-003:host-mcp——两工具分发对齐(G14-A05);
- G14-004:docs——docs/dev/07 增补、docs/17 归位;
- G14-005:delta + snapshots + exit + 全门绿 + 提交。

## 5. 承袭披露与非目标

- G13 落地后若需要 message 取证工具,按本 spec 模式另立决议(scope 建议复用 `"operations:state"` 或新增,届时定)。
- 非目标:state 写入工具(运维面永远只读 + reconcile 语义,写走门面)、跨 namespace 聚合视图、模型可读 value。
