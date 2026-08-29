# G12 Stress Report:共账拓扑并发压测数据

> 依据:`evidence/G12/design-spec.md`(2026-08-29 冻结)。机器可读数据:`stress-results.json`;复现:`pnpm build && node tools/stress-matrix.mjs [--duration ms]`。
> 定位:判据④的**参考数据**,产出自单台开发机——不构成性能宣称;其价值在于不变量验证与退化形状,绝对数值仅供宿主选型量级参考。

## 1. 环境

| 项 | 值 |
|---|---|
| 平台 | win32 x64,24 逻辑核,Windows 10 (26200) |
| Node | v24.14.1(低于声明 floor `>=24.15.0`,engines 仅警告;ledger 全功能可用,见研究档案 04 §3 同款注记) |
| SQLite | node:sqlite 内置,WAL + synchronous FULL + busy_timeout 5s |
| 每腿时长 | 4000ms,一次性临时库,跑完即删 |

## 2. 数据表(12 腿全过,不变量零违反)

| mode | K | throughput/s | conflict % | p50 ms | p95 ms | p99 ms | max ms |
|---|---|---|---|---|---|---|---|
| state-shared | 1 | 1346.8 | 0 | 0.672 | 1.005 | 1.609 | 29.827 |
| state-shared | 2 | 1401.0 | 0.16 | 0.670 | 0.969 | 1.563 | 16.756 |
| state-shared | 4 | 1249.5 | 0.44 | 0.710 | 1.047 | 2.194 | 19.370 |
| state-shared | 8 | 1250.0 | 0.75 | 0.757 | 1.259 | 1.901 | 17.533 |
| state-own | 1 | 1409.8 | 0 | 0.658 | 0.890 | 1.435 | 19.474 |
| state-own | 2 | 1349.5 | 0 | 0.694 | 1.062 | 1.783 | 1649.451 |
| state-own | 4 | 1316.5 | 0 | 0.785 | 1.255 | 3718.663 | 4137.330 |
| state-own | 8 | 1326.3 | 0 | 0.712 | 1.101 | 111.362 | 3817.794 |
| ops-lifecycle | 1 | 417.0 | 0 | 2.195 | 2.803 | 7.770 | 30.793 |
| ops-lifecycle | 2 | 393.0 | 0 | 2.438 | 3.225 | 8.894 | 1745.654 |
| ops-lifecycle | 4 | 397.0 | 0 | 2.405 | 4.129 | 663.619 | 3620.490 |
| ops-lifecycle | 8 | 319.8 | 0 | 2.823 | 11.504 | 1866.049 | 4264.907 |

## 3. 解读

1. **单写者天花板得到刻度**:state 两模式的聚合吞吐在 K=1..8 全程钉在 **~1250–1400 成功写/s**——K 增大不带来吞吐增长(写路径被 SQLite 单写者串行化),但也不塌陷;~1400/s 即本机口径的天花板。ops-lifecycle 每迭代 = 3 次写 + 1 次读,~400 生命周期/s × 3 ≈ 1200 写/s,与天花板自洽。
2. **CAS 冲突率低且平稳**:最大争用(8 进程 read-modify-CAS 同一 subject)下冲突率仅 0.75%——WAL 单写者把 read-modify-CAS 的竞争窗口压得很小;冲突全部表现为 CAS false 或稳定错误,零静默语义。
3. **代价写在尾延迟上**:p50 几乎不随 K 变化(0.66→0.76ms),但 **p99/max 随 K 抬升至秒级**(最高 ~4.3s,逼近 busy_timeout 5s 上限)——锁排队挤压在尾部。这正是"吞吐不塌、尾巴变长"的单写者特征:**对延迟敏感的宿主应在低 K 下共账,或按 subject 分片(v2 的触发刻度由此而来)**。
4. **不变量(G12-A01/A02/A04)**:每个 K 下 state-shared 终态 revision == Σ成功数(无丢失更新)、各 own subject 一致、succeeded 记录数 == Σ成功数、抽样记录经 codec 复验通过——12 腿全绿。

## 4. 两条附带发现(harness 开发过程中的实证)

1. **打开竞态**:高 K 下,新进程在热写循环中 open 同一库,构造期的 `PRAGMA journal_mode=WAL` 可能撞写锁 → 构造器抛 `LEDGER_BUSY`(稳定错误码,fail-closed,零句柄)。语义正确,但**宿主应带退避重试 open**——harness 已内置(10 次 × 100ms);内核侧是否内置 open 重试是后续独立决议项(改动面:`SqliteLedger` 构造器,B 类)。
   **【G16 更新】**该决议项已落地:构造器默认内置有界退避(5 次 × 100ms,仅 BUSY),本发现所述场景由内核自行吸收;并发 open 赛跑实证见 `evidence/G16/open-race-results.json`(4 热写 + 6 opener 同 tick 抢新建库,全部在退避内打开成功,无丢失更新)。
2. **fence 校验的实战验证**:harness 最初用 claim 之前的记录作终态基底,`lastFencingToken: 0` ≠ 租约 token,`compareAndSet` 被 fence 检查如实拒绝——过期 token 写入被拒是 G2 fence 合同在多进程竞争下的又一次实证。

## 5. 承袭披露

- 参考数据受本机环境影响(Windows 文件锁语义、24 核、单 NVMe);换环境的复现命令见文件头。
- `verify:matrix`(Docker)仍未在本机复跑,与本 Goal 无耦合(纯 Node 层工具 + evidence,零包变更)。
