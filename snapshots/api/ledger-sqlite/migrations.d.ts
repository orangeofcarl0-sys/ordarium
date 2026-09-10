/**
 * Schema truth and forward migrations for the SQLite ledger (internal
 * cohesion, 2026-09-07): the DDL, the private-v1 boundary transform and the
 * v1→v3 / v2→v3 transactional migrations. Migration bodies throw raw
 * errors on any failure; the ledger class owns the transaction rollback and
 * the stable error-family mapping at the call site, so this module stays
 * free of the failure-mapping dependency and never imports back into the
 * ledger module.
 */
import { DatabaseSync } from "node:sqlite";
export declare const LEDGER_SCHEMA_VERSION = 4;
export declare function createSchema(db: DatabaseSync): void;
/**
 * One-shot transactional forward migration from the private v1 layout
 * (G2 design spec §3, G2-A01/A02): read every v1 record, transform it at
 * this boundary, validate through the current core codec, rebuild all
 * three tables and bump user_version. Throws raw on any failure — the
 * caller rolls the database back to its intact v1 state and maps the
 * error family.
 */
export declare function migrateFromV1(db: DatabaseSync): void;
/**
 * Additive v2 -> current migration (G11 design spec §4, extended by
 * ORD-BOOT-0): the state kind and the change-feed ordering table only add
 * tables and indexes, so no existing row is touched. Throws raw on any
 * failure — the caller rolls the database back to its intact v2 state.
 */
export declare function migrateFromV2(db: DatabaseSync): void;
/**
 * Additive v3 -> v4 migration (ORD-BOOT-0 spec §7). v3 recorded no global
 * commit order, so the feed cannot recover it: existing revisions receive a
 * deterministic synthetic position in (namespace, key, revision) order,
 * explicitly labelled as migration order rather than original commit order.
 * From v4 on, every new commit carries the real durable database order.
 * Throws raw on any failure — the caller rolls the database back to its
 * intact v3 state.
 */
export declare function migrateFromV3(db: DatabaseSync): void;
//# sourceMappingURL=migrations.d.ts.map