# Ordarium Evidence 目录

本目录保存 docs/17 §18 要求的 Goal 证据包与 Compatibility Register。它只记录证据，不产生新合同；规范权威仍在 `docs/12–17`。

## 目录约定

```text
evidence/
  README.md                    本文件：目录约定与 Architecture Delta Sheet 模板
  compatibility-register.md    跨阶段 Compatibility Register（docs/17 §6）
  G0/                          每个 Goal 一个子目录
    baseline-report.md         验收 ID → 证据映射、命令输出摘要、已知缺口
    target-contract-decisions.md  该阶段冻结的目标结构决策（按引用合并，不复制权威）
```

每个 Goal 退出时其子目录必须包含：

1. `goal-id`、依据的 docs revision 与完成日期；
2. Architecture Delta Sheet（每个结构变化一份）；
3. 验收 ID → test/fixture/report 的映射表；
4. 最终命令、环境与输出摘要；
5. 未完成项及其归属的后续 Goal。

## Architecture Delta Sheet 模板

任何影响 public API、OperationRecord/SQLite schema、identity/state/recovery/error 语义、DSH/宿主映射或 Provider capability 的变更，必须先填写本表并放入对应 Goal 目录（文件名 `delta-<id>.md`），才允许执行 `pnpm snapshots:update`：

```markdown
# Delta <ID>

- 变更分类（docs/17 §7.2）：A 内部等价 / B 加法合同 / C 破坏性合同 / D 边界变化
- 影响面：public API / record schema / 语义 / 宿主映射 / Provider capability / 内部
- 目标结构与理由：
- 旧调用/旧数据的转换位置（一次性 canonical 转换发生在哪个边界）：
- 旧路径删除时点：
- 证明旧路径不再产生状态的测试：
- 需要同步更新的文档（12–17）与 Mermaid：
- 快照变化：snapshots/ 下哪些文件预期漂移
```

## 快照更新政策

- `pnpm verify:architecture` 在无解释漂移时必须失败；
- `pnpm snapshots:update` 只能在附带 Delta Sheet 的同一变更集内执行；
- 快照文件（`snapshots/api/<pkg>/**/*.d.ts` 全量声明快照、`snapshots/contracts.json`、`snapshots/sqlite-v1.json`）必须与对应 Delta Sheet 一起提交。
