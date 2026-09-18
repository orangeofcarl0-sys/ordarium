# @ordarium/dsh

> **Legacy / frozen Host Adapter**

这是 Ordarium 最早的 DSH 适配器。

既有消费者继续可用，但它已经不是新接入推荐路径，也不再承载新的 Ordarium capability。

既有入口保持：

```text
installOrdarium
@ordarium/dsh/advanced
```

新集成优先：

```text
@ordarium/core
+
@ordarium/host-kit
```

或者：

```text
@ordarium/host-mcp
```

`legacy` 是当前 compatibility / governance posture，**不是**任何版本的 removal notice。自 1.3.2 起，本包的全部公开声明携带 `@deprecated` 标记——类型检查与编辑器会直接提示迁移方向，但运行时、导出集合与类型形状零变化。

见：

- [08 · Hosts](../../docs/dev/08-hosts.md)
- [18 · Compatibility policy](../../docs/18-release-compat-policy.md)
