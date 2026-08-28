# Delta G11-002:1.1.0 发布线决议与合同收尾

- 变更分类(docs/17 §7.2):**A 内部等价**(版本元数据 1.0.0→1.1.0,零 API/语义变化)+ 合同表述补全(docs/13 §11 一条拒绝性条款,不新增原语)+ 登记册勘误(COMPAT-DB-001 描述)
- 依据:COMPAT-API-001 的 semver 纪律("发布后按 semver 承担外部兼容");2026-08-29 会话决议(继续执行 G11 后续收尾清单)

## 决议内容

1. **1.1.0 发布线**:G11 是 1.0.0 之后的首个 minor 加法合同(B 类);main 的五包 public API 已超出已发布的 `ordarium-v1.0.0` tarball,按 semver 必须以 minor 版本分叉。五包与 workspace 版本统一 bump 至 `1.1.0`;下一个分发锚为 git tag `ordarium-v1.1.0` + 同名 GitHub Release(五 tarball),随下一次分发执行。
2. **操作间依赖边(把拒绝写进合同)**:02 §4 遗留的两个语义缺口中,"知识层"已由 G11 state kind 解决;"操作间依赖图"决议为**不加原语**——op→op 依赖经管理型 state record 的 refs(state→operation)表达,record v2 合同零改动。条款落 docs/13 §11。
3. **COMPAT-DB-001 勘误**:canonical target 由固定 "`user_version=2`" 更新为"当前 schema 版本(滚动)",移除条件补记 G11-002 的 v2→v3 纯增表路径。机器校验六列非空,内容勘误属人类可读面。

## 影响面

无 public API / record schema / 语义 / 宿主映射 / Provider capability 变化;快照中 `packages[*].version` 字段随 bump 更新(机器可校验的诚实漂移)。

## 证明测试

`pnpm verify:release` 六门(check / architecture / integration / conformance / docs / package)全绿;`test:package` 以新版本号重打五 tarball 并验证互依赖自洽。
