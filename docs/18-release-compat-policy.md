# 发布兼容政策与消费者核对单（Release Compatibility Policy & Consumer Checklist）

> **地位**：宿主中立的**发布沟通纪律**，适用于 `@ordarium/*` 全部消费者。与 docs/12–17 冲突时以 12–17 为准；兼容层登记不在本文——那是 [`../evidence/compatibility-register.md`](../evidence/compatibility-register.md)（机器校验，有 owner 与移除条件），本文与其互补：登记表管"层"，本文管"话"。
> **修订记录**：`RCP-1`＝初版（2026-08-29）；`RCP-2`＝登记表 `COMPAT-PAL-001` 关闭为已执行（2026-09-06，见修订流水）；`RCP-3`＝ALN-4 对齐账例行复核回执与诉求③补记落地（2026-09-06，见修订流水）。

## 1. 发布沟通纪律

每次 `@ordarium/*` 发布（任何 semver 档位），release notes 必须包含**消费者可见行为变化**清单，五类逐一核对、无变化明示"无"：

| # | 类别 | 说明 |
|---|---|---|
| 1 | 默认值变化 | 影响消费行为面的构造参数/环境默认（如 `SqliteLedger` `openRetry` 默认开启）——消费者"零代码改动"也会被波及的面 |
| 2 | 存储迁移 | 账本 schema 迁移（如 v2→v3）：旧行为文件何时被迁移、失败回滚语义、是否影响打开路径 |
| 3 | 错误分类变化 | 错误在 transient / busy / terminal 之间的归属变化——消费者的重试与终态化判定依赖它 |
| 4 | 新错误码 | 新增错误码及其语义边界 |
| 5 | 弃用面 | 弃用的导出/参数/行为，及替代路径 |

**建议**（非强制承诺）：承重 seam 的默认值变更尽量提供显式 opt-out 路径，或推迟到 major 档位——把"静默行为漂移"的可能压到最低。

## 2. 消费者升级核对单（模板，任何宿主可复用）

消费侧每次 bump `@ordarium/*` 版本时逐项执行：

| # | 核对项 | 方法 |
|---|---|---|
| 1 | 默认值变化 | 对照 §1 清单，与自身构造参数面逐项比对；承重 seam 显式传参固定 |
| 2 | 存储迁移 | 用既有旧版本账本 fixture 打开验证迁移；迁移后全量恢复/reconcile 套件重跑 |
| 3 | 错误分类边界 | 自身错误分类映射（transient/busy 判定）在本次发布后仍成立 |
| 4 | 新错误码 | 是否进入自身消费面；进入则映射进自身分类体系，不按数字码硬编码 |
| 5 | 弃用面 | 对照自身实际消费的导出清单 |
| 6 | 死配置卫生 | 包管理器不再读取的 override/pin 块随手清除 |
| 7 | 触达面复检 | 对新增面做触达核对（现状/唤醒条件/预定消费点/姿态四元组），登记进消费者自己的对齐账 |

## 3. 与兼容层登记的关系

- `evidence/compatibility-register.md`：**机器校验**的兼容层登记（ID 唯一、六列非空、`pnpm verify:architecture` 把关）——回答"哪些层存在、谁负责、何时移除"。
- 本文：**沟通纪律**——回答"发布时必须说什么、消费者 bump 时必须查什么"。
- 两者互不替代；发布引入新兼容层时，本文 §1 清单与登记表各记各的。

## 4. 案例引用

- 首个深度消费者 **Palimpsest**（DSH 编排插件）已按 §2 建立对齐账：其仓库 `docs/engineering/07-ordarium-alignment.md`（演进接口清单 + 升级协议 + 诉求登记），为本核对单的首个完整实例。
- versioned Host Adapter（`COMPAT-PAL-001` 缝）交付时的首宿主 conformance 案例候选同为 Palimpsest；形状评审见 docs/17 Goal 线。——**已交付（G18，2026-08-29）**：`@ordarium/host-kit`（版本握手 + curated 适配面 + `runHostAdapterConformance`），案例协议见 docs/dev/08 与 docs/17 §16.10；姊妹仓接入后由其升级协议登记。

## 修订流水

| 日期 | 修订 |
|---|---|
| 2026-08-29 | 初版（RCP-1）：发布沟通纪律五类清单、消费者核对单七项模板、与兼容层登记的分工、首消费者案例引用。 |
| 2026-09-06 | RCP-2：Palimpsest 侧 ALN-4② 正式确认送达；`evidence/compatibility-register.md` `COMPAT-PAL-001` 关闭为**已执行（G18，2026-08-29 交付）**，缝位纪律（不预设 Palimpsest 字段/shim）延续；首宿主 conformance 案例协议成文于 [`research/palimpsest-aln4-2-confirmation-2026-09-06.md`](research/palimpsest-aln4-2-confirmation-2026-09-06.md)，姊妹仓按其升级协议接入登记。 |
| 2026-09-06 | RCP-3：ALN-4 例行复核回执落盘（[`research/palimpsest-alignment-routine-review-2026-09-06.md`](research/palimpsest-alignment-routine-review-2026-09-06.md)，对应姊妹仓 07 号 r8/r9）——①r6 文书澄清落地：charter 05 "OPERATION_UNCERTAIN 接缝待焊"记载过时标注（原文保留）；②诉求③补记动作闭环：G11 spec §10 首消费者形状反馈（append-only 主体，冻结决议零改动）+ docs/17 §16.6 指针；③发布面复核一致（tag/六 tarball/notes 五类清单），兼容登记零新触发；④两仓账面差异仅两处口径/引用项（报告 §6），无实质冲突。 |
