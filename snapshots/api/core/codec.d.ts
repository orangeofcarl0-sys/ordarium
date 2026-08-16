import type { OperationRecord } from "./types.js";
/**
 * The single complete OperationRecord codec owned by @ordarium/core
 * (docs/17 §9.2.5). TypeScript shape, runtime decode, length limits and
 * cross-state invariants have exactly one source: this module. Ledger
 * implementations (memory, SQLite, custom) must decode through it and never
 * grow their own validators.
 */
export declare const RESOURCE_LIMITS: Readonly<{
    maxOperationIdLength: 64;
    maxActionNameLength: 128;
    maxActionVersionLength: 64;
    maxDigestLength: 64;
    maxIdentityFieldLength: 256;
    maxLineageEntries: 64;
    maxSourceLength: 256;
    maxReasonLength: 4096;
    maxSafeErrorCodeLength: 128;
    maxSafeErrorMessageLength: 4096;
    maxInputJsonBytes: 1048576;
}>;
/**
 * Decode and fully validate an OperationRecord. Any nested field damage,
 * oversized metadata or violated cross-state invariant throws a TypeError,
 * so ledger reads fail closed before a Provider can be called on a corrupt
 * record (G1-A06).
 */
export declare function decodeOperationRecord(value: unknown): OperationRecord;
//# sourceMappingURL=codec.d.ts.map