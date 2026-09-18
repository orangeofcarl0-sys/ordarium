# Delta ARCH-003：`@ordarium/dsh` 冻结为 legacy（类型面弃用标记 + 叙事去中心化）

- **变更分类（docs/17 §7.2）**：**B 加法合同（元数据）**——只新增 `@deprecated` JSDoc 标记与文档/位置叙事；**无** API 形状删除、**无** 运行时行为变化、**无** schema 变化、**无** record 语义变化。不是 C：没有 error code 改义、没有 record/identity/state 字段变化、没有 breaking。
- **影响面**：public API（**仅 `.d.ts` 注释**：`@ordarium/dsh` 与 `@ordarium/dsh/advanced` 的 32 处声明与再导出语句新增 `@deprecated`）+ 文档 + 兼容登记。运行时导出集合、类型形状、签名、依赖图全部零变化。
- **依据**：所有者决议（2026-09-11）：文档叙事不再以 DSH 为中心，`@ordarium/dsh` 叶包遗产化。仓库自身的既有事实支持该处置——该适配的归属重审自 2026-09-07 无限期休眠（docs/17 §16 第 6 项）；姊妹仓四行 pin 从不包含该包；仓库内**无任何 `src` 代码依赖它**（仅其自身测试、`host-mcp` 的 devDependency/测试、工具脚本引用）。
- **目标结构**：接入路径统一为 host-neutral —— `@ordarium/core`（+ `@ordarium/ledger-sqlite`）+ 自建宿主（`@ordarium/host-kit`）或 `@ordarium/host-mcp`。`@ordarium/dsh` 保留可用但冻结：无新能力、不推荐新接入、缺陷不阻塞内核线。
- **旧调用/旧数据的转换位置**：**无需转换**。既有消费者代码零改动即可继续编译与运行——弃用只是类型层提示；无 shim、无重命名、无移除。
- **旧路径删除时点**：**不删除**。物理移除/迁往 DSH 仓仍受 docs/17 §16 第 6 项双条件（官方 DSH 类型可消费 + DSH 生态愿意持有适配器）约束并保持休眠；届时应以 **major 线 + 兼容登记**执行（`COMPAT-DSH-002` 的移除条件列即该闸门）。
- **证明旧路径不再产生状态的测试**：不适用（运行路径未变）。反向保证由既有测试承担：`packages/dsh/test/{adapter,exports,hardening,plugin}.test.ts`、`packages/host-mcp/test/mcp.test.ts`、`tools/package-consumer.mjs` 的 dsh 消费探针全部**保持绿**，证明弃用标记未改变任何行为。
- **需要同步更新的文档（12–19）**：根 `README`（host-neutral 定位 + 包表 legacy 行）、`docs/12`（定位更新注 + 包布局图）、`docs/13`（宿主映射通用化，DSH 降为 legacy 注）、`docs/14`（宿主适配行拆现役/legacy；§5 Palimpsest 消费面修正为 core + ledger-sqlite）、`docs/15`/`16`（结构图节点标 legacy）、`docs/17` §16 第 6 项（现行处置）、`docs/18` RCP-5（⑤ 弃用面披露）、`docs/19` §5（待披露项）、`docs/dev/{01,02,05,06,07,08,11}`（core-first 路径）。研究档案新增本次审计 §7。
- **快照变化**：`snapshots/api/dsh/{index,advanced,install,plugin}.d.ts`（仅 `@deprecated` 注释行）；`snapshots/contracts.json`（六包版本 1.3.1→1.3.2）。**无其他漂移**：`packages/dsh/package.json` 的 `exports`/依赖/`private` 未动，`snapshots/sqlite-v4.json` 与其余包声明面字节不变。
- **`HOST_CONTRACT_VERSION`**：保持 `1`（宿主调用握手语义未变）。
- **发布分类**：**patch 1.3.2**。理由：非破坏性、无默认值变化、无存储迁移、无新错误码；⑤ 弃用面按 docs/18 §1 在 release notes 披露（这是弃用面**首次**随版本发布；此前 1.3.1 的 notes 不追改）。

## 验证

| 门 | 结果 |
|---|---|
| `pnpm test` | 35 文件 / **214 测试**全绿（弃用标记零行为影响；dsh 自身四个测试文件与 host-mcp 的 `asDshTool` 消费测试保持绿） |
| `pnpm verify:architecture` | passed（漂移仅 `snapshots/api/dsh/*.d.ts` 的注释行与 `contracts.json` 版本；7 条兼容登记；dsh root façade 19 curated 导出不变） |
| `pnpm verify:docs` | passed（38 篇） |
| `pnpm test:package` / `pnpm verify:release` | passed（六 tarball 1.3.2 独立消费 + 类型探针；六门聚合全绿） |
| `pnpm verify:matrix` | 双腿 `MATRIX_LEG_OK`（`node:24.15.0-slim` / `node:24-bookworm`，exit 0） |

**环境注记（如实记录）**：本批矩阵验证期间遇到两类**非代码**问题——① Docker Desktop 守护进程已停止（`npipe:////./pipe/dockerDesktopLinuxEngine` 不可达），重启后恢复；② 首轮恢复运行中 bookworm 腿出现 1 例瞬时失败（1 failed / 213 passed），独立复跑该腿 214/214 全绿，随后整轮矩阵双腿全绿。判定为容器资源争用下的计时/进程类用例抖动（与 `evidence/ORD-BOOT-0.1/exit-report.md` §5 记录的同类现象一致），非本批回归——本批改动仅为声明注释与版本元数据。
