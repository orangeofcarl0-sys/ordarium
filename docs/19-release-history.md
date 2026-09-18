# 19 · Release history

本文是**只追加**的已发布版本事实台账。

兼容政策见 [18](18-release-compat-policy.md)。

## 当前发布

| 项 | 当前值 |
|---|---|
| Published package line | **1.3.1** |
| Workspace package line | **1.3.2**（已 bump，待发布） |
| Tag / Release | `ordarium-v1.3.1` |
| Distribution | GitHub tags / Releases |
| Packages | core / ledger-sqlite / testing / host-kit / host-mcp / dsh |
| SQLite schema | **v4** |
| `HOST_CONTRACT_VERSION` | **1** |
| OperationRecord schema | **2** |
| StateRecord schema | **1** |
| Node | core/testing/host-kit `>=24.0.0`; sqlite/host-mcp/dsh `>=24.15.0` |

公共 npm 发布目前没有完成；GitHub 仍是正式 release channel。

## 已发布版本

| Version | Date | Headline | Consumer-visible changes |
|---|---|---|---|
| `1.0.0` | 2026-08-17 | 首个 release line | Action/Runtime/SQLite/Testing/DSH/MCP 初始面 |
| `1.1.0` | 2026-08-29 | Revisioned management state + SQLite open retry | SQLite v2→v3；State APIs；State errors；bounded busy retry default |
| `1.2.0` | 2026-09-06 | Versioned Host Adapter kit | `@ordarium/host-kit`；`HOST_CONTRACT_MISMATCH`；Host contract v1 |
| `1.3.0` | 2026-09-11 | StateChangeFeed | SQLite v3→v4；change feed；`INVALID_CURSOR` |
| `1.3.1` | 2026-09-11 | Change-feed boundary hardening | limit `1..1000`；future cursor invalid；无 schema bump |

## 1.0.0

Tag：

```text
ordarium-v1.0.0
```

初始公开包：

- `@ordarium/core`；
- `@ordarium/ledger-sqlite`；
- `@ordarium/testing`；
- `@ordarium/dsh`；
- `@ordarium/host-mcp`。

Release channel 冻结为 GitHub。

公共 npm 发布曾因账号 2FA policy 被拒绝，因此没有形成公开 npm release。

## 1.1.0

增加 revisioned management state：

```text
StateRecord
createStateStore
stateRevisions capability
state history / reference / list
```

SQLite：

```text
v2 → v3
```

增加 state tables/indexes。

同时加入 `LEDGER_BUSY` 的 bounded SQLite open retry。

新 stable codes：

```text
STATE_REVISION_CONFLICT
STATE_REF_NOT_FOUND
```

## 1.2.0

增加一等 Host Adapter contract：

```text
HOST_CONTRACT_VERSION = 1
assertHostContract
HOST_CONTRACT_MISMATCH
@ordarium/host-kit
runHostAdapterConformance
```

Host-neutral 从架构原则变成可机器验证的 package contract。

## 1.3.0

增加 revisioned state incremental observation：

```text
StateChangeFeed
supportsStateChangeFeed
StateStore.changes
INVALID_CURSOR
```

SQLite：

```text
v3 → v4
```

新增 `ordarium_state_changes`。

v3 历史 state revisions 没有保存全局 commit order，因此 migration 只能生成 deterministic synthetic order，不能恢复真实历史顺序。

## 1.3.1

关闭 change-feed 三个边界：

- explicit limit 固定为 `1..1000`；
- malformed cursor fail closed；
- cursor > current global high-water fail closed。

保持：

```text
default page size          100
SQLite user_version        4
HOST_CONTRACT_VERSION = 1
```

已知限制：

当前 cursor 不绑定 database identity。

因此另一个 database 的 cursor 如果数值上在当前 ledger 中也合法，不一定能被识别为 foreign cursor。

## 下一版本：1.3.2（工作区已 bump，待发布）

1.3.1 之后做出的产品定位决定，已在工作区 1.3.2 落地：

```text
@ordarium/dsh
= legacy / frozen

类型面：公开声明全部带 @deprecated（32 处，含 /advanced）
```

**不是** package removal，也没有破坏性变更：运行时、导出集合、类型形状与依赖图零变化，既有消费者零改动。

1.3.2 的 release notes 按 [18](18-release-compat-policy.md) §1 逐类披露：

| # | 类别 | 1.3.2 |
|---|---|---|
| 1 | Default change | 无 |
| 2 | Storage migration | 无（schema 保持 v4） |
| 3 | Error classification change | 无 |
| 4 | New stable error code | 无 |
| 5 | Deprecation / legacy surface | **有**：`@ordarium/dsh` 与 `/advanced` 冻结为 legacy，声明携带 `@deprecated`，替代路径 `core + host-kit` 或 `host-mcp` |

Delta Sheet：`evidence/delta-ARCH-003-dsh-legacy-freeze.md`；机器登记：`COMPAT-DSH-002`。

物理移除仍受 [17](17-ordarium-goals-and-acceptance.md) 的 DSH 归属重审双条件约束（休眠中），届时应走 major 线。

新接入建议：

```text
@ordarium/core + @ordarium/host-kit
```

或：

```text
@ordarium/host-mcp
```

## 独立版本轴

```text
package semver             1.3.1 published / 1.3.2 workspace
HOST_CONTRACT_VERSION      1
SQLite user_version        4
OperationRecord schema     2
StateRecord schema         1
```

五者相互关联，但互不自动联动。

## Evidence

版本级 design / verification 证据继续保留在：

```text
evidence/G*/
evidence/ORD-BOOT-0/
evidence/ORD-BOOT-0.1/
```

本文只记录 release facts，不复制全部交付过程。
