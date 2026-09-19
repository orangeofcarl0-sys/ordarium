# Concept · Claim, Lease, and Fencing

## The problem

两个 worker 同时收到同一 Operation：

```text
Worker A ─┐
          ├→ same Operation
Worker B ─┘
```

仅靠“先查数据库再执行”不能安全解决竞争，因为 check 与 execute 之间仍有 race。

## 30-second answer

Ordarium 把执行所有权建模成：

```text
semantic claim
+
live lease
+
monotonic fencing token
```

三者解决不同问题。

## Claim

Claim 是 semantic record 的一部分：

```text
谁获得了执行权
从哪个 durable state 接手
使用哪个 fencing token
```

## Lease

Lease 表示“这个 owner 现在还活着”。

它会续期，但 heartbeat 不应该污染 semantic history。

```text
lease renewal
!=
new business event
```

## Fencing

Fencing token 解决 stale worker：

```text
Worker A token=7
→ pause / network stall
→ lease expires

Worker B takeover token=8
→ becomes current owner

Worker A resumes
→ token 7 is stale
→ cannot commit terminal semantic state
```

没有 fencing，仅靠 lease expiry 仍可能出现“旧 owner 复活后写结果”。

## Why all three?

| Primitive | 回答 |
|---|---|
| Claim | 谁拿到了这次 semantic execution ownership？ |
| Lease | 这个 owner 现在还被认为 live 吗？ |
| Fence | ownership 已经转移后，旧 owner 的写如何失效？ |

## Common mistakes

- heartbeat 每次都增加 semantic revision；
- claim 与 lease 不是原子获取；
- takeover 后仍允许旧 token 写 terminal result；
- 用 `MemoryLedger` 声称跨进程 ownership。

## Reference

- [Run multiple workers](../how-to/run-multiple-workers.md)
- [Ledgers](../dev/06-ledgers.md)
