import { decodeOperationRecord } from "./codec.js";
import type {
  OperationEvent,
  OperationLedger,
  OperationListFilter,
  OperationRecord,
} from "./types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryLedger implements OperationLedger {
  readonly #records = new Map<string, OperationRecord>();
  readonly #events = new Map<string, OperationEvent[]>();

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
      current.revision !== expectedRevision ||
      next.operationId !== operationId ||
      next.revision !== expectedRevision + 1
    ) {
      return false;
    }
    const saved = clone(decodeOperationRecord(next));
    this.#records.set(operationId, saved);
    const events = this.#events.get(operationId) ?? [];
    events.push(this.#event(saved));
    this.#events.set(operationId, events);
    return true;
  }

  async history(operationId: string): Promise<OperationEvent[]> {
    const events = this.#events.get(operationId) ?? [];
    return events.map((event) => ({
      ...event,
      record: clone(decodeOperationRecord(event.record)),
    }));
  }

  async list(filter: OperationListFilter = {}): Promise<OperationRecord[]> {
    const limit = Math.max(0, filter.limit ?? Number.MAX_SAFE_INTEGER);
    return [...this.#records.values()]
      .filter((record) => filter.actionName === undefined || record.actionName === filter.actionName)
      .filter((record) => filter.state === undefined || record.state === filter.state)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit)
      .map((record) => clone(decodeOperationRecord(record)));
  }

  #event(record: OperationRecord): OperationEvent {
    return {
      operationId: record.operationId,
      revision: record.revision,
      state: record.state,
      at: record.updatedAt,
      record: clone(record),
    };
  }
}
