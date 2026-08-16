import { decodeOperationRecord } from "./codec.js";
import type {
  ClaimRequest,
  LiveLease,
  OperationEvent,
  OperationEventPage,
  OperationLedger,
  OperationListFilter,
  OperationPage,
  OperationRecord,
} from "./types.js";

const DEFAULT_PAGE_LIMIT = 100;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function encodeCursor(payload: Record<string, string>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): Record<string, string> {
  const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Opaque operation cursor is invalid");
  }
  return parsed as Record<string, string>;
}

function decodeListCursor(cursor: string): { u: string; o: string } {
  const parsed = decodeCursor(cursor);
  if (typeof parsed.u !== "string" || typeof parsed.o !== "string") {
    throw new TypeError("Opaque operation list cursor is invalid");
  }
  return { u: parsed.u, o: parsed.o };
}

function decodeHistoryCursor(cursor: string): number {
  const parsed = decodeCursor(cursor);
  const revision = Number(parsed.r);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError("Opaque operation history cursor is invalid");
  }
  return revision;
}

/**
 * Volatile single-isolate ledger implementing the full v2 port contract
 * (G2 design spec §2): semantic CAS, atomic claim+lease, lightweight lease
 * renewal that never touches semantic state, and opaque cursor pagination.
 */
export class MemoryLedger implements OperationLedger {
  readonly capabilities = {
    durability: "volatile",
    coordination: "single-isolate",
    semanticCas: true,
    liveLease: true,
    semanticHistory: true,
  } as const;

  readonly #records = new Map<string, OperationRecord>();
  readonly #events = new Map<string, OperationEvent[]>();
  readonly #leases = new Map<string, LiveLease>();
  #leaseRevisions = new Map<string, number>();
  #clock: () => Date;

  constructor(options: { clock?: (() => Date) | undefined } = {}) {
    this.#clock = options.clock ?? (() => new Date());
  }

  async get(operationId: string): Promise<OperationRecord | undefined> {
    const record = this.#records.get(operationId);
    return record === undefined ? undefined : clone(decodeOperationRecord(record));
  }

  async create(record: OperationRecord): Promise<{ created: boolean; record: OperationRecord }> {
    const current = this.#records.get(record.operationId);
    if (current !== undefined) {
      return { created: false, record: clone(decodeOperationRecord(current)) };
    }
    const saved = clone(decodeOperationRecord(record));
    this.#records.set(record.operationId, saved);
    this.#events.set(record.operationId, [this.#event(saved)]);
    return { created: true, record: clone(saved) };
  }

  async compareAndSet(
    operationId: string,
    expectedRevision: number,
    next: OperationRecord,
  ): Promise<boolean> {
    const current = this.#records.get(operationId);
    if (
      current === undefined ||
      current.semanticRevision !== expectedRevision ||
      next.operationId !== operationId ||
      next.semanticRevision !== expectedRevision + 1
    ) {
      return false;
    }
    const lease = this.#leases.get(operationId);
    if (lease !== undefined && lease.fencingToken !== next.lastFencingToken) {
      return false;
    }
    const saved = clone(decodeOperationRecord(next));
    this.#records.set(operationId, saved);
    const events = this.#events.get(operationId) ?? [];
    events.push(this.#event(saved));
    this.#events.set(operationId, events);
    if (saved.claim === undefined) {
      this.#leases.delete(operationId);
    }
    return true;
  }

  async claim(
    operationId: string,
    expectedRevision: number,
    request: ClaimRequest,
    lease: { owner: string; fencingToken: number; expiresAt: string },
  ): Promise<boolean> {
    const current = this.#records.get(operationId);
    if (current === undefined || current.semanticRevision !== expectedRevision) {
      return false;
    }
    const active = this.#leases.get(operationId);
    if (
      active !== undefined &&
      active.owner !== request.owner &&
      Date.parse(active.expiresAt) > this.#clock().getTime()
    ) {
      return false;
    }
    const next: OperationRecord = {
      ...current,
      state: "claimed",
      semanticRevision: expectedRevision + 1,
      lastFencingToken: request.fencingToken,
      claim: {
        owner: request.owner,
        fencingToken: request.fencingToken,
        acquiredAt: request.acquiredAt,
        resumeFrom: request.resumeFrom,
      },
      updatedAt: request.acquiredAt,
    };
    const saved = clone(decodeOperationRecord(next));
    this.#records.set(operationId, saved);
    const events = this.#events.get(operationId) ?? [];
    events.push(this.#event(saved));
    this.#events.set(operationId, events);
    const revision = (this.#leaseRevisions.get(operationId) ?? 0) + 1;
    this.#leaseRevisions.set(operationId, revision);
    this.#leases.set(operationId, {
      operationId,
      owner: lease.owner,
      fencingToken: lease.fencingToken,
      expiresAt: lease.expiresAt,
      leaseRevision: revision,
    });
    return true;
  }

  async lease(operationId: string): Promise<LiveLease | undefined> {
    const lease = this.#leases.get(operationId);
    return lease === undefined ? undefined : clone(lease);
  }

  async renewLease(
    operationId: string,
    owner: string,
    fencingToken: number,
    expiresAt: string,
  ): Promise<boolean> {
    const lease = this.#leases.get(operationId);
    if (lease === undefined || lease.owner !== owner || lease.fencingToken !== fencingToken) {
      return false;
    }
    const revision = (this.#leaseRevisions.get(operationId) ?? 0) + 1;
    this.#leaseRevisions.set(operationId, revision);
    this.#leases.set(operationId, {
      ...lease,
      expiresAt,
      leaseRevision: revision,
    });
    return true;
  }

  async history(
    operationId: string,
    cursor?: string,
    limit?: number,
  ): Promise<OperationEventPage> {
    const after = cursor === undefined ? undefined : decodeHistoryCursor(cursor);
    const events = (this.#events.get(operationId) ?? [])
      .filter((event) => after === undefined || event.semanticRevision > after)
      .map((event) => ({ ...event, record: clone(decodeOperationRecord(event.record)) }));
    return this.#pageEvents(events, limit);
  }

  async list(filter: OperationListFilter = {}, cursor?: string): Promise<OperationPage> {
    const limit = Math.max(0, filter.limit ?? DEFAULT_PAGE_LIMIT);
    const after = cursor === undefined ? undefined : decodeListCursor(cursor);
    const records = [...this.#records.values()]
      .filter((record) => filter.actionName === undefined || record.actionName === filter.actionName)
      .filter((record) => filter.state === undefined || record.state === filter.state)
      .filter((record) => {
        if (after === undefined) return true;
        if (record.updatedAt !== after.u) return record.updatedAt < after.u;
        return record.operationId < after.o;
      })
      .sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || right.operationId.localeCompare(left.operationId),
      )
      .slice(0, limit)
      .map((record) => clone(decodeOperationRecord(record)));
    const last = records[records.length - 1];
    const nextCursor = records.length === limit && limit > 0 && last !== undefined
      ? encodeCursor({ u: last.updatedAt, o: last.operationId })
      : undefined;
    return { records, ...(nextCursor === undefined ? {} : { nextCursor }) };
  }

  #pageEvents(events: OperationEvent[], limit?: number): OperationEventPage {
    const bound = Math.max(0, limit ?? DEFAULT_PAGE_LIMIT);
    const page = events.slice(0, bound);
    const last = page[page.length - 1];
    const nextCursor = page.length === bound && bound > 0 && last !== undefined && events.length > bound
      ? encodeCursor({ r: String(last.semanticRevision) })
      : undefined;
    return { events: page, ...(nextCursor === undefined ? {} : { nextCursor }) };
  }

  #event(record: OperationRecord): OperationEvent {
    return {
      operationId: record.operationId,
      semanticRevision: record.semanticRevision,
      state: record.state,
      at: record.updatedAt,
      record: clone(record),
    };
  }
}
