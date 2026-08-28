# G13 Design Spec:对话型 message kind 与保留类——第三种墨水(冻结·休眠)

> 依据:`docs/research/agent-landscape-2026-08/03-ledger-taxonomy.md` §1/§4/§5(Stage 2、保留类为唯一新内核语义、准入门)、docs/13 §11(kind 契约分立先例)、docs/15 §28。
> 性质:**休眠 Goal——本 spec 冻结设计而非排期**。触发条件:任一真实(非演示/非测试夹具)宿主,或 Palimpsest 复兴,提出"谁在合成/决策前对谁说了什么"的取证需求。触发即按本 spec 实施,无需重新设计;若触发时 docs/12–17 已漂移,以现行版为准逐条重核。
> 2026-08-29 会话决议:① 正文边界 = **元数据 + 可选正文**(write 显式携带才落账,默认仅摘要,正文上限 64KB,敏感内容入账的责任在宿主);② 淘汰 = **写入摊销 + 显式 sweep**,无定时器无后台任务,物理删除,"取证缺页"为文档化代价。
> 已否决项:订阅/推送/路由(账本≠总线,一根手指都不伸);正文全文必存;淘汰原语全交宿主(保留类是内核语义);后台定时器/daemon;读时过滤+延迟物理删除;message→message 引用与跨 kind 反查(v1 不做,需求拉动)。

## 1. 合同骨架

```ts
// core/types.ts(草案;命名与字段细节以实施快照为准)
export interface MessageRecord {
  schemaVersion: 1;
  namespace: string;             // 宿主声明分区(复用 state 的 subject 命名语法)
  channel: string;               // 宿主声明的会话/主题键
  seq: number;                   // 每 (namespace, channel) 单调,由账本在写入事务内原子分配,首条 = 1
  sender: InvocationIdentity;    // 写门槛 = 任何有身份的 agent;溯源即时间线成链
  audience: string[];            // 宿主词汇表的接收方标识(≤16 项);[] = 私有备忘
  bodyDigest: string;            // 恒等于 digestJson(body ?? null),decode 期重导出
  body?: JsonValue | undefined;  // 可选正文(决议①),canonical JSON ≤ 64KB
  refs: StateRef[];              // 复用 state 引用类型(operation/state),写入期存在性校验
  expiresAt?: string | undefined; // 保留类:门面按策略盖章;缺省 = 永不过期
  writtenAt: string;
}
```

- **准入门复核**:seq 由账本在写入事务内原子分配,与 operation events 的 `(operation_id, semantic_revision)` 事务内编号**同一机制类**——零新增仲裁原语(无锁/无租约/无 CAS),过 03§5 门。并发 append 的次序 = 进入写事务的物理次序,调用方从返回值取得 seq;失败不产生空洞。
- **读法**:频道线程序升序分页(opaque cursor,同款载荷 `{s: seq}`)+ `latestMessageSeq` 尾读窥视(0 = 空)。读面**不做过期过滤**(决议②:物理删除,读面永远如实反映账本现存内容)。
- **零新增错误码**:append 永不冲突;body 超限复用 `PERSISTED_VALUE_TOO_LARGE`;基建族复用 `LEDGER_*`。淘汰即优雅降级,永不因配额拒绝写入——失败不对称性就此闭环:对话型先淘汰,证据型/管理型受 `LEDGER_FULL` fail-closed 永不淘汰。

## 2. 端口、门面与保留类

- `LedgerCapabilities.messageTimeline: boolean`;端口新增:`appendMessage(namespace, channel, message: MessageAppend): Promise<MessageRecord>`、`listMessages(namespace, channel, cursor?, limit?)`、`latestMessageSeq(namespace, channel): Promise<number>`、`sweepMessages(namespace: string | undefined, now: string): Promise<{ evicted: number }>`。MemoryLedger / SqliteLedger 同步实现,均为必选成员(无 optional 逃生口)。
- `createMessageStore({ runtime | ledger, retention?, clock? })`(core;`/advanced` re-export;root façade 零漂移;host-mcp 不动):
  - 保留策略(内核持有语义,宿主持有配置):`MessageRetentionPolicy { ttlMs?, namespaceTtlMs?: Record<string, number>, channelMaxEntries? }`;门面 append 时按策略盖章 `expiresAt`(clock + ttl)并计算 `bodyDigest`。
  - **写入摊销**:append 落账后顺手清除本频道过期项与本频道超配额最老项(有界工作量);
  - **显式 sweep**:`sweep(namespace | undefined)` 对作用域内执行 TTL 清扫(expires_at 索引)与配额 enforcement(按频道计数,成本 O(频道数),已文档化);
  - 生命周期与能力门:与 createStateStore 同款(quiescing/closed 门、`LEDGER_CAPABILITY_REQUIRED` fail-closed)。
- SQLite v4:`ordarium_messages(namespace, channel, seq, body_digest, expires_at, written_at, record_json, PRIMARY KEY(namespace, channel, seq)) STRICT` + `expires_at` 索引;**v3→v4 纯增表事务迁移**,既有行逐字节不动,失败回滚完整 v3。
- 边界重述:账本≠总线——传输/路由/订阅留宿主;内核只在宿主要求时把通信事件落时间线;不解释 audience 语义;淘汰物理 DELETE,缺页即序号空洞,由宿主 transcript 侧补原文(决议①的正文边界使然)。

## 3. 验收矩阵

| ID | 场景 | 通过条件 |
|---|---|---|
| G13-A01 | 并发线程序 | K 进程并发 append 同 channel:seq 连续无空洞,最终 seq == Σ成功数 |
| G13-A02 | 分页与尾读 | listMessages 升序 opaque cursor 分页;latestMessageSeq 恰确 |
| G13-A03 | TTL 淘汰 | ManualClock 推进后,append 摊销与显式 sweep 均清除过期项,证据型/管理型零触碰 |
| G13-A04 | 配额 | 超配额逐出最老项,**写入永不因配额失败** |
| G13-A05 | 正文边界 | body > 64KB → `PERSISTED_VALUE_TOO_LARGE`;缺省 body 的 digest 不变量成立;decode 重导出失败落 `LEDGER_CORRUPT` |
| G13-A06 | refs | 悬空引用 append → fail-closed 拒绝 |
| G13-A07 | 门 | messageTimeline: false 写入前 `LEDGER_CAPABILITY_REQUIRED`;quiesce/closed 门生效 |
| G13-A08 | 迁移与治理 | v3→v4 迁移逐字节保留;`runMessageLedgerConformance` 对 Memory/Sqlite 全绿;root façade 零漂移;快照冻结 |

## 4. 实现切片

- G13-001:core——types / 端口四方法 / capabilities / codec(decodeMessageRecord) / createMessageStore / MemoryLedger;
- G13-002:ledger-sqlite——v4 schema、v3→v4 纯增表迁移、消息方法与淘汰 SQL;
- G13-003:testing——`runMessageLedgerConformance`(双实现接入);
- G13-004:dsh——/advanced re-export + exports.test;
- G13-005:docs——docs/13 §13、docs/15 §29、docs/17 归位、dev/06 三墨水表更新、dev/12 新章;
- G13-006:delta + snapshots + exit + 全门绿 + 提交。

## 5. 承袭披露与非目标

- 取证工具面(ordarium_messages 等)不在本 Goal——host-mcp/插件壳的消息取证面随真实取证需求另行决议(可与 G14 模式合并考虑)。
- 非目标:订阅/推送、跨 kind 反查索引、message→message 引用、读时过滤、保留策略热更新、全局配额(按 namespace 总量)。
