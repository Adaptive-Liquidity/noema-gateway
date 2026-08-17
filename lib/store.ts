import type { InstructionRecord } from "./types.js";

export type InstructionStore = {
  getInstruction(id: string): Promise<InstructionRecord | undefined>;
  getInstructionByIdempotencyKey(
    key: string,
  ): Promise<InstructionRecord | undefined>;
  saveInstruction(record: InstructionRecord): Promise<InstructionRecord>;
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
}

export class UnconfiguredStore implements InstructionStore {
  async getInstruction(): Promise<InstructionRecord | undefined> {
    throw new PersistError("persist not configured");
  }

  async getInstructionByIdempotencyKey(): Promise<
    InstructionRecord | undefined
  > {
    throw new PersistError("persist not configured");
  }

  async saveInstruction(): Promise<InstructionRecord> {
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
    return record;
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
