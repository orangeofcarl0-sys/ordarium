import {
  MemoryLedger,
  OrdariumRuntime,
  SimulatedProcessCrash,
  UncertainOperationError,
  defineAction,
  defineSchema,
  effects,
  type JsonValue,
  type OperatorAuthorization,
  type ReconcileResult,
} from "@ordarium/core";
import { describe, expect, it } from "vitest";

import {
  createOrdariumPlugin,
  type DshToolDefinition,
  type DshToolRunContext,
} from "../src/advanced.js";

const inputSchema = defineSchema<{ sku: string }>(
  { type: "object", properties: { sku: { type: "string" } }, required: ["sku"] },
  (value) => value as { sku: string },
);
const outputSchema = defineSchema<string>({ type: "string" }, (value) => {
  if (typeof value !== "string") throw new TypeError("expected string");
  return value;
});

function context(callId: string): DshToolRunContext {
  return {
    callId,
    rootCallId: "root-1",
    name: "plugin.action",
    arguments: { sku: "a" },
    agent: { id: "agent-1", session: { id: "session-1" } },
    signal: new AbortController().signal,
  };
}

function registry() {
  const registered: DshToolDefinition<JsonValue, JsonValue>[] = [];
  return {
    registered,
    pluginContext: {
      tools: {
        register(definition: DshToolDefinition<JsonValue, JsonValue>) {
          registered.push(definition);
          return () => {
            const index = registered.indexOf(definition);
            if (index >= 0) registered.splice(index, 1);
          };
        },
      },
    },
  };
}

function reconcilableAction(executions: { count: number }, outcome: () => ReconcileResult<string>) {
  return defineAction({
    name: "plugin.reserve",
    version: "1",
    description: "Plugin fixture",
    input: inputSchema,
    output: outputSchema,
    effect: effects.reconcilable(),
    execute: (input) => {
      executions.count += 1;
      throw new SimulatedProcessCrash();
    },
    reconcile: () => outcome(),
  });
}

const reader: OperatorAuthorization = {
  operator: "op-1",
  source: "dsh:operator-command",
  grantedAt: "2026-01-01T00:00:00.000Z",
};
const reconciler: OperatorAuthorization = { ...reader, scope: "operations:reconcile" };

function pluginOver(
  options: { operations?: { authorization: OperatorAuthorization } } = {},
): { ledger: MemoryLedger; plugin: ReturnType<typeof createOrdariumPlugin>; runtime: OrdariumRuntime } {
  const ledger = new MemoryLedger();
  const runtime = new OrdariumRuntime({ ledger, allowVolatileLedger: true });
  const plugin = createOrdariumPlugin({ runtime, ...options });
  return { ledger, plugin, runtime };
}

function executeTool(
  plugin: ReturnType<typeof createOrdariumPlugin>,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const registry_ = registry();
  plugin.register(registry_.pluginContext, []);
  const tool = registry_.registered.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`tool not registered: ${name}`);
  return tool.execute(args as never, context("ops-call"));
}

describe("Ordarium DSH plugin shell (G9)", () => {
  it("G9-A01: owns a shared instance; a second consumer reuses the same ledger", async () => {
    const { plugin, ledger } = pluginOver();
    const executions = { count: 0 };
    const action = defineAction({
      name: "plugin.reserve",
      version: "1",
      description: "Plugin fixture",
      input: inputSchema,
      output: outputSchema,
      effect: effects.guarded(),
      execute: (input) => {
        executions.count += 1;
        return input.sku;
      },
    });
    const first = registry();
    plugin.register(first.pluginContext, [action]);
    await first.registered[0]!.execute({ sku: "a" }, context("c1"));

    // A second registration over the same plugin shares the ledger: the same
    // business call converges onto one operation.
    const second = registry();
    plugin.register(second.pluginContext, [action]);
    await second.registered[0]!.execute({ sku: "a" }, context("c1"));
    expect(executions.count).toBe(1);
    expect((await ledger.list()).records).toHaveLength(1);
    await plugin.close();
  });

  it("G9-A02: without the operations option no ordarium_* tools exist and ops stays undefined", () => {
    const { plugin } = pluginOver();
    expect(plugin.ops).toBeUndefined();
    const reg = registry();
    plugin.register(reg.pluginContext, []);
    expect(reg.registered.some((tool) => tool.name.startsWith("ordarium_"))).toBe(false);
  });

  it("G9-A03: operations register the four tools returning sanitized model views", async () => {
    const { plugin, ledger } = pluginOver({ operations: { authorization: reader } });
    expect(plugin.ops).toBeDefined();
    const executions = { count: 0 };
    const action = reconcilableAction(executions, () => ({ status: "pending" }));
    const reg = registry();
    plugin.register(reg.pluginContext, [action]);
    await expect(reg.registered[0]!.execute({ sku: "a" }, context("c1")))
      .rejects.toMatchObject({ code: "SIMULATED_PROCESS_CRASH" });

    const names = reg.registered.filter((tool) => tool.name.startsWith("ordarium_")).map((t) => t.name);
    expect(names.sort()).toEqual([
      "ordarium_history", "ordarium_inspect", "ordarium_list", "ordarium_reconcile",
    ]);

    const [record] = (await ledger.list()).records;
    const inspected = await executeTool(plugin, "ordarium_inspect", { operationId: record!.operationId });
    const view = (inspected as { view: Record<string, unknown> }).view;
    expect(Object.keys(view).sort()).toEqual([
      "actionName", "actionVersion", "attempts", "effectKind",
      "operationId", "state", "updatedAt",
    ]);

    const listed = await executeTool(plugin, "ordarium_list", { actionName: "plugin.reserve" });
    expect((listed as { views: unknown[] }).views).toHaveLength(1);
    await plugin.close();
  });

  it("G9-A04: the authorization boundary holds at construction and in ops calls", async () => {
    expect(() => createOrdariumPlugin({
      runtime: new OrdariumRuntime({ ledger: new MemoryLedger(), allowVolatileLedger: true }),
      operations: { authorization: { ...reader, scope: "operations:everything" } as never },
    }));

    const readOnly = pluginOver({ operations: { authorization: reader } });
    const executions = { count: 0 };
    const action = reconcilableAction(executions, () => ({ status: "pending" }));
    const reg2 = registry();
    readOnly.plugin.register(reg2.pluginContext, [action]);
    // The reconcile tool exists (registration-level grant) but the scope gate
    // lives in the ops boundary the host command uses.
    await expect(
      readOnly.plugin.ops!.reconcileOnly({
        action,
        input: { sku: "a" },
        identity: { source: "dsh", scope: "session-1", callId: "c1" },
      }),
    ).rejects.toMatchObject({ code: "OPERATOR_AUTHORIZATION_REQUIRED" });
    await readOnly.plugin.close();
  });

  it("G9-A05: reconcile resolves from provider facts and fail-closes on mismatched material", async () => {
    const { plugin, ledger } = pluginOver({ operations: { authorization: reconciler } });
    const executions = { count: 0 };
    const action = reconcilableAction(executions, () => ({ status: "succeeded", value: "reserved:a" }));
    const reg = registry();
    plugin.register(reg.pluginContext, [action]);
    await expect(reg.registered[0]!.execute({ sku: "a" }, context("c1")))
      .rejects.toMatchObject({ code: "SIMULATED_PROCESS_CRASH" });

    const viaTool = await executeTool(plugin, "ordarium_reconcile", {
      actionName: "plugin.reserve",
      input: { sku: "a" },
      source: "dsh",
      scope: "session-1",
      callId: "c1",
    }) as { resolved?: string; error?: string };
    expect(viaTool.resolved).toBe("reserved:a");
    const [record] = (await ledger.list()).records;
    expect(record?.state).toBe("reconciled");

    // Mismatched material fail-closes with a stable conflict and no provider call.
    const mismatch = await executeTool(plugin, "ordarium_reconcile", {
      actionName: "plugin.reserve",
      input: { sku: "WRONG" },
      source: "dsh",
      scope: "session-1",
      callId: "c1",
    }) as { error?: string };
    expect(mismatch.error).toBe("OPERATION_CONFLICT");
    await plugin.close();
  });

  it("G9-A05b: authoritative absence never executes through the reconcile tool", async () => {
    const { plugin, ledger } = pluginOver({ operations: { authorization: reconciler } });
    const executions = { count: 0 };
    const action = reconcilableAction(executions, () => ({ status: "absent", retrySafe: true } as ReconcileResult<string>));
    const reg = registry();
    plugin.register(reg.pluginContext, [action]);
    await expect(reg.registered[0]!.execute({ sku: "a" }, context("c1")))
      .rejects.toMatchObject({ code: "SIMULATED_PROCESS_CRASH" });
    const executionsAfterCrash = executions.count;

    const result = await executeTool(plugin, "ordarium_reconcile", {
      actionName: "plugin.reserve",
      input: { sku: "a" },
      source: "dsh",
      scope: "session-1",
      callId: "c1",
    }) as { error?: string };
    expect(result.error).toBe("OPERATION_UNCERTAIN");
    expect((await ledger.list()).records[0]?.state).toBe("uncertain");
    expect(executions.count).toBe(executionsAfterCrash); // execute spy stayed at zero.
    await plugin.close();
  });

  it("G9-A06: dispose follows the frozen lifecycle to closed", async () => {
    const { plugin } = pluginOver({ operations: { authorization: reader } });
    await plugin.dispose();
    expect(plugin.runtime.lifecycle).toBe("closed");
    const action = defineAction({
      name: "plugin.reserve",
      version: "1",
      description: "Plugin fixture",
      input: inputSchema,
      output: outputSchema,
      effect: effects.readOnly(),
      execute: (input) => input.sku,
    });
    await expect(action.run(plugin.runtime, { sku: "a" }, { identity: { source: "t", scope: "s", callId: "c" } }))
      .rejects.toMatchObject({ code: "RUNTIME_CLOSED" });
  });

  it("uncertain stays visible to the honest operator path (regression)", async () => {
    const { plugin } = pluginOver({ operations: { authorization: reconciler } });
    const executions = { count: 0 };
    const action = reconcilableAction(executions, () => ({ status: "unknown" }));
    const reg = registry();
    plugin.register(reg.pluginContext, [action]);
    await expect(reg.registered[0]!.execute({ sku: "a" }, context("c1")))
      .rejects.toMatchObject({ code: "SIMULATED_PROCESS_CRASH" });

    const inspect = await plugin.ops!.inspect((await plugin.runtime.ledger.list()).records[0]!.operationId);
    expect(inspect?.state).toBe("dispatched");
    expect(inspect?.identity).toMatchObject({ source: "dsh", rootCallId: "root-1" });
    await expect(
      plugin.ops!.reconcileOnly({
        action,
        input: { sku: "a" },
        identity: { source: "dsh", scope: "session-1", callId: "c1" },
      }),
    ).rejects.toBeInstanceOf(UncertainOperationError);
    await plugin.close();
  });
});
