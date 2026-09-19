# Start

第一次接触 Ordarium，只需要完成三页：

1. [Quickstart](quickstart.md) — 把一个普通 API call 变成 durable Action；
2. [Failure Lab](failure-lab.md) — 故意制造“Provider 已成功、进程却崩了”；
3. [Choose a profile](choose-a-profile.md) — 根据 Provider 能力选择恢复合同。

完成之后，你应该能够回答：

```text
为什么需要 stable Operation identity？
为什么 dispatched 必须先持久化？
为什么 guarded 不能 blind retry？
为什么 idempotent 必须真的由 Provider 支持？
为什么 reconcilable 要先 query？
为什么 uncertain 不是 error-handling 失败？
```

如果这些问题已经清楚，再进入 [Tutorials](../README.md#tutorials--build-one-complete-integration) 或 [Reference](../13-ordarium-action-contract.md)。
