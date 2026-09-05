# Delta G18-002:1.2.0 发布线决议与合同表述对齐

- 变更分类(docs/17 §7.2):**A 内部等价**(版本元数据 1.1.0→1.2.0 六包,零 API/语义变化)+ 合同表述对齐(docs/13 §11 一处处置框架标注更新,内核合同面零改动)
- 依据:COMPAT-API-001 的 semver 纪律("发布后按 semver 承担外部兼容");G18 交付(commit `cd078a8`)后首个 minor 分叉点

## 决议内容

1. **1.2.0 发布线**:G18 是 1.1.0 之后的 minor 加法合同(新叶包 `@ordarium/host-kit` + core 版本协商三件套 + 错误码 `HOST_CONTRACT_MISMATCH` + testing 可移植 runner——全部纯增,零既有行为变更、零弃用面),按 semver 以 minor 版本分叉。六包与 workspace 版本统一 bump 至 `1.2.0`;分发锚为 git tag `ordarium-v1.2.0` + 同名 GitHub Release(六 tarball),release notes 按 docs/18 §1 五类清单披露(④新错误码 `HOST_CONTRACT_MISMATCH` + 新包面;①②③⑤无)。
2. **docs/13 §11 处置框架对齐**:G11-002 曾把"操作间依赖图"决议为"把拒绝写进合同";同日后续会话决议改为**冻结休眠 spec**(G17,"边即管理型 state record" + `planDependencyCascade` 纯函数,触发即实施),并经用户复核确认。本 delta 更新 §11 条款的处置标注并指向 G17 spec——其技术内核(内核不加边原语、跨 operation 依赖经 state refs 表达、record v2 零改动)不变,G17 触发后新增的是约定层与纯函数助手,仍不构成内核合同面的第二套边机制。

## 影响面

无 public API / record schema / 语义 / 宿主映射 / Provider capability 变化;快照中 `packages[*].version` 字段随 bump 更新(机器可校验的诚实漂移,即本 delta 声明的全部快照漂移)。

## 证明测试

`pnpm verify:release --with-matrix` 七门(check / architecture / integration / conformance / docs / package / node-matrix)全绿;`test:package` 以 1.2.0 重打六 tarball 并验证互依赖自洽与 host-kit 消费面。
