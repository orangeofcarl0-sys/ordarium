# Recipe · Cloud resource creation

创建 VM / bucket / deployment / job 这类资源时，最实用的 recovery seam 往往是一个稳定 external name/reference。

## Recommended pattern

```text
Operation identity
→ derive/stash stable external name
→ Provider create
→ reconcile by exact external name
```

如果 Provider 对 external name 唯一性与查询语义足够强：

```ts
effects.reconcilable()
```

## Example

```ts
const externalName =
  `ordarium-${input.requestId}`;
```

`execute()` 用这个名字创建。

`reconcile()` 用同一个名字查：

```text
ready    → succeeded
failed   → failed
creating → pending
absent   → absent + retrySafe?（取决于 Provider contract）
```

## Delete / cleanup 是另一项 Action

不要把 create Operation 的 recovery 与资源 cleanup 混成一个隐式补偿。

如果需要 delete：

```text
resource.create@1
resource.delete@1
```

通常应该是两个独立 Action contract。
