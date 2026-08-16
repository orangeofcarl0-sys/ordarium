// Compile-only probe against the packed tarballs (tools/package-consumer.mjs).
import {
  OrdariumRuntime,
  defineAction,
  defineSchema,
  effects,
  type Action,
  type EffectProfile,
  type HostInvocation,
  type OperationRecord,
  type OperationView,
  type ProviderPrincipalRef,
} from "@ordarium/core";
import { SqliteLedger } from "@ordarium/ledger-sqlite";
import {
  defineAction as defineActionFromRoot,
  effects as effectsFromRoot,
  installOrdarium,
  type DshOrdarium,
} from "@ordarium/dsh";
import { asDshTool, type DshActionOptions } from "@ordarium/dsh/advanced";
import { createMcpOrdarium } from "@ordarium/host-mcp";
import { HostAdapterHarness } from "@ordarium/testing";

const schema = defineSchema({ type: "string" }, (value) => {
  if (typeof value !== "string") throw new TypeError("expected string");
  return value;
});

const guarded: Action<string, string> = defineAction({
  name: "probe.guarded",
  version: "1",
  description: "declarations probe",
  input: schema,
  output: schema,
  effect: effects.guarded(),
  execute: (input: string) => input,
});

const runtime = new OrdariumRuntime({ ledger: new SqliteLedger(":memory:") });
const invocation: HostInvocation = {
  identity: { source: "probe", scope: "smoke", callId: "c1" },
  authorization: { decision: "allow", kind: "policy-decision", source: "probe" },
};
const principal: ProviderPrincipalRef = { namespace: "tenant", subject: "user" };

void (async () => {
  await runtime.invoke(guarded, "work", { ...invocation, providerPrincipalRef: principal });
  const tool = asDshTool(guarded, { runtime } satisfies Partial<DshActionOptions<string, string>>);
  void tool.name;
  const mcp = createMcpOrdarium({
    runtime,
    actions: [guarded as unknown as Action<import("@ordarium/core").JsonValue, import("@ordarium/core").JsonValue>],
  });
  await mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  await mcp.stop();
  const harness = new HostAdapterHarness(runtime);
  await harness.invoke(guarded, "work", invocation);
  void effectsFromRoot.readOnly();
  void (defineActionFromRoot satisfies typeof defineAction);
  void (null as unknown as DshOrdarium | undefined);
  void (null as unknown as OperationView | undefined);
  void (null as unknown as OperationRecord | undefined);
  void (null as unknown as ReturnType<typeof installOrdarium> | undefined);
  await runtime.dispose();
})();
