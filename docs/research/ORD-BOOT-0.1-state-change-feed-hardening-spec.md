# ORD-BOOT-0.1 规范：StateChangeFeed 边界安全加固

> **冻结设计**（2026-09-11）。本文是 ORD-BOOT-0.1 的规范载体，**supersedes**（取代）ORD-BOOT-0 规范中被本批收窄的条款：
>
> ```text
> ORD-BOOT-0.1 supersedes ORD-BOOT-0 §5 future-cursor behavior
> ORD-BOOT-0.1 supersedes ORD-BOOT-0 §7 allowed limit domain
> ```
>
> 其余 ORD-BOOT-0 条款继续有效。历史 1.3.0 语义保留于 [`ORD-BOOT-0-state-change-feed-spec.md`](ORD-BOOT-0-state-change-feed-spec.md)（未改写）+ [`ORD-BOOT-0.1-state-change-feed-hardening-assessment.md`](ORD-BOOT-0.1-state-change-feed-hardening-assessment.md)。与 docs/12–18 冲突时以 12–18 为准。

## 1. 目的

在已发布的 `StateChangeFeed` 上做最小边界加固，使观测原语在资源与 cursor 边界上**安全失败**：

$$
\boxed{NoLivelock + NoSilentFutureStarvation + BoundedResourceUse}
$$

不改 schema（保持 v4）、不改一真值架构、不加 agent 语义、不做阻塞等待/consumer offsets/federation。

## 2. 页大小域（limit domain）

- 缺省 `limit` → 默认页 100（不变）。
- 显式 `limit` 必须满足：

$$
\boxed{1 \le limit \le RESOURCE\_LIMITS.maxStateChangePageItems}
$$

- 违反（`0` / 负 / 小数 / 非 safe integer / `> MAX`）→ `TypeError`。
- **`limit=0` 无特殊语义**，直接拒绝：`limit=0 ∧ matchingChangeExists ⇒ CursorDoesNotAdvance ∧ hasMore=true` 是确定性活锁（SCF-INV-8）。
- 单资源真值 = core `RESOURCE_LIMITS.maxStateChangePageItems = 1000`（默认 100 的 10× 包络；单项 payload 仍受 `maxStateValueJsonBytes` 1 MiB 独立约束）。两 ledger 共同引用，不散落魔数。

## 3. 未来 cursor 语义（future cursor）

定义 `currentHighWater` = 账本当前已知的最高 state change 位置；空 feed 为 `0`。

$$
\boxed{CursorPosition > CurrentLedgerHighWater \Rightarrow InvalidCursorError\ (INVALID\_CURSOR)}
$$

- 空库：`cursor=0` 合法，`cursor=1` 非法。
- `highWater=17`：合法 `0..17`，非法 `18+`。
- 校验在**语法解析之后**独立进行（两级：语法合法性 + 对本账本的语义合法性）；不削弱既有畸形 cursor 行为。
- 目的：未来的本地位置**绝不**被静默当作"已追平"，防止库还原/重建/替换/ cursor 损坏导致两个自治进程互相停止观测（SCF-INV-9）。

## 4. 高水位与并发（§17 审计结论）

`changes()` 读路径 = 两条读查询（读全局 high-water → 校验 cursor → 取页）；不需要一致快照、不引入写侧锁：

- 正常并发下 high-water 只增不减（`AUTOINCREMENT` 不复用），校验后若有新提交，被校验的 `cursor ≤ 旧 highWater ≤ 新 highWater` 仍合法 → **不误拒正常消费者**。
- 只有库被还原/替换使 high-water 下降时旧 cursor 才被拒——正是期望探测。
- 故校验是保守 fail-closed：宁可拒绝疑似失效位置，绝不静默当作已追平。

## 5. 全局 / filter-independent cursor（不变）

cursor 仍是全局位置，未来 cursor 校验对比**全局** high-water，**不**对比请求 namespace 的局部最大值。例：全局 max=100、alpha max=40，`changes({namespace:"alpha"}, cursor=80)` 合法（可能空页），此后 alpha 的 `change_seq=101` 仍可观测。cursor 不绑定 namespace / filter / page limit。跨 filter 复用同一 cursor 的语义保持不变（ORD-BOOT-0 approach A）。

## 6. caught-up 语义（不变）

真正追平的 cursor 仍合法：`highWater=N, cursor=N` → `{changes:[], cursor:<N>, hasMore:false}`；随后提交 `N+1`，同一 cursor 可观测之。不破坏 ORD-BOOT-0 SCF-A03/SCF-B07。

## 7. 资源边界（SCF-INV-10）

$$
1 \le PageLimit \le MaxFeedPageItems
$$

显式分页请求保持在文档化资源包络内。查询形状与索引不变（`WHERE change_seq > ? [AND namespace = ?] ORDER BY change_seq ASC LIMIT ?`；无 filter 走主键 B-tree，带 filter 走 `ordarium_state_changes_ns_idx`）。

## 8. durability 措辞（Memory vs SQLite）

"durable cursor" 的持久性**继承 ledger 声明的 durability**：

- `SqliteLedger` = `crash-durable` / `local-multi-process` → cursor 跨进程重启与 reopen 有效。
- `MemoryLedger` = `volatile` / `single-isolate` → cursor 仅进程内有效，**不**声称跨进程重启存活。

两实现的 `limit` 校验、未来 cursor 校验、filter 语义、caught-up 行为必须一致（parity），差异只在 durability 声明。

## 9. 已知局限（不得过度声称）

高水位校验捕获 "旧 cursor=500 / 还原后 max=100"，但**不能**捕获 "cursor 来自库 A=20 / 库 B max=100"（`20 <= 100`）。本批**不含** ledger UUID / database epoch / cursor 数据库身份绑定：

$$
\boxed{LedgerIdentityBinding = DEFER}
$$

（已审计：当前无零架构代价可复用的通用身份原语；不为该残余理论情形新增 schema v5。）首个 Palimpsest bootstrap 消费者使用固定协调库配置。这是**已知局限，不是实现失败**。

## 10. 兼容与发布分类

- schema 保持 **v4**：不改 `ordarium_state_changes` / `change_seq` / AUTOINCREMENT / FK / UNIQUE(namespace,key,revision)，无迁移。
- `StateChangeFeed` 仍是加法能力，`OperationLedger` 源兼容；能力门 `LedgerCapabilities.stateChangeFeed?` + `supportsStateChangeFeed` 不变。
- `HOST_CONTRACT_VERSION` 保持 **1**（HostInvocationPort / 宿主握手未变）。
- 包版本 **1.3.0 → 1.3.1（patch）**：无 schema 迁移、无默认值变化、无新错误码、无 API 形状变化、无弃用面；`INVALID_CURSOR` 含义（"不是合法持久位置"）未变，仅触发域扩展；被拒输入（`limit=0`、未来位置）为退化/危险输入，无正确消费者依赖。逐类清单见 [`ORD-BOOT-0.1-delivery-report.md`](ORD-BOOT-0.1-delivery-report.md) §2。

## 11. 冻结不变量

SCF-INV-8 进度安全页大小 · SCF-INV-9 无未来位置 · SCF-INV-10 资源有界观测；与 ORD-BOOT-0 的 SCF-INV-1..7 并存。登记见 docs/17 §16.12。
