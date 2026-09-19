# How-to · Run multiple workers safely

场景：两个进程可能同时收到同一个 logical call。

目标不是“两个都跑得快”，而是：

```text
同一 Operation 在一个时刻只有一个有效执行所有者
```

## 1. 使用支持部署拓扑的 Ledger

本机多进程：

```ts
const runtime = new OrdariumRuntime({
  ledger: new SqliteLedger(dbPath),
  deploymentCoordination: "local-multi-process",
});
```

不要用 `MemoryLedger` 声称跨进程协调。

## 2. 所有 worker 必须共享同一 stable Operation identity

```ts
identity: {
  source: "queue-consumer",
  scope: queueName,
  callId: deliveryId,
}
```

如果每个 worker 自己随机生成 callId，它们当然会变成不同 Operation。

## 3. Ordarium 的 ownership primitive

Claim acquisition 同时产生：

```text
owner
fencingToken
live lease
```

另一个 worker 遇到 live foreign lease 时不会同时拥有执行权。

## 4. Lease expiry 后 takeover

Worker A crash：

```text
lease 不再续期
→ expires
```

Worker B 可以用更高 fencing token take over。

旧 Worker A 即使后来“复活”，也不能用旧 fence 成功写 semantic terminal state。

## 5. 调优 leaseMs

Lease 太长：

```text
crash 后 takeover 慢
```

Lease 太短：

```text
慢 Provider 调用更容易发生 lease pressure
```

不要只根据平均延迟设置；至少考虑 tail latency 与宿主暂停/GC。

## 6. 测试矩阵

必须测试：

- 两个 worker 同时 claim；
- live lease 下第二 worker busy；
- lease expiry takeover；
- stale worker terminal write 被 fence；
- crash after dispatch + takeover；
- same Operation identity 下 Provider 不被不安全重复调用。

`@ordarium/testing` 与 SQLite integration tests 应覆盖这些行为。
