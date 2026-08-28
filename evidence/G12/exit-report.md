# G12 Exit Report:共账拓扑并发压测

> 依据:`evidence/G12/design-spec.md`(2026-08-29 冻结)
> 完成日期:2026-08-29　环境:win32 x64 / Node v24.14.1 / node:sqlite
> 性质:evidence-only Goal——零包变更,无 Delta Sheet,机器门零漂移(见 §3)

## 1. 验收矩阵(spec §3)

| ID | 证据 |
|---|---|
| G12-A01 | `stress-results.json` 全部 state-shared 腿的 invariantChecks:最终 revision == Σ成功数(K=1..8 全过) |
| G12-A02 | state-own 腿逐 worker 的 own-X-consistent 检查全过 |
| G12-A03 | 12 腿吞吐/冲突率/分位数成表(`stress-report.md` §2),原始数据落 `stress-results.json` |
| G12-A04 | ops-lifecycle 各腿 succeeded 记录数 == Σ成功数 + 抽样 codec 复验(lifecycle-closed / sample-decodes) |
| G12-A05 | 冲突全部体现为 CAS false 或 `LEDGER_BUSY` 稳定错误码;无部分写入;无静默语义(harness busy 容忍即宿主例试错-重试,账本零特殊分支) |

## 2. 结论(详见 stress-report.md §3/§4)

- 单写者天花板本机口径 **~1400 成功写/s**,K=1..8 聚合吞吐持平、p50 稳定(0.7ms 级),代价集中在尾延迟(K≥4 的 max 达秒级,受 busy_timeout 5s 上界保护);
- 最大争用下 CAS 冲突率 ≤0.75%,无丢失更新——G2 revision CAS 与 fence 合同在多进程热争用下的直接实证;
- 两条附带发现:热库打开竞态(`LEDGER_BUSY`,宿主应退避重试;内核内置 open 重试待独立决议)、fence 拒绝过期 token 终态写(harness 开发中无意实证)。

## 3. 最终命令与输出

```text
pnpm build                → 全绿(dist 为压测前提)
node tools/stress-matrix.mjs → 12 legs,所有 invariantChecks pass;结果落 evidence/G12/stress-results.json
pnpm verify:architecture  → passed(零包变更,快照零漂移)
```

## 4. 未完成项

- `verify:matrix`(Docker)仍待有 Docker 宿主的环境复跑(G11/G12 同一遗留项);
- 内核侧 open 重试(`SqliteLedger` 构造器退避)是潜在 B 类小 Goal,待决议;
- 分片/排队 v2 的触发刻度已由本数据给出口径:目标吞吐超 ~1400 写/s 或 p99 秒级不可接受时启动。
