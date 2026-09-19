# Tutorial · Provider can be queried authoritatively

适用场景：Provider 可以通过稳定外部键回答：

```text
这项业务工作已经成功了吗？
失败了吗？
不存在吗？
还在处理中吗？
```

## Example: create a resource by stable external name

```ts
const provision = defineAction({
  name: "cloud.instance.create",
  version: "1",
  description: "Create one instance",

  input: schema.object({
    requestId: schema.string(),
    region: schema.string(),
  }),

  output: schema.object({
    instanceId: schema.string(),
  }),

  effect: effects.reconcilable(),

  async execute(input) {
    return provider.createInstance({
      externalName: `ordarium-${input.requestId}`,
      region: input.region,
    });
  },

  async reconcile(input) {
    const found = await provider.findByExternalName(
      `ordarium-${input.requestId}`,
    );

    if (found.status === "ready") {
      return {
        status: "succeeded",
        value: { instanceId: found.id },
      };
    }

    if (found.status === "failed") {
      return {
        status: "failed",
        error: {
          code: "PROVISION_FAILED",
          message: "Provider reports provisioning failure",
        },
      };
    }

    if (found.status === "creating") {
      return { status: "pending" };
    }

    return {
      status: "absent",
      retrySafe: true,
    };
  },
});
```

## 为什么必须是 authoritative query？

不能把：

```text
list API 没搜到
日志里没看到
cache miss
搜索结果暂时为空
```

自动解释为：

```text
absent + retrySafe
```

只有 Provider contract 真正支持“这个稳定 key 不存在 = 这项工作未发生”，才可以这样返回。

## `pending` 与 `unknown`

如果 Provider 明确说“仍在处理”：

```ts
{ status: "pending" }
```

如果 Provider response 无法支持确定判断：

```ts
{ status: "unknown" }
```

两者都不应该被伪装成 `failed`。

## `absent` 为什么还有 `retrySafe`？

即使权威确认“当前没有结果”，也不一定代表立刻重做安全。

例如：

```text
Provider 最终一致性查询显示 absent
但旧 request 仍可能在另一个 queue 中执行
```

这时：

```ts
{ status: "absent", retrySafe: false }
```

## Optional: query + same-key fallback

如果 Provider 同时提供：

```text
authoritative query
+
stable idempotency key
```

可以声明 `idempotencyWindow`：

```ts
effects.reconcilable({
  idempotencyWindow: { kind: "durable" },
})
```

Recovery 仍先 query；只有 evidence 允许时才 same-key redispatch。

## Operator recovery

`reconcileOnly` 只 query：

```text
never execute
never redispatch
```

适合 on-call / admin console 处理 production uncertain Operation。

见 [Inspect uncertain](../how-to/inspect-uncertain-operation.md)。
