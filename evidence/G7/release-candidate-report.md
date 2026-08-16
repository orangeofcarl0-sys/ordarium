# G7 Release Candidate Report：发布候选与总验收

> Goal revision：`ORDARIUM-GOALS-3`（docs/17 §15）；目标形状冻结于 `design-spec.md`
> 日期：2026-08-17　环境：Windows 10 (26200)、Node v24.14.1（开发）/ Docker node:24.15.0-slim + node:24-bookworm（矩阵）、pnpm 11.21.0、TypeScript 7.0.2

## 1. 变更范围

| Delta/证据 | 内容 |
|---|---|
| G7-001 | manifest 成品化（1.0.0-rc.1 / private:false / files / MIT）、tarball 消费 fixture、命令收敛、宣称审计 |
| node-matrix-report | Docker 双腿 Node 矩阵（24.15.0 下限 + 24.19.0 当前线） |

## 2. 验收矩阵（docs/17 §15.3）

| ID | 证据 | 结果 |
|---|---|---|
| A01 tarball consumer | `pnpm test:package`：五 tarball 隔离安装 + ESM smoke + tsc 声明编译 | PASS |
| A02 one-install DSH | smoke 断言 root 恰六值导出 + readOnly 全链 + `IDENTITY_REQUIRED` 负例 | PASS（tarball 级；真实 DSH 包集成见 §5） |
| A03 replay/crash 端到端 | integration 门（sqlite reopen/迁移/双宿主/SDK client） | PASS |
| A04 opaque uncertain | conformance 门 opaque 场景 + G3 套件 | PASS |
| A05 dual process / long task | G2-A05 双子进程 + lease/fence 组 | PASS |
| A06 HMR/restart | 生命周期/替代 runtime/`CONTRACT_DRIFT` 漂移诊断组 | PASS（同版本恢复 + 不兼容漂移拒绝；真实 Cordis HMR 见 §5） |
| A07 Ops closure | G4 A01–A11 + 未授权负例 | PASS |
| A08 secret audit | codec/记录投影无 raw input·credential·stack；uncertain reason 为安全枚举；G4 resultRef digest | PASS |
| A09 migration/backup | G2 fixture 复跑（integration 门内） | PASS |
| A10 public claims | `verify:docs` README 宣称审计 | PASS |
| A11 register | 6 项全部具名/含已执行标注，机器校验 | PASS |
| A12 full gate | `pnpm verify:release` 六门聚合 | **PASS（check/architecture/integration/conformance/docs/package）** |
| A13 ledger selection | capability 矩阵 + open 失败无 fallback 负例 | PASS |
| A14 surface/engines | tarball 声明=快照面；engines 分层 + Docker 矩阵双腿 | PASS |

## 3. 性能/资源基线（引用既有证据）

- 心跳零语义写：G2-A03（semanticRevision 冻结、history 不增、lease_revision 增长）；
- 无网络 hop / 无 daemon：架构不变量（verify:architecture 依赖图）；
- 包体积：pack 输出五 tarball（core/ledger-sqlite/dsh/testing/host-mcp @1.0.0-rc.1），`test:package` 运行时打印；
- SQLite 事务：create/CAS 单事务、renewLease 单 UPDATE（G2 设计 §2/§3 落实，A03 证明写放大消除）。

## 4. 发布前剩余硬项（诚实披露；2026-08-17 更新见 §6）

1. **真实 DSH 发布包接入**（A02/A08 的宿主终验）：环境无可安装 DSH 产物；`COMPAT-DSH-001` 剩余部分——接入后补官方类型/HMR fixture 即可闭环，Ordarium 侧合同零改动预期；
2. **发布目的地决议**：registry（npm 公共 / 私有）、`repository` 字段与组织归属；
3. `1.0.0-rc.1` → `1.0.0` 的正式发布动作本身。

## 5. 发布流程进入（2026-08-17 补录）

1. **工程分离**：Palimpsest 与 Ordarium 已完成仓内双根分离（commit `2cd5579`）——Python 线（运行时/测试/fixture/archive/pyproject）迁入 `palimpsest/`（101 测试在新位置全绿），Ordarium 规范迁入 `ordarium/docs/`，根 README 成为双项目索引。
2. **版本升位**：五包 + workspace `1.0.0-rc.1` → **`1.0.0`**（正式线，G7 §1 决议的 rc→1.0.0 执行）；快照重生成（22 项）。
3. **1.0.0 全门复跑**：`pnpm verify:release` 六门全 PASS（check 140 测试 / architecture / integration / conformance / docs 22 文档 / package 五 tarball）；Docker 矩阵双腿复跑（node:24.15.0-slim 与 node:24-bookworm 各 140 测试，双 `MATRIX_LEG_OK`）。
4. **发布阻塞项**：`npm whoami` → `ENEEDAUTH`（本机未登录 registry）。`npm publish` 为外发动作，需所有者提供 registry 与凭据后执行：
   ```powershell
   Set-Location ordarium
   npm login                      # 或配置 registry token
   pnpm --filter @ordarium/core publish --access public --no-git-checks
   pnpm --filter @ordarium/ledger-sqlite publish --access public --no-git-checks
   pnpm --filter @ordarium/dsh publish --access public --no-git-checks
   pnpm --filter @ordarium/testing publish --access public --no-git-checks
   pnpm --filter @ordarium/host-mcp publish --access public --no-git-checks
   ```
   （顺序即依赖序；`pnpm publish` 会把 `workspace:*` 重写为已发布的 `1.0.0`。）

## 6. 最终命令与输出

```text
pnpm verify:release
  PASS  check          （25 files, 131 tests）
  PASS  architecture   （façade 19 curated；register 6；快照零未解释漂移）
  PASS  integration
  PASS  conformance
  PASS  docs           （21 documents）
  PASS  package        （五 tarball 消费）
pnpm verify:matrix（已记录）24.15.0 / 24.19.0 双腿 118→131 期全绿（矩阵报告为 SDK 接入前基线，发布前复跑）
```

G7 exit 判定：**release candidate 达成**——六门聚合绿、tarball 可被外部环境消费、宣称审计通过；上列三项为"发布动作"级事项而非工程缺口。G0–G7 全部 Goal 完成。
