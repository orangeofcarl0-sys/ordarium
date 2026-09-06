# Delta ARCH-002：包内文件内聚微整（A 内部等价）

- 变更分类(docs/17 §7.2):**A 内部等价**——纯文件移动 + 参数穿线,零 API/语义/行为变化
- 依据:2026-09-07 会话决议(S1+S2 代码质量切片;全仓质量分析结论"非屎山,两个千行文件做内聚微整",反优化清单明令不拆类/不动 codec/不动 façade)

## 目标结构与理由

1. **core `runtime-guards.ts`(新)**:runtime.ts 的模块级私有断言器群(约 150 行纯函数:directIdentity/principalDigestOf/assertProviderPrincipalRef/AUTHORIZATION_EVIDENCE_KINDS/assertInvocationIdentity/assertAuthorizationDecision/assertSafeError)迁出——纯守卫与状态机分离;包内导出,不进 index 公共面,消费者不可见。runtime.ts 1203→1104 行。
2. **ledger-sqlite `migrations.ts`(新)**:schema 真相层(DDL/createSchema/v1 边界变换器 transformV1Record+assertV1Record/v1→v3 重建迁移/v2→v3 纯增迁移,约 300 行)自 ledger 类迁出,db 句柄作参数穿线;`LEDGER_SCHEMA_VERSION` 常量随迁(单一真源)。**错误映射留在 index**——迁移体抛裸错误,类侧薄包装层持有 rollback 与稳定错误族映射(避免 migrations→index 循环依赖);BUSY 照旧穿越进打开重试环(G16),非 BUSY 照旧 fail-closed。index.ts 1049→830 行。

## 影响面

- **公共合同面零变化**:两包 index.d.ts 导出面逐字节不变(迁出符号全部模块私有);root façade 零漂移;错误码/union 全不动。
- **快照文件集漂移(本 delta 声明的全部漂移)**:
  1. 新增 `snapshots/api/core/runtime-guards.d.ts` 与 `snapshots/api/ledger-sqlite/migrations.d.ts`——verify-architecture 按"构建出的每个声明文件"收录,文件移动必然新增文件集条目;既有快照条目内容不变;
  2. `snapshots/contracts.json` 的 `relativeImportCount` 计数:core 12→13、ledger-sqlite 0→1——文件拆分的机器可观察计数,语义零含义。
- **sqlite-v3.json 零漂移**:DDL 模板字面量的缩进逐格还原(模块函数体比类方法浅一层,首次重生成时基线 8 行 DDL 文本漂移——已修复并核证归零;SQLite 将 DDL 文本逐字节存入 sqlite_master,缩进即基线)。
- 行为面:零——测试套件零改动、33 文件/179 用例原样全绿(pnpm check 实测)。

## 过程记录(诚实档案)

首次 `snapshots:update` 曾暴露两处与初版 delta 声明不符的漂移,均已归位或补声明:(1) sqlite-v3 DDL 缩进漂移——根因是模板字面量缩进随文件迁移变浅,修复方式是**恢复 DDL 原始缩进**而非改基线;(2) contracts.json relativeImportCount——初版声明"零漂移"失准,补入本 delta 声明。

## 旧调用/旧数据的转换位置

无数据转换、无 schema 变更、无导出变化。迁移的 BEGIN/COMMIT 时序逐语句保持(migrations 体即原 try 体;rollback+映射在包装层照旧先 rollback 后映射)。

## 旧路径删除时点

随本 delta 即时:原类方法与模块函数删除,无开关、无委托桩、无兼容层。

## 证明测试

- `pnpm run build` 绿;`pnpm check` 33 文件/179 用例全绿且**零测试改动**;
- `pnpm verify:architecture`(快照文件集漂移仅限本 delta 列面);
- `pnpm verify:matrix` 双腿复跑(新文件布局的干净环境认证,记录于提交后)。
