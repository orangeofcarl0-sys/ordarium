# Node 支持矩阵报告（G2-A10 / G7 §4）

> 日期：2026-08-17　执行方式：Docker 容器矩阵（`pnpm verify:matrix`，工具 `tools/node-matrix.mjs`）
> 宿主环境：Windows 10 (26200) + Docker Desktop（server 29.7.2）；源码以只读挂载 + 容器内 tar 复制（排除 node_modules/dist），每腿全新 `pnpm install --frozen-lockfile`，不污染宿主平台二进制。

## 1. 矩阵结果

| 腿 | 镜像 / Node | install | build (tsc -b) | Vitest | verify:architecture |
|---|---|---|---|---|---|
| 下限线（durable default 声明最低） | `node:24.15.0-slim` / v24.15.0 | ✓ | ✓ | **118/118 passed**（24 files） | ✓ passed |
| 当前 24.x | `node:24-bookworm` / v24.19.0 | ✓ | ✓ | **118/118 passed**（24 files） | ✓ passed |

两腿均输出 `MATRIX_LEG_OK`；含 SQLite 真实文件 reopen、v1→v2 迁移、双进程 claim 竞争（G2-A05）、双宿主共账 e2e（G5-A13）与官方 MCP SDK client 往返（G5 §5-2）。

`@ordarium/core` / `@ordarium/testing` 的独立下限（24.0.0）由本机 24.14.1 开发全绿覆盖（24.14 ≥ 24.0 但 < 24.15，恰好落在"core 可用而 durable 路径未到声明线"区间，佐证分层 engines 的意义）。

## 2. 复现

```powershell
Set-Location ordarium
pnpm verify:matrix            # 默认双腿：node:24.15.0-slim + node:24-bookworm
pnpm verify:matrix node:25-slim node:24.18.0   # 自定义腿
```

任一腿任一步失败（install/build/test/verify）即非零退出。

## 3. 过程中修复的真实缺陷

- `packages/host-mcp/tsconfig.json` 缺 `references`：干净环境（无预存 dist）下 `tsc -b` 不保证依赖先建，宿主因 dist 预存而长期掩盖——补齐 core/ledger-sqlite/dsh 引用后，两腿与宿主全绿；
- 矩阵脚本首版的 `shell:true` 参数拼接会把多行脚本打散（容器只跑了登录 shell）——改为 `spawnSync("docker.exe", …)` 直传参数；
- tar 复制源码需排除各包 `node_modules`（宿主 pnpm 联接被 Docker 挂载为实体目录，复制后会破坏解析）。

## 4. 结论

G2-A10/G7 §4 的"24.15.0 下限 + 当前线真机矩阵"证据闭环；该 carried 项从 G2/G5 exit 的遗留清单移除。发布时以同一命令复跑即可再验证。
