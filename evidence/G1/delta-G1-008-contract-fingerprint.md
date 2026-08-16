# Delta G1-008：Action contract fingerprint 与 CONTRACT_DRIFT

- 变更分类（docs/17 §7.2）：B 加法合同（新导出函数、可选 record 字段、新错误码）
- 影响面：public API（`contractFingerprint`、`CONTRACT_DRIFT`）/ 语义（同名版本漂移检测）/ codec
- 依据：docs/17 GOALS-3 §9.2.3、G1-A04；docs/15 §15（诊断 digest 不替代版本责任）

## 目标结构与理由

1. `contractFingerprint(action)`（core 公共导出）：对 name/version、input/output JSON Schema、effect profile（含 window/cancellable）与可选 hook 的**存在性**做 canonical SHA-256。不含函数源码（明确禁止）、不含 description（无语义）。
2. record v1 增加可选 `contractFingerprint`（64-hex，codec 校验）：创建即持久化；对缺失的历史记录首次重入时 CAS 采纳。
3. 同 name+version 重入且 fingerprint 不一致 → 新错误码 `CONTRACT_DRIFT`（`ContractDriftError`），持久指纹不变、Provider 不再调用。它是**诊断**：作者 bump version 仍是唯一语义边界，指纹只抓"忘 bump"的意外漂移。
4. 检测点位于 `#applyContractBinding`（authorization 一致性之后、principal 绑定之前），与 principal 绑定同一"首次 durable 即绑定"模式。

## 旧调用/旧数据的转换位置

无迁移：旧记录无指纹视为未绑定，首次重入补绑。

## 旧路径删除时点

不适用（纯新增路径）。

## 证明旧路径不再产生状态的测试

`packages/core/test/fingerprint.test.ts`（4 项，映射 G1-A04）：

- 重新定义的相同合同 → 指纹稳定且 description 不参与；
- schema/窗口/hook 存在性变化 → 指纹不同；
- 同名版本漂移（guarded→idempotent）→ `CONTRACT_DRIFT`，record 仍 succeeded 且指纹保持首次值，execute 计数不变；
- 合同一致重入 → 正常去重，record 持久化 64-hex 指纹。

## 需要同步更新的文档

docs/14 §1、docs/17 §2.2（G1 完成）、G1 exit report、本 delta sheet。

## 快照变化

`snapshots/api/core/*`（action/errors/runtime/types/codec 声明）；`contracts.json`（errorCodes 增加 `CONTRACT_DRIFT`）；`sqlite-v1.json`（fixture 增加 `contractFingerprint`）。
