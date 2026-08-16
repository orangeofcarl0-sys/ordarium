import { OrdariumRuntime, defineAction, defineSchema, effects } from "@ordarium/core";
import { describe, expect, it } from "vitest";

import { asDshTool, createDshOrdarium, type DshToolRunContext } from "../src/advanced.js";

const inputSchema = defineSchema<{ value: string }>(
  { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
  (value) => value as { value: string },
);
const outputSchema = defineSchema<string>({ type: "string" }, (value) => {
  if (typeof value !== "string") throw new TypeError("expected string");
  return value;
});

function context(callId = "call-1"): DshToolRunContext {
  return {
    callId,
    rootCallId: "root-1",
    name: "dsh.write",
    arguments: { value: "hello" },
    agent: { id: "agent-1", session: { id: "session-1" } },
    signal: new AbortController().signal,
  };
}

function guardedAction(name: string) {
  return defineAction({
    name,
    version: "1",
    description: "Hardening fixture",
    input: inputSchema,
    output: outputSchema,
    effect: effects.guarded(),
    execute: (input) => input.value,
  });
}

describe("DSH adapter hardening (G5)", () => {
  it("records host-provided policy-decision and human-approval evidence (A03)", async () => {
    for (const [kind, source] of [
      ["policy-decision", "dsh:policy:payments"],
      ["human-approval", "dsh:approval:42"],
    ] as const) {
      const runtime = new OrdariumRuntime({ allowVolatileLedger: true });
      const tool = asDshTool(guardedAction("dsh.evidence"), {
        runtime,
        authorize: () => ({ decision: "allow", kind, source }),
      });
      await tool.execute({ value: "hello" }, context(`${kind}-call`));
      const [record] = (await runtime.ledger.list()).records;
      expect(record?.authorization).toMatchObject({ decision: "allow", kind, source });
      await runtime.dispose();
    }
  });

  it("propagates the transient provider principal binding as a digest only (A03/binding)", async () => {
    const runtime = new OrdariumRuntime({ allowVolatileLedger: true });
    const tool = asDshTool(guardedAction("dsh.principal"), {
      runtime,
      authorize: () => ({ decision: "allow", kind: "policy-decision", source: "dsh:policy:x" }),
      providerPrincipalRef: () => ({ namespace: "tenant-1", subject: "user-a" }),
    });
    await tool.execute({ value: "hello" }, context("principal-call"));

    const [record] = (await runtime.ledger.list()).records;
    expect(record?.providerPrincipalDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(record)).not.toContain("user-a");
    expect(JSON.stringify(record)).not.toContain("tenant-1");
    await runtime.dispose();
  });

  it("lets custom renderers return host-native blocks beyond text (A07)", () => {
    const runtime = new OrdariumRuntime({ allowVolatileLedger: true });
    const tool = asDshTool(guardedAction("dsh.render"), {
      runtime,
      render: (input) => [
        { type: "resource", uri: `ordarium://runs/${input.value}`, mimeType: "text/plain" },
      ],
    });
    const blocks = tool.output.render({ value: "hello" }, "hello");
    expect(blocks).toEqual([
      { type: "resource", uri: "ordarium://runs/hello", mimeType: "text/plain" },
    ]);

    const textTool = asDshTool(guardedAction("dsh.render-text"), { runtime });
    expect(textTool.output.render({ value: "hello" }, "hello")).toEqual([
      { type: "text", text: "hello" },
    ]);
  });

  it("carries the session recovery material binding for G4 reconcileOnly (deliverable)", async () => {
    const material: Record<string, unknown> = { "call-9": { value: "hello" } };
    const ordarium = createDshOrdarium({
      runtime: new OrdariumRuntime({ allowVolatileLedger: true }),
      recoveryMaterial: (invocation) => material[invocation.callId],
    });
    expect(ordarium.recoveryMaterial).toBeDefined();
    await expect(
      (ordarium.recoveryMaterial as (i: { callId: string; source: string; scope: string }) => unknown)({
        callId: "call-9", source: "dsh", scope: "s",
      }),
    ).toEqual({ value: "hello" });
    await ordarium.close();
  });
});
