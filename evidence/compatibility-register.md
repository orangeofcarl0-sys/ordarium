# Compatibility Register

依据 docs/17 §6。任何兼容层必须在此登记：没有 owner 与移除条件的“临时层”视为永久架构，必须重新审议。本表由 `pnpm verify:architecture` 机器校验（ID 唯一、六列非空）。

| ID | 边界 | 兼容来源 | canonical target | owner | 移除条件或决定 |
|---|---|---|---|---|---|
| `COMPAT-DB-001` | `@ordarium/ledger-sqlite` | 切换前的私有 SQLite schema v1 数据库 | 事务性 forward migration 到 `user_version=2` / record `schemaVersion=2` | G2 执行者 | **已执行（G2-002，2026-08-16）**：打开即迁移、失败回滚保 v1 完整、边界浅校验 + core codec 复验；A01/A02 fixture 证明；core 不接收 v1 union |
| `COMPAT-DSH-001` | `@ordarium/dsh` | 私有 text-only ContentBlock 近似类型与未定支持矩阵 | 结构化内容块 + 固定 DSH public 支持矩阵 + 正式类型集成 | G5 执行者 | **部分执行（G5-001，2026-08-17）**：text-only union 已收敛为结构化块（自定义 renderer 不受私有类型限制）；正式 DSH 包在本环境不可消费，官方类型/HMR fixture 携至 G7 发布门 |
| `COMPAT-API-001` | 四包 package facade | 当前 private `0.2.0` API | G1 冻结的首发 public API surface | G1/G7 执行者 | 首发前 clean break，不保留 legacy alias；发布后按 semver 承担外部兼容 |
| `COMPAT-API-002` | `@ordarium/dsh` 根入口 | 切换前的宽 `export *` core 并重导出 `SqliteLedger` 根入口 | 精选 author façade root + `/advanced` subpath export map | G1 执行者 | **已执行（G1-002，2026-08-16）**：根入口只含 curated author 表面，低层 binding/lifecycle/custom ledger 移入 `/advanced`；机器校验（root 白名单 + exports 测试）通过，无 legacy root 残留 |
| `COMPAT-LEDGER-001` | `OperationLedgerPort` 实现约定 | 当前 Memory/SQLite port 无能力描述，无 eligibility gate | `LedgerCapabilities` port 合同 + managed capability gate | G1（合同）/G2（实现）执行者 | G2 atomic slice 更新全部实现与 Runtime 后删除旧约定；不得用 `instanceof` 维持判断 |
| `COMPAT-PAL-001` | `HostInvocationPort` | 未来 Palimpsest 接入形状未知 | 仅保留 versioned Host Adapter 缝，不预设字段 | G8 执行者 | 不提前增加 Palimpsest 字段或 shim；真实需求出现时重审 |
