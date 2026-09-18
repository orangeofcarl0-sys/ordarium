# 16 · Architecture atlas

这里是当前架构的视觉投影。

规范语义见 [13](13-ordarium-action-contract.md)，完整文字说明见 [15](15-ordarium-complete-architecture.md)。

## 1. Product boundary

```mermaid
flowchart LR
  H[Host / Harness] -->|HostInvocation| O[Ordarium Runtime]
  O --> L[OperationLedger]
  O -->|execute / reconcile / cancel| P[Provider]
  H --> S[StateStore]
  S --> L
  L --> C[StateChangeFeed]
  H --> C
```

## 2. Package topology

```mermaid
flowchart TD
  CORE["@ordarium/core"]
  SQL["@ordarium/ledger-sqlite"]
  TEST["@ordarium/testing"]
  KIT["@ordarium/host-kit"]
  MCP["@ordarium/host-mcp"]
  DSH["@ordarium/dsh (legacy)"]

  SQL --> CORE
  TEST --> CORE
  KIT --> CORE
  KIT --> TEST
  MCP --> CORE
  MCP --> SQL
  DSH --> CORE
  DSH --> SQL
```

## 3. Operation lifecycle

```mermaid
stateDiagram-v2
  [*] --> proposed
  proposed --> authorized: allow
  proposed --> denied: deny
  authorized --> claimed
  claimed --> dispatched
  dispatched --> succeeded
  dispatched --> failed
  dispatched --> uncertain
  authorized --> cancelled
  uncertain --> claimed: recovery takeover
  claimed --> reconciled: recovery evidence
  claimed --> dispatched: safe same-key redispatch
```

## 4. Recovery decision

```mermaid
flowchart TD
  U[dispatched / uncertain] --> C[claim]
  C --> R{reconcile available?}
  R -->|yes| Q[query Provider]
  Q --> E{evidence}
  E -->|succeeded| S[succeed]
  E -->|failed| F[fail]
  E -->|pending / unknown| X[uncertain]
  E -->|absent + retrySafe| K{normal mode + key valid?}
  R -->|no| K
  K -->|yes| D[redispatch same key]
  K -->|no| X
```

## 5. Authorization boundaries

```mermaid
flowchart LR
  HP[Host policy / human / admission] --> AD[AuthorizationDecision]
  AD --> RT[Runtime]
  RT --> OP[Durable Operation]

  OA[Trusted operator surface] --> OAUTH[OperatorAuthorization]
  OAUTH --> OPS[Operations API]

  AD -. separate .- OAUTH
```

## 6. State & refs

```mermaid
flowchart TD
  W[State write] --> CAS{expectedRevision matches?}
  CAS -->|no| RC[STATE_REVISION_CONFLICT]
  CAS -->|yes| REF{refs exist?}
  REF -->|no| RN[STATE_REF_NOT_FOUND]
  REF -->|yes| REV[commit revision n+1]
  REV --> FEED[append change position]
```

## 7. Host seam

```mermaid
flowchart LR
  HT[Host tool call] --> MAP[Leaf adapter]
  MAP --> ID[InvocationIdentity]
  MAP --> AU[AuthorizationDecision?]
  MAP --> PR[ProviderPrincipalRef?]
  MAP --> SG[AbortSignal?]

  ID --> PORT[HostInvocationPort]
  AU --> PORT
  PR --> PORT
  SG --> PORT

  PORT --> CORE[OrdariumRuntime]
```

## 8. Data ownership

```mermaid
flowchart TB
  HOST[Host semantics]
  CORE[Ordarium mechanics]
  PROVIDER[External business truth]

  HOST -->|Action / state meaning| CORE
  CORE -->|dispatch / query| PROVIDER
  PROVIDER -->|external evidence| CORE
```

## 9. Version axes

```mermaid
flowchart LR
  SEMVER[Package semver 1.3.2]
  HOSTV[HOST_CONTRACT_VERSION 1]
  SQLV[SQLite user_version 4]
  OPV[OperationRecord schema 2]
  STATEV[StateRecord schema 1]

  SEMVER --- HOSTV
  SEMVER --- SQLV
  SEMVER --- OPV
  SEMVER --- STATEV
```

这里的连线表示“有关联但独立版本化”，不是“必须一起 bump”。
