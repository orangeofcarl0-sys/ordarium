# 04 · dsh 集成取证与消费模式

> 2026-08-17 一次完整的"Ordarium 进 dsh"实证（安装 → 验证 → 演示 → 清理）的全部机制知识。演示插件已从 dsh 卸载，本档案保留可复用的全部结论。

## 1. dsh 插件机制（artifact-verified）

- **profile 结构**：`~/.dsh/profiles/<name>/` 下 `package.json`（`dependencies` + `dsh.profile.bundles` 数组）+ `pnpm-workspace.yaml`（`packages: [.]`、`nodeLinker: hoisted`、`autoInstallPeers: false`）+ `cordis.patch.yml`（用户 patch 层）。
- **安装**：`dsh plugin --profile <name> add <pkg>` 把参数原样转发给 profile 目录里的 pnpm（相对路径按调用目录锚定为绝对路径）；装完后 `reconcilePlugins` 依据"该依赖是否声明 `dsh.bundle`"自动增删 `dsh.profile.bundles` 条目。add/remove 需 `-w`（工作区根）。
- **bundle 合同**：包内 `dsh: { bundle: { patch: "./cordis.patch.yml" } }`；patch 是 loader 条目列表（`- insert: [{id, name}]` 等）；主入口导出 cordis 插件（`export const name` / `export const inject` / `export function apply(ctx)`）。
- **工具注册**：真实注册表是 `@deepseek-ai/dsh-tools`（cordis 服务，`ctx.tools.register(definition)`）。定义形状：`{name, description, parameters, output: {schema, render, presentationMeta?}, execute(args, exec), timeoutMs?, isConcurrencySafe?}`；执行上下文 `ToolRunContext`：`callId, rootCallId, name, arguments, agent?, parent?, signal, deferContext, concludeTurn`；register 返回 disposer；`output.schema` 过 `assertSupportedJsonSchema`（受限 JSON Schema 子集）。

## 2. @ordarium/dsh ↔ dsh-tools 桥接合同

两边形状几乎一一对应（本实证的核心发现）：

| dsh-tools（宿主侧） | @ordarium/dsh（适配器侧） |
|---|---|
| `ToolDefinition` | `DshToolDefinition` |
| `ToolRunContext`（callId/rootCallId/name/arguments/agent/parent/signal/deferContext/concludeTurn） | `DshToolRunContext`（同字段集） |
| `register(def) → disposer` | `DshPluginContext.tools.register(def) → disposer` |

桥接 = 一层透明转发：`{...definition, execute: (args, exec) => definition.execute(args, exec)}`。适配器入口：`@ordarium/dsh/advanced` 的 `createOrdariumPlugin`（ops 平面四工具 `ordarium_inspect/list/history/reconcile` 需构造时注入 `OperatorAuthorization {operator, source, grantedAt, scope}`，经 `assertOperatorAuthorization` 构造期校验——工具输入无法伪造）；`installOrdarium` 的冻结处置顺序 quiesce → unregister → close。默认授权：`{decision:"allow", kind:"host-admission", source:"dsh:tool-body-admitted"}`（文档化的非人工批准准入）。数据库默认路径 `$DSH_HOME/ordarium/operations.sqlite`。

**结论**：桥接薄到可以收进 @ordarium/dsh 发布一个原生 dsh 适配（待办候选），无需改发布面。

## 3. 消费模式（两条已验证路径 + 已知限制）

- **npm 五 tarball（CI 已证）**：`npm install <5 个 .tgz>`——npm 能从同批 tarball 解析兄弟依赖（`tools/package-consumer.mjs` 的 `test:package` 门）。
- **pnpm 工作区成员模式（本实证）**：**pnpm 无法从同批 tarball 解析兄弟依赖**（对 `@ordarium/core@1.0.0` 直奔 registry 404；overrides 也救不了）。正确做法：解包五 tarball 到目录、把包间依赖改写为 `workspace:*`（含 devDependencies！host-mcp 的 devDeps 里有 `@ordarium/dsh`）、目录加入 profile 的 `pnpm-workspace.yaml` `packages` 列表、`pnpm install --no-frozen-lockfile`。发布 tarball 本体不动，改写只发生在本地解包副本。
- **已知限制**（docs/dev/01 已载）：`pnpm add github:...#path=packages/dsh` 式单包 git 依赖不可用（包间 `workspace:*` 在 git 安装语境无法解析）。
- **engines 实测**：本机 node v24.14.1 < `>=24.15.0`（ledger-sqlite/dsh/host-mcp），pnpm 仅警告；ledger 全功能实测可用。floor 是保守下限，但宣称仍是 >=24.15.0。

## 4. 演示验证（已执行、后已清理）

桥接演示插件 `dsh-ordarium-demo`（cordis bundle：两 Action + ops 平面）：垂直切片全绿——6 工具注册（demo.echo/demo.note/ordarium_inspect/list/history/reconcile）；**幂等去重由 ledger 保证**（同一身份重放返回首次存储结果、`execute` 不重跑、外部效果文件行数不增）；新身份 → 新行；ops 工具查回脱敏视图（identity/authorization/resultRef/receipt 均不泄露）；SQLite 落库；dispose 干净。真实 dsh web 启动加载确认（boot log `[ordarium-demo] installed: 2 actions + 4 ops tools registered`）。

**清理记录**：`dsh plugin remove dsh-ordarium-demo` + bundles reconcile + workspace 成员还原 + `~/.dsh/{ordarium-demo,ordarium-pkgs,ordarium}`（含演示数据）全删。

## 5. 事故与教训（profile 运维）

清理期间 lockfile 重生成使 `dsh-background-agents` 从 0.4.0 浮到 0.6.0：其新版 bundle patch 插入与宿主层重复的 `storage` 行，当前 cordis-plugin-loader 对重复 loader entry id **致命**（0.6.0 自带注释"the later write wins per row id"已与实现不符）。处置：钉回 `dsh-background-agents@0.4.0`。**教训**：① dsh profile 的 lockfile 重生成有真实破坏面，动前先看 bundle patch 的 id 空间；② 该包 spec 仍为 `^0.4.0`，将来任何 lockfile 重生成会复发；③ 同类风险适用于 profile 内一切 `^` 浮动 spec 的插件。

## 6. 对 Ordarium 的行动项

1. 把 §2 的桥接收进 `@ordarium/dsh`（原生 dsh 适配，G 候选）；
2. docs/dev/01 增补 pnpm 工作区成员消费模式（现状只写了 npm 路径）；
3. `OperatorAuthorization` 的宿主注入示例（演示插件的四字段构造）值得进 07-operations 的代码示例。
