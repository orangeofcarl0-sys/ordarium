import type { OperationRecord, StateRecord } from "./types.js";
/**
 * The single complete OperationRecord codec owned by @ordarium/core
 * (docs/17 §9.2.5, G2 design spec §1). TypeScript shape, runtime decode,
 * length limits and cross-state invariants have exactly one source: this
 * module. Ledger implementations (memory, SQLite, custom) must decode
 * through it and never grow their own validators. Only schemaVersion 2 is
 * accepted; v1 shapes exist solely at the SQLite migration boundary.
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
    maxStateSubjectLength: 128;
    maxStateRefs: 64;
    maxStateValueJsonBytes: 1048576;
    /**
     * Ceiling for one state-change page (ORD-BOOT-0.1). The default page size is
     * 100; this is a fixed 10x envelope that keeps a single observation call from
     * materializing an unbounded number of records. Per-item payload stays
     * independently capped by maxStateValueJsonBytes.
     */
    maxStateChangePageItems: 1000;
}>;
/**
 * Decode and fully validate an OperationRecord. Any nested field damage,
 * oversized metadata or violated cross-state invariant throws a TypeError,
 * so ledger reads fail closed before a Provider can be called on a corrupt
 * record (G1-A06).
 */
export declare function decodeOperationRecord(value: unknown): OperationRecord;
/**
 * Encode a state revision reference id (G11 design spec §1). Namespace and
 * key characters are restricted by STATE_SUBJECT, so the encoding is
 * unambiguous and always parseable.
 */
export declare function encodeStateRefId(namespace: string, key: string, revision: number): string;
/**
 * Parse a "namespace/key@revision" state reference id. Returns undefined for
 * any id that is not a canonically encoded, resolvable subject revision.
 */
export declare function parseStateRefId(id: string): {
    namespace: string;
    key: string;
    revision: number;
} | undefined;
/**
 * Decode and fully validate a StateRecord (G11 design spec §1). One codec,
 * one source of shape truth: identity and authorization reuse the operation
 * decoders, and the valueDigest is re-derived from the value so any persisted
 * corruption fails closed at the ledger boundary instead of surfacing as
 * silently altered management state.
 */
export declare function decodeStateRecord(value: unknown): StateRecord;
//# sourceMappingURL=codec.d.ts.map