# Delta G7-001：发布工程（manifest 成品化 / tarball 消费 / 命令收敛 / 宣称审计）

- 变更分类（docs/17 §7.2）：B 加法（工具与脚本）+ C（manifest 合同：版本/private/files/license）
- 依据：`evidence/G7/design-spec.md` §1–§3；docs/17 §15

## 决议记录

1. **semver 起点**：五包统一 `1.0.0-rc.1`（release candidate 线；正式发布时升 `1.0.0`）。inter-dep 的 `workspace:*` 由 `pnpm pack` 重写为实际版本，tarball 间自洽。
2. **license**：MIT（根与五包各置 LICENSE 文件，`files: ["dist/src"]` 之外 npm 自动附带）。
3. **private:false**（五包；workspace 根保持 private）；`repository` 字段留待发布组织决议后补（npm 仅警告，不影响 pack/安装）。
4. **engines** 维持分层（ledger-sqlite/dsh/host-mcp `>=24.15.0`；core/testing `>=24.0.0`），矩阵证据见 `node-matrix-report.md`。

## 新工具与命令（docs/17 §18.3 全量落地）

| 命令 | 职责 |
|---|---|
| `pnpm test:integration` | build + ledger-sqlite/host-mcp/dsh 真实集成（迁移/双进程/双宿主/SDK client） |
| `pnpm test:conformance` | build + testing（Provider conformance A01–A12） |
| `pnpm test:package` | `tools/package-consumer.mjs`：pnpm pack ×5 → 隔离目录 npm install 五 tarball（无 workspace 解析）→ ESM smoke（curated root 恰六值、readOnly 全链、`IDENTITY_REQUIRED` 负例、MCP initialize、testing/advanced 面）→ TypeScript 声明编译（`consumer-types-probe` + tsc 7.0.2） |
| `pnpm verify:docs` | `tools/verify-docs.mjs`：21 份文档链接解析、mermaid 栅栏平衡、**公开 README 宣称审计**（exactly-once/tamper-proof/strong sandbox/complete harness 仅允许带否定期限定；设计文档不在审计范围——它们本来就在否定这些术语） |
| `pnpm verify:release` | `tools/verify-release.mjs`：check → architecture → integration → conformance → docs → package 聚合（`--with-matrix` 追加 Docker 矩阵），输出证据摘要 |

## 快照变化

`contracts.json`：五包 version `1.0.0-rc.1`、private:false、files 进包图；其余快照无漂移。

## 修复

docs/08 一处指向已更名文档的坏链（frozen-architecture-decisions → implementation-plan）。
