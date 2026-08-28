# G15 Design Spec:组合分片账本——单写者天花板之后的规模线(冻结·休眠)

> 依据:`evidence/G12/stress-report.md` §3(天花板刻度:本机口径 ~1400 成功写/s,代价集中在尾延迟)、`docs/research/agent-landscape-2026-08/02-ordarium-position.md` §3 宿主模式三、docs/15 §18("不做独立 daemon 或默认控制平面")。
> 性质:**休眠 Goal——冻结设计而非排期**。触发条件:目标负载**持续**超过目标环境重测的单写者天花板(G12 口径,换环境须复测),或 p99 尾延迟对宿主不可接受;且负载可按主键分片。触发即实施;规模参数(shard 数)属运行时配置,不冻本 spec。
> 推演否决(2026-08-29 会话):**排队/写者汇聚方案被否决**——跨进程排队必然引入 IPC 或写者守护进程,撞 docs/15 §18 "不做独立 daemon 或默认控制平面"红线;进程内排队无意义(单进程调用本就串行)。**分片是唯一边界兼容的规模线**。
> 已否决项:写者汇聚进程、自动 rebalance、跨分片事务、跨分片查询语言、按负载动态迁移。

## 1. 形状

- **新叶包 `@ordarium/ledger-sharded`**(叶规则:workspace deps = `["@ordarium/core"]`;verify-architecture 的 expectedPackages / leafPackageRules 增补;发布面五→六 tarball,`package-consumer` / README 安装命令同步)。组合账本是 ledger 实现关注点,不进 core、不进既有包。
- **构造**:`createShardedLedger({ shards: OperationLedger[], route?: RouteFn })`;默认路由 `defaultRoute` = 对路由键取 SHA-256 模 shards.length(确定性、免配置、跨进程一致)。路由键(即原子域):
  - operation 方法(get/create/compareAndSet/claim/lease/renewLease/history):`operationId`;
  - state 方法(getState/compareAndSetState/stateHistory/listStatesReferencing):`(namespace, key)`;
  - message 方法(appendMessage/listMessages/latestMessageSeq/sweepMessages):`(namespace, channel)`;
  - **同一主键永落同一分片;跨分片不提供事务与原子性**(文档化合同,非实现缺陷)。
- **跨分片读取面**:`list` / `listStates` / `listMessages` 为 scatter-gather——每分片独立分页后按该面的统一排序键归并;合并游标 = 各分片游标的复合 opaque 编码(结构对调用方不透明)。排序键与单库合同一致(`updated_at+operationId` / `(namespace,key)` / `(namespace,channel,seq)`)。
- **能力诚实声明**:composite 的 `capabilities` = 各 shards 的最弱公共能力逐字段取交(durability 取弱、coordination 取弱、boolean 取 AND)。能力门照常——最弱分片决定 composite 的 managed 资格。
- **close()** 关全部分片;错误族如实上抛(单分片 `LEDGER_FULL`/`LEDGER_BUSY` 不被吞、不重试——组合层零策略)。

## 2. 边界规则

1. 组合层零策略:不做缓存、不合并写、不重试、不解释错误;它只是确定性的路由 + 归并。
2. conformance 即准入:composite 实例必须通过 `runStateLedgerConformance`(G13 落地后加 message 组)——通过即 conformant ledger,能力门与宿主合同照常,不新增组合专用 conformance 面。
3. 单库→分库是宿主动作(按路由键搬家);内核不做 rebalance/迁移工具。
4. 分片实例允许异构(如 sqlite + 未来实现),但 capabilities 取交后按最弱声明,宿主不得依赖更强能力。

## 3. 验收矩阵

| ID | 场景 | 通过条件 |
|---|---|---|
| G15-A01 | 路由确定性 | 同一路由键跨进程/跨次序恒落同一分片 |
| G15-A02 | 分片内不变量 | 每个 shard 实例单独跑 state(与 message)conformance 全绿 |
| G15-A03 | 归并正确性 | scatter-gather 的 list/listStates 结果集与"等价单库"结果集恰等(含分页) |
| G15-A04 | 能力最弱声明 | 混合 shards(一员缺能力)时 composite 声明与门行为 = 最弱 |
| G15-A05 | 错误穿透 | 单分片 `LEDGER_FULL`/`LEDGER_BUSY` 如实上抛,零吞噬零重试 |
| G15-A06 | 发布面治理 | 六 tarball 自洽(`test:package`)、graph/叶规则机器校验、root façade 零漂移、快照冻结 |

## 4. 实现切片

- G15-001:包骨架 + package.json + graph/叶规则 + 发布面(package-consumer/README 六 tarball);
- G15-002:composite 端口实现(路由/归并/能力交/close);
- G15-003:conformance 接入 + 测试(G15-A01–A05);
- G15-004:docs——docs/15 部署拓扑增补、docs/dev/06 分片章、docs/17 归位;
- G15-005:delta + snapshots + exit + 全门绿 + 提交。

## 5. 承袭披露与非目标

- 触发时的第一步是**在目标环境复测天花板**(复用 G12 harness),以数据确认触发成立——spec 冻结的是结构与合同,不是"应当分片"的结论。
- 非目标:rebalance/在线迁移、跨分片事务、一致性哈希(固定模路由足够,可后补)、按负载自动扩缩、跨分片引用反查优化(v1 全归并)。
