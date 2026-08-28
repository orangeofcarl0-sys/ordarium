# G12 Design Spec:共账拓扑并发压测(冻结)

> 依据:`docs/research/agent-landscape-2026-08/02-ordarium-position.md` §4 命题二证伪判据④("swarm 并发压测数据")与 §3 宿主模式三("单写者天花板")。2026-08-29 会话决议:G12 为 evidence-only Goal。
> 性质:验收后追加 Goal;**零包变更**(不动 public API / record schema / 语义 / 宿主映射 / Provider capability)——无 Architecture Delta Sheet,机器门零漂移为验收项之一。

## 1. 问题

共账拓扑(多 agent/多进程共享同一 SQLite 账本)的两个核心承诺在真实多进程竞争下没有数字:

1. **revision CAS 的原子性**:N 个进程对同一 subject 做 read-modify-CAS 热争用时,修订链必须无丢失更新(最终 revision == 全部成功 CAS 之和,无空洞、无双写);
2. **单写者天花板的刻度**:吞吐/延迟/冲突率随进程数 K 如何退化——这是"极限规模 → 分片/排队属 v2"的触发刻度,也是宿主选型(deploymentCoordination 声明)的量化依据。

## 2. 方法

工具:`tools/stress-matrix.mjs`(父进程)+ `tools/stress-worker.mjs`(工作进程);二者仅依赖构建产物 `packages/*/dist`,与 verify-architecture 同款导入方式。运行前提:`pnpm build`。

- **矩阵**:K ∈ {1, 2, 4, 8} × 模式 {state-shared, state-own, ops-lifecycle} × 每腿 4000ms;每腿新建一次性 SQLite 文件(WAL、local-multi-process),跑完即删。
- **state-shared(最大争用)**:全部 K 个进程对同一 subject(`stress/shared`)做 read-modify-CAS 热循环;失败(CAS false)计入冲突并立即重读重试。
- **state-own(无争用基线)**:每进程写自己的 subject(`stress/own-<id>`),同循环零冲突。
- **ops-lifecycle(端口全路径基线)**:每迭代 create(proposed)→ claim(含 lease)→ CAS 至 succeeded;operationId 每次独立,度量账本全路径成本。
- **采集**:每工作进程回报 attempts/successes/conflicts + 成功写延迟 p50/p95/p99/max(hrtime);父进程聚合为吞吐(成功写/s)与冲突率。

## 3. 验收

| ID | 场景 | 通过条件 |
|---|---|---|
| G12-A01 | 修订链无丢失更新 | state-shared 腿终态:最终 revision == Σ工作进程成功数(逐 K 全部成立) |
| G12-A02 | state-own 一致性 | 各 own subject 的 revision == 对应工作进程成功数 |
| G12-A03 | 压测数据表 | K=1..8 三模式吞吐/冲突率/延迟分位数成表并落 `stress-results.json` |
| G12-A04 | ops-lifecycle 闭环 | succeeded 记录数 == Σ成功数,抽样记录经 codec 复验通过 |
| G12-A05 | 冲突诚实性 | 冲突一律体现为稳定错误/CAS false,无部分写入、无静默重试语义变化 |

## 4. 非目标

不调优、不引入分片/排队(那是数据触发的 v2);不压 host-mcp/DSH 面(账本层即判据所在);不做 Node 版本矩阵(engines 未变,`verify:matrix` 另行);不修改任何包。
