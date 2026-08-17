import type { InstructionLifecycle, InstructionRecord } from "./types.js";

export type CompletionStatus = Extract<InstructionLifecycle, "done" | "rejected">;

export type InstructionStore = {
  getInstruction(id: string): Promise<InstructionRecord | undefined>;
  getInstructionByIdempotencyKey(
    key: string,
  ): Promise<InstructionRecord | undefined>;
  saveInstruction(record: InstructionRecord): Promise<InstructionRecord>;
  claimInstruction(target?: string): Promise<InstructionRecord | undefined>;
  updateInstructionStatus(
    id: string,
    status: CompletionStatus,
  ): Promise<InstructionRecord | undefined>;
};

export type MemoryBackend = {
  byId: Map<string, InstructionRecord>;
  byIdempotencyKey: Map<string, InstructionRecord>;
};

export class PersistError extends Error {
  readonly status = 503;

  constructor(message: string) {
    super(message);
    this.name = "PersistError";
  }
}

const ID_PREFIX = "noema:instr:id:";
const IDEM_PREFIX = "noema:instr:idem:";
const ACCEPTED_SET = "noema:instr:accepted";
const ACCEPTED_TARGET_PREFIX = "noema:instr:accepted:";
const CLAIM_PREFIX = "noema:instr:claim:";

export const KV_URL_ENV = "KV_REST_API_URL";
export const KV_TOKEN_ENV = "KV_REST_API_TOKEN";
const KV_URL_ENV_ALIAS = "NOEMA_GATEWAY_KV_REST_API_URL";
const KV_TOKEN_ENV_ALIAS = "NOEMA_GATEWAY_KV_REST_API_TOKEN";

export function createMemoryBackend(): MemoryBackend {
  return {
    byId: new Map(),
    byIdempotencyKey: new Map(),
  };
}

function envValue(
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const value = env[name];
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  return value;
}

export function kvCredentials(
  env: NodeJS.ProcessEnv = process.env,
): { url: string; token: string } | undefined {
  const url =
    envValue(env, KV_URL_ENV) ?? envValue(env, KV_URL_ENV_ALIAS);
  const token =
    envValue(env, KV_TOKEN_ENV) ?? envValue(env, KV_TOKEN_ENV_ALIAS);
  if (!url || !token) {
    return undefined;
  }
  return { url: url.replace(/\/$/, ""), token };
}

function useMemoryStore(env: NodeJS.ProcessEnv): boolean {
  return (
    Boolean(env.NODE_TEST_CONTEXT) || env.NOEMA_GATEWAY_STORE === "memory"
  );
}

function parseRecord(value: unknown): InstructionRecord | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === "object") {
    return value as InstructionRecord;
  }
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(value) as InstructionRecord;
  } catch {
    return undefined;
  }
}

export class MemoryStore implements InstructionStore {
  constructor(private readonly backend: MemoryBackend) {}

  async getInstruction(id: string): Promise<InstructionRecord | undefined> {
    return this.backend.byId.get(id);
  }

  async getInstructionByIdempotencyKey(
    key: string,
  ): Promise<InstructionRecord | undefined> {
    return this.backend.byIdempotencyKey.get(key);
  }

  async saveInstruction(
    record: InstructionRecord,
  ): Promise<InstructionRecord> {
    const existing = this.backend.byIdempotencyKey.get(record.idempotency_key);
    if (existing) {
      return existing;
    }
    this.backend.byId.set(record.id, record);
    this.backend.byIdempotencyKey.set(record.idempotency_key, record);
    return record;
  }

  async claimInstruction(
    target?: string,
  ): Promise<InstructionRecord | undefined> {
    for (const record of this.backend.byId.values()) {
      if (record.status !== "accepted") {
        continue;
      }
      if (target && record.target !== target) {
        continue;
      }
      const claimed: InstructionRecord = { ...record, status: "seen" };
      this.backend.byId.set(record.id, claimed);
      this.backend.byIdempotencyKey.set(record.idempotency_key, claimed);
      return claimed;
    }
    return undefined;
  }

  async updateInstructionStatus(
    id: string,
    status: CompletionStatus,
  ): Promise<InstructionRecord | undefined> {
    const existing = this.backend.byId.get(id);
    if (!existing) {
      return undefined;
    }
    const updated: InstructionRecord = { ...existing, status };
    this.backend.byId.set(id, updated);
    this.backend.byIdempotencyKey.set(existing.idempotency_key, updated);
    return updated;
  }
}

export class UnconfiguredStore implements InstructionStore {
  async getInstruction(
    _id: string,
  ): Promise<InstructionRecord | undefined> {
    throw new PersistError("persist not configured");
  }

  async getInstructionByIdempotencyKey(
    _key: string,
  ): Promise<InstructionRecord | undefined> {
    throw new PersistError("persist not configured");
  }

  async saveInstruction(
    _record: InstructionRecord,
  ): Promise<InstructionRecord> {
    throw new PersistError("persist not configured");
  }

  async claimInstruction(
    _target?: string,
  ): Promise<InstructionRecord | undefined> {
    throw new PersistError("persist not configured");
  }

  async updateInstructionStatus(
    _id: string,
    _status: CompletionStatus,
  ): Promise<InstructionRecord | undefined> {
    throw new PersistError("persist not configured");
  }
}

export class KvStore implements InstructionStore {
  constructor(
    private readonly restUrl: string,
    private readonly restToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getInstruction(id: string): Promise<InstructionRecord | undefined> {
    return parseRecord(await this.command(["GET", `${ID_PREFIX}${id}`]));
  }

  async getInstructionByIdempotencyKey(
    key: string,
  ): Promise<InstructionRecord | undefined> {
    return parseRecord(await this.command(["GET", `${IDEM_PREFIX}${key}`]));
  }

  async saveInstruction(
    record: InstructionRecord,
  ): Promise<InstructionRecord> {
    const json = JSON.stringify(record);
    const created = await this.command([
      "SET",
      `${IDEM_PREFIX}${record.idempotency_key}`,
      json,
      "NX",
    ]);
    if (created == null) {
      const existing = await this.getInstructionByIdempotencyKey(
        record.idempotency_key,
      );
      if (!existing) {
        throw new PersistError("persist unavailable");
      }
      return existing;
    }
    await this.command(["SET", `${ID_PREFIX}${record.id}`, json]);
    await this.command(["SADD", ACCEPTED_SET, record.id]);
    await this.command([
      "SADD",
      `${ACCEPTED_TARGET_PREFIX}${record.target}`,
      record.id,
    ]);
    return record;
  }

  async claimInstruction(
    target?: string,
  ): Promise<InstructionRecord | undefined> {
    const setKey = target
      ? `${ACCEPTED_TARGET_PREFIX}${target}`
      : ACCEPTED_SET;
    for (;;) {
      const popped = await this.command(["SPOP", setKey]);
      if (popped == null || popped === "") {
        return undefined;
      }
      const id = String(popped);
      const record = await this.getInstruction(id);
      if (!record || record.status !== "accepted") {
        continue;
      }
      if (target && record.target !== target) {
        continue;
      }
      const locked = await this.command([
        "SET",
        `${CLAIM_PREFIX}${record.id}`,
        "1",
        "NX",
      ]);
      if (locked == null) {
        continue;
      }
      const claimed: InstructionRecord = { ...record, status: "seen" };
      const json = JSON.stringify(claimed);
      await this.command(["SET", `${ID_PREFIX}${record.id}`, json]);
      await this.command([
        "SET",
        `${IDEM_PREFIX}${record.idempotency_key}`,
        json,
      ]);
      if (target) {
        await this.command(["SREM", ACCEPTED_SET, record.id]);
      } else {
        await this.command([
          "SREM",
          `${ACCEPTED_TARGET_PREFIX}${record.target}`,
          record.id,
        ]);
      }
      return claimed;
    }
  }

  async updateInstructionStatus(
    id: string,
    status: CompletionStatus,
  ): Promise<InstructionRecord | undefined> {
    const existing = await this.getInstruction(id);
    if (!existing) {
      return undefined;
    }
    const updated: InstructionRecord = { ...existing, status };
    const json = JSON.stringify(updated);
    await this.command(["SET", `${ID_PREFIX}${id}`, json]);
    await this.command(["SET", `${IDEM_PREFIX}${existing.idempotency_key}`, json]);
    await this.command(["SREM", ACCEPTED_SET, id]);
    await this.command([
      "SREM",
      `${ACCEPTED_TARGET_PREFIX}${existing.target}`,
      id,
    ]);
    return updated;
  }

  private async command(cmd: unknown[]): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.restUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.restToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(cmd),
      });
    } catch {
      throw new PersistError("persist unavailable");
    }
    if (!response.ok) {
      throw new PersistError("persist unavailable");
    }
    const payload = (await response.json()) as { result?: unknown };
    return payload.result;
  }
}

export function createStore(
  env: NodeJS.ProcessEnv = process.env,
  memoryBackend: MemoryBackend = createMemoryBackend(),
  fetchImpl: typeof fetch = fetch,
): InstructionStore {
  if (useMemoryStore(env)) {
    return new MemoryStore(memoryBackend);
  }
  const kv = kvCredentials(env);
  if (kv) {
    return new KvStore(kv.url, kv.token, fetchImpl);
  }
  return new UnconfiguredStore();
}

let memoryBackend = createMemoryBackend();
let cached: InstructionStore | undefined;
let override: InstructionStore | undefined;

export function useStore(store: InstructionStore | undefined): void {
  override = store;
}

export function getStore(): InstructionStore {
  if (override) {
    return override;
  }
  cached ??= createStore(process.env, memoryBackend);
  return cached;
}

export function resetStore(): void {
  override = undefined;
  memoryBackend = createMemoryBackend();
  cached = undefined;
}

export function storeSize(): number {
  return memoryBackend.byId.size;
}

export function getInstruction(
  id: string,
): Promise<InstructionRecord | undefined> {
  return getStore().getInstruction(id);
}

export function getInstructionByIdempotencyKey(
  key: string,
): Promise<InstructionRecord | undefined> {
  return getStore().getInstructionByIdempotencyKey(key);
}

export function saveInstruction(
  record: InstructionRecord,
): Promise<InstructionRecord> {
  return getStore().saveInstruction(record);
}

export function claimInstruction(
  target?: string,
): Promise<InstructionRecord | undefined> {
  return getStore().claimInstruction(target);
}

export function updateInstructionStatus(
  id: string,
  status: CompletionStatus,
): Promise<InstructionRecord | undefined> {
  return getStore().updateInstructionStatus(id, status);
}
