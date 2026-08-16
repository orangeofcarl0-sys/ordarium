import { describe, expect, it } from "vitest";

import { assertJsonValue, canonicalJson, digestJson } from "../src/index.js";

describe("lossless canonical JSON", () => {
  it("sorts object keys by stable code-unit order", () => {
    expect(canonicalJson({ z: 1, a: 2, A: 3 })).toBe('{"A":3,"a":2,"z":1}');
    expect(digestJson({ b: 1, a: 2 })).toBe(digestJson({ a: 2, b: 1 }));
  });

  it("rejects values that JSON.stringify would silently change", () => {
    expect(() => assertJsonValue(-0)).toThrow();
    const sparse: unknown[] = [];
    sparse.length = 1;
    expect(() => assertJsonValue(sparse)).toThrow();
    expect(() => assertJsonValue({ value: Number.NaN })).toThrow();
    expect(() => assertJsonValue({ [Symbol("secret")]: "hidden" })).toThrow();
  });
});
