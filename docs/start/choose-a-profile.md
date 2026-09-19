# Choose a profile · Don't memorize the names

不要先问：

> 五个 EffectProfile 分别是什么意思？

先问 Provider 三个具体问题。

## Question 1 — 这个调用会改变外部世界吗？

### 不会

例如：

```text
read record
pure calculation
list resources
query status
```

选择：

```ts
effects.readOnly()
```

结束。

### 会

继续 Question 2。

---

## Question 2 — Provider 是否真正支持 stable idempotency key？

你需要的是类似这样的真实 Provider contract：

```text
client sends key K
Provider durably remembers K
same K + same operation
→ same external effect / same result
```

### 是，而且 window 足够明确

选择：

```ts
effects.idempotent()
```

或 finite window：

```ts
effects.idempotent({
  window: {
    kind: "finite",
    expiresAfterMs: 15 * 60_000,
  },
});
```

去读：

[Provider idempotency-key tutorial](../tutorials/provider-idempotency-key.md)

### 不是 / 不确定

继续 Question 3。

---

## Question 3 — Provider 能否权威查询“这项业务工作是否已经发生”？

关键字是 **权威**。

不是：

```text
搜日志大概能看到
list API 可能搜到类似名字
缓存里没看到
```

而是：

```text
通过稳定 external business key / operation key
能够可靠得到 succeeded / failed / absent / pending
```

### 能

选择：

```ts
effects.reconcilable()
```

并实现 `reconcile()`。

去读：

[Provider reconciliation tutorial](../tutorials/provider-reconciliation.md)

### 不能

选择：

```ts
effects.guarded()
```

它的关键语义是：

```text
一旦 Provider 可能已经执行
但结果又无法证明
→ uncertain
→ 不 blind retry
```

去读：

[No recovery primitive tutorial](../tutorials/no-recovery-primitive.md)

---

## `unmanaged()` 放在哪里？

`unmanaged()` 不是第 4 个 Provider 能力分支。

它表示：

```text
我明确退出 managed crash/restart guarantee
```

典型用途：

- 渐进迁移；
- 临时兼容路径；
- 你明确接受弱保证的内部调用。

不要把它当成“更快、更简单的生产副作用 profile”。

---

## 一张表

| Provider 现实能力 | Profile | Crash 后核心动作 |
|---|---|---|
| 无副作用 | `readOnly` | 可重新执行 |
| 有副作用，无 key、无 query | `guarded` | 不确定则停在 `uncertain` |
| 有 stable key | `idempotent` | 在有效 window 内 same-key redispatch |
| 有 authoritative query | `reconcilable` | query first |
| 明确退出 managed guarantee | `unmanaged` | 不提供 managed recovery |

## 最常见错误

### “HTTP POST 不是幂等，所以 guarded；PUT 是幂等，所以 idempotent”

错。

Effect profile 看的是 **Provider 的实际 durable contract**，不是 HTTP method 名字。

### “我自己内存里记了一个 Set，所以 idempotent”

错。

进程 crash 以后那个 Set 就不存在了。

### “Provider query 99% 能搜到，所以 reconcilable”

如果“没搜到”不能权威证明 absence，就不能把它当 authoritative reconciliation。

### “遇到 uncertain 就换 callId 再调用一次”

这等于绕过去重边界重新制造一项副作用工作，通常正是你最不应该做的事。
