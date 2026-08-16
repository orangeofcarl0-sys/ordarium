# G8 Design Spec：发布后扩展与 Palimpsest 缝（冻结）

> 依据：`ORDARIUM-GOALS-3`（docs/17 §16）、docs/12 §9、docs/15 §13/§16.3。
> 性质：G8 不阻塞首发（第二宿主 host-mcp 已在 G5 交付）；本文件冻结发布后的扩展合同，避免届时重新审议。

## 0. 当前落点（预期 G7 出口）

host-mcp 已作为第二宿主运行；HostInvocationPort + 宿主 conformance harness 已双重证明中立性。

## 1. 更多宿主叶包

- 每个新宿主 = 一个独立叶包（依赖仅 core + 默认 ledger + 该宿主协议 SDK），复用 `HostAdapterHarness` conformance；
- 验收不变式：**新增/替换 adapter 不改 core/Action 合同**；若某宿主迫使 core 增加 host-specific 字段 → 判定 HostInvocationPort 不完整，修 port 而非加宿主分支（docs/17 §16）；
- 叶包之间禁止横向依赖；verify allowlist 按叶包规则扩展。

## 2. Provider adapter 生态

- 真实 adapters 优先作为小型独立集成/recipes；出现 ≥3 个稳定实现后再评估抽公共 helper（不预建）；
- 每个发布 adapter 必须附带 `ProviderCapabilityDeclaration` + G6 conformance 证据；credential-gated 的真实 Provider 提供 sandbox evidence，不进确定性 gate。

## 3. Operator UX

- 按 adoption 改善 inspect/reconcile 的宿主呈现（CLI/面板由宿主拥有，Ordarium 只保 API）；
- 不扩大为通用控制平面、不新增 daemon。

## 4. Palimpsest 缝（versioned Host Adapter only）

- 触发条件：Palimpsest Runtime 稳定重构完成并真实需要调用 Ordarium Action；
- 形态：`@ordarium/host-palimpsest`（或宿主侧 adapter）实现 HostInvocationPort——提供稳定 identity、分类 evidence、signal、recovery material；语义为"已授权副作用的 invocation 消费 terminal/uncertain 结果"（docs/14 §5）；
- 禁止：core 读取 Palimpsest Event Store、Palimpsest 写 Ordarium 内部表、任何内部模块耦合（两线只经显式版本化 adapter 相连）；
- Python 侧经宿主进程边界（子进程/RPC 由该 adapter 拥有）进入 Node 端口，core 不感知语言。

## 5. 远程 Authority（仅在真实多主机需求后立项）

- 立项条件：多主机共同执行同一 operation 的真实采用证据；
- 届时替换的是 Ledger/claim 实现（authority-controlled time + ACL ledger），Host/Action API 不变；在此之前不为假想需求加 daemon。

## 6. 验收

| 场景 | 通过条件 |
|---|---|
| 新宿主接入 | 仅新增叶包 + conformance 绿；core 快照零变化 |
| provider recipes | 声明 + conformance 证据齐备 |
| Palimpsest 缝 | adapter-only，无内部依赖；`COMPAT-PAL-001` 复核 |
| 远程形态提案 | 以采用证据立项，API 兼容性论证先行 |
