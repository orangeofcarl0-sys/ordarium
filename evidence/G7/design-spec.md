# G7 Design Spec：发布候选、包发布与总验收（冻结）

> 依据：`ORDARIUM-GOALS-3`（docs/17 §15）、docs/12 §7/§8、docs/15 §25。
> 性质：G7 实现前的单一目标形状；前置 = G2–G6 全部 exit。

## 0. 当前落点

四包 `private: true`、单 `"."`（dsh 另有 `/advanced`）入口；engines 已分层（24.15.0 durable 路径）；验证入口已有 `pnpm check` / `verify:architecture` / `snapshots:update`。

## 1. 包 manifest（四内核包 + 宿主叶包）

统一补齐：`private: false`、`files`（dist 声明 + LICENSE/README）、`exports` 完整图（含 `/advanced`、叶包入口）、`types`、`engines`（维持 24.15.0/24.0.0 分层）、`license`、`repository`、semver 起点 `1.0.0`（或 `0.x` 预发布线，二选一在 G7 决议并记录）。

## 2. tarball 消费 fixture（非 workspace 环境）

`tools/package-consumer.mjs`：对每包 `npm pack` → 独立临时目录 `npm install <tarball> (+peer deps)` → 断言：

- ESM `import()` 可用、行为 smoke（guarded 流程 + `IDENTITY_REQUIRED` 负例）；
- TypeScript declarations 可编译（`tsc --noEmit` 消费 sample）；
- root/advanced 面 = 快照声明（root 白名单复用现有检查逻辑，作用于 tarball）。

## 3. 命令收敛（docs/17 §18.3 全量落地）

| 命令 | 职责 |
|---|---|
| `pnpm check` | 现状（build + 全测试） |
| `pnpm verify:architecture` | 现状（依赖/快照/register/façade） |
| `pnpm test:integration` | DSH/host-mcp 真实 fixture + 双宿主 e2e + HMR |
| `pnpm test:conformance` | G6 套件全矩阵 |
| `pnpm test:package` | §2 tarball 消费 |
| `pnpm verify:docs` | 12–17 链接/权威范围/Mermaid 语法检查（脚本化） |
| `pnpm verify:release` | 聚合以上全部 + 生成 release evidence 摘要（退出码即发布门） |

## 4. 发布证据包内容

- Node 真机矩阵：24.15.0 最低线 + 当前线，真实文件/backup/migration/双进程（本机 24.14.1 无法执行，需 CI 或 24.15 环境——发布前硬门）；
- snapshot 组：public API、record schema（sqlite-v2）、migration fixtures（v1 库实物 + 迁移后库）、DSM 支持矩阵、provider conformance 指纹；
- threat/trust/tenant/secret 声明文档（docs/15 §23 的发布口径节选 + 本仓 README 发布段）；
- performance/resource 基线：无网络 hop、心跳零语义写（G2-A03 证据复用）、SQLite 事务计数记录、包体积（pack 输出）入报告；
- README 宣称审计：不出现 unconditional exactly-once / 强 sandbox / tamper-proof / 完整 Harness（A10）。

## 5. 端到端总测（§17 矩阵全行）

Identity/多 agent/Authorization/Dispatch boundary/Concurrency/Idempotency/Reconciliation/Operations/Ledger/HMR/DSH/Provider/Secret-Tenant/Packaging——每行至少一条自动测试，映射表入 release evidence。

## 6. 验收映射（docs/17 §15.3）

| ID | 证据 |
|---|---|
| A01 tarball consumer | §2 fixture |
| A02 one-install DSH | 只装 `@ordarium/dsh` 的 sample 工程 |
| A03 replay/crash 端到端 | 集成套件（SQLite reopen + replay） |
| A04 opaque uncertain | conformance 套件 |
| A05 dual process / long task | G2-A05 复跑入 integration |
| A06 HMR/restart | G5 fixture |
| A07 Ops closure | G4 套件 + 未授权负例 |
| A08 secret audit | ledger/tarball 内容扫描（无 raw input/credential/stack） |
| A09 migration/backup | G2 fixture 复跑 + 可重复性 |
| A10 public claims | README 审计脚本/清单 |
| A11 register | 无匿名项、已执行项复核 |
| A12 full gate | `verify:release` 聚合输出 |
| A13 ledger selection | capability 矩阵 + 无 fallback 负例 |
| A14 surface/engines | tarball 声明 = 快照；engines 在声明范围运行 |

## 7. 环境前置（硬门）

24.15+ Node 环境（CI 或本机升级）用于 A10 矩阵；无该环境则 G7 不得宣布完成——与 G2 exit 的遗留项衔接。
