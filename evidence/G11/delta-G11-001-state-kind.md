# Delta G11-001：管理型 state kind(一种时间线,三种墨水)

- 变更分类(docs/17 §7.2):**B 加法合同**(core 新类型/端口方法/错误码 +2、SQLite schema v2→v3 纯增表、testing 新 conformance、`/advanced` 新导出、`OperationListFilter.scope`)+ **D 边界变化**(docs/14 §5 存储条款修订,2026-08-29 会话决议)
- 依据:`evidence/G11/design-spec.md`(2026-08-29 会话决议冻结四项分叉)

## 目标结构与理由

1. **core**:`StateRef`/`StateRecord`/`StateRevisionPage`/`StateRecordPage`/`StateListFilter` 类型;`OperationLedger` 端口新增 `getState`/`compareAndSetState`/`stateHistory`/`listStatesReferencing`/`listStates`(必选方法,无 optional 逃生口);`LedgerCapabilities.stateRevisions`;`createStateStore` 门面(生命周期门 + 能力门 + 1 MiB 上限 + 引用存在性 fail-closed + CAS 冲突翻译);`decodeStateRecord` 单一验证路径(valueDigest decode 期重导出);错误码 `STATE_REVISION_CONFLICT`、`STATE_REF_NOT_FOUND`(27→29);`OperationListFilter.scope`(预算即账本查询)。
2. **ledger-sqlite**:schema v3——`ordarium_state_revisions`(namespace/key/revision 主键)与 `ordarium_state_refs`(ref_kind+ref_id 反查表,FK 连修订表);v2→v3 纯增表事务迁移(无数据变换,v1→v3 重建路径复用同一 `#createStateTables`);五个 state 方法 SQL 实现与错误映射复用既有基建族。
3. **testing**:`runStateLedgerConformance(ledger)` 框架无关套件(CAS 链/历史分页/refs 反查/派生视图/能力声明),MemoryLedger(testing 包)与 SqliteLedger(ledger-sqlite 包,经 devDependency)共用。
4. **dsh**:`createStateStore` + state 类型经 `/advanced` re-export;**root façade 19 curated 零漂移**;exports.test advanced 集 + root 禁止清单同步;插件壳与 host-mcp 零改动。
5. **身份推导细化**:state subject 为宿主声明地址(非内容寻址——可变槽位),时间线关联由每次修订记录的写者 `InvocationIdentity`(callId/rootCallId/lineage)承载;state 引用 id 语法 `namespace/key@revision` 受 subject 字符集约束保证可解析。

## 影响面

public API(core 端口/类型/错误码、dsh /advanced)、record schema(SQLite v3)、语义(state kind 新合同)、宿主映射(docs/14 §5 存储条款);无 Provider capability 变化。

## 旧调用/旧数据的转换位置

唯一数据转换是 SQLite 打开边界的事务性前向迁移:v2 库首次打开时创建两张 state 表并 bump `user_version` 3,既有 operation 行逐字节不动;失败回滚完整 v2。v1→v3 重建路径沿用 G2 迁移,经 `#createStateTables` 产出同版 schema。代码侧无旧路径:端口新方法为必选实现,无 optional 兼容桩。

## 旧路径删除时点

不适用——纯加法;`sqlite-v2.json` 基线快照由 `sqlite-v3.json` 取代(基线校验器同步更新),旧文件随本 delta 一并删除。

## 证明测试

- core:`test/state.test.ts`(16 项)——codec 不变量(digest 重导出/subject 字符集/引用语法)、能力门、生命周期门、上限、refs fail-closed、CAS 竞态与冲突文案、历史分页、反查分页、namespace 过滤、scope 过滤(G11-A01/02/03/04/06/07/10);
- ledger-sqlite:`test/state.test.ts`(8 项)——v3 schema、v2→v3 迁移逐字节保留、CAS、refs 反查、分页、scope 过滤 + conformance 套件(G11-A09/A11);
- testing:`test/state-ledger-conformance.test.ts`(MemoryLedger 全套件,G11-A09);
- dsh:`test/exports.test.ts`(advanced 集 + root 禁止清单,G11-A08);
- 基线:`tools/verify-architecture.mjs` user_version=3 + state 表入基线转储(G11-A05 由共享基建错误族覆盖,无 state 专用分支——与"差异不在并发/基建机制上"一致)。
