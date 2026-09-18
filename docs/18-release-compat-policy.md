# 18 · Release compatibility policy

本文定义：

1. 每次 `@ordarium/*` 发布必须向消费者说清什么；
2. 消费者升级 Ordarium 时必须检查什么。

已经发布的事实见 [19 · Release history](19-release-history.md)。

Compatibility shim / layer 的机器登记见 [`../evidence/compatibility-register.md`](../evidence/compatibility-register.md)。

## 1. Release notes 五类必答项

每次 release 都必须逐项写明，即使答案是“无变化”。

| # | 类别 | 典型例子 |
|---|---|---|
| 1 | Default change | retry/open 默认值、constructor default、resource limit |
| 2 | Storage migration | SQLite `user_version`、前向 migration |
| 3 | Error classification change | busy/transient/conflict/terminal 的解释变化 |
| 4 | New stable error code | 新 `OrdariumError.code` |
| 5 | Deprecation / legacy surface | 弃用包/API/行为及替代路径 |

此外还要披露对消费者有实际意义的 additive public package / API。

## 2. Consumer upgrade checklist

升级时：

1. 阅读本版本五类 release note；
2. 全部 `@ordarium/*` 保持同一 release line；
3. 核对 `HOST_CONTRACT_VERSION`；
4. 用旧 ledger fixture 验证 migration；
5. 重跑相关 Provider / Ledger / Host conformance；
6. 更新自身 stable error code 分类；
7. 对关键 default 尽量显式传参固定；
8. 检查 compatibility register；
9. 重跑自身 crash/replay/recovery 场景。

## 3. 五条独立版本轴

不要混淆：

```text
package semver
HOST_CONTRACT_VERSION
SQLite user_version
OperationRecord.schemaVersion
StateRecord.schemaVersion
```

Package release 不自动意味着其他四条都 bump。

## 4. Host contract compatibility

只有 Host 可见的语义合同变化才 bump：

```text
HOST_CONTRACT_VERSION
```

例如：

- `HostInvocationPort` shape / semantics；
- host-visible error-family promise；
- host construction default 改变合同语义。

握手策略：

```text
exact match
fail closed
```

不要偷偷加入多版本 tolerance；那本身就是需要 owner/生命周期的 compatibility layer。

## 5. Storage compatibility

发生 SQLite schema bump 时，release notes 必须明确：

- source schema；
- target schema；
- additive / destructive；
- migration failure rollback；
- historical order 是否只能近似重建。

禁止建议“旧 binary 继续打开新 schema 并写入”。

## 6. Public API

`verify:architecture` snapshot public package exports。

Intentional drift 需要：

```text
Architecture Delta Sheet
+
snapshot update
+
release disclosure
+
正确 semver 档位
```

特别注意 wildcard re-export：

```text
export *
```

它可能在看似纯重构时静默扩大 public API。

## 7. Legacy DSH

工作区 1.3.2 已承载类型面标记（32 处 `@deprecated`，运行时与类型形状零变化），但尚未发布。

当前已经决定、但尚未由已发布版本承载的姿态：

```text
@ordarium/dsh
= legacy / frozen
```

下一次 release 必须在第 5 类披露：

- 不再接收新 capability；
- 既有消费者继续支持；
- 推荐迁移到 `core + host-kit` 或 `host-mcp`；
- “legacy” 本身不等于“立即移除”。

Compatibility register 继续负责其机器化生命周期登记。

## 8. Release gate

Tag 前运行：

```bash
pnpm verify:release
```

并确认：

- tag 指向目标 commit；
- release assets 来自同一 tree；
- release notes 五类齐全；
- `19-release-history.md` append 新版本；
- compatibility register 同步更新（若触发）。

## 9. 写给消费者，不写给考古学家

Release communication 应描述：

```text
用户会看到什么变化
升级需要做什么
```

而不是要求消费者先理解某个 Gxx Goal 才能判断影响。
