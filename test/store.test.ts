import assert from "node:assert/strict";
import { test } from "node:test";
import type { InstructionRecord } from "../lib/types.js";
import {
  KvStore,
  MemoryStore,
  PersistError,
  UnconfiguredStore,
  createMemoryBackend,
  createStore,
} from "../lib/store.js";

const RECORD: InstructionRecord = {
  id: "instr_abc123",
  status: "accepted",
  target: "noema",
  created_at: "2026-08-17T00:00:00.000Z",
  instruction: "shared across instances",
  source: "agent-bridge",
  actor: "contract-test",
  idempotency_key: "11111111-1111-4111-8111-111111111111",
  body_fingerprint: "fingerprint",
};

function createFakeKvFetch(remote: Map<string, string>): typeof fetch {
  return async (_input, init) => {
    const cmd = JSON.parse(String(init?.body)) as unknown[];
    const [op, key, value, nx] = cmd;
    if (op === "GET") {
      return Response.json({ result: remote.get(String(key)) ?? null });
    }
    if (op === "SET") {
      const mapKey = String(key);
      if (nx === "NX" && remote.has(mapKey)) {
        return Response.json({ result: null });
      }
      remote.set(mapKey, String(value));
      return Response.json({ result: "OK" });
    }
    return Response.json({ result: null }, { status: 400 });
  };
}

test("two MemoryStore instances share a record through one backend", async () => {
  const backend = createMemoryBackend();
  const first = new MemoryStore(backend);
  const second = new MemoryStore(backend);

  await first.saveInstruction(RECORD);
  assert.deepEqual(await second.getInstruction(RECORD.id), RECORD);
  assert.deepEqual(
    await second.getInstructionByIdempotencyKey(RECORD.idempotency_key),
    RECORD,
  );
});

test("two KvStore clients see the same record through one remote", async () => {
  const remote = new Map<string, string>();
  const fetchImpl = createFakeKvFetch(remote);
  const first = new KvStore(
    "https://kv.example.test",
    "test-kv-rest-token",
    fetchImpl,
  );
  const second = new KvStore(
    "https://kv.example.test",
    "test-kv-rest-token",
    fetchImpl,
  );

  await first.saveInstruction(RECORD);
  assert.deepEqual(await second.getInstruction(RECORD.id), RECORD);
  assert.deepEqual(
    await second.getInstructionByIdempotencyKey(RECORD.idempotency_key),
    RECORD,
  );
});

test("KvStore idempotent save returns the original record", async () => {
  const remote = new Map<string, string>();
  const store = new KvStore(
    "https://kv.example.test",
    "test-kv-rest-token",
    createFakeKvFetch(remote),
  );
  const first = await store.saveInstruction(RECORD);
  const duplicate = {
    ...RECORD,
    id: "instr_should_not_win",
    created_at: "2026-08-17T00:00:01.000Z",
  };
  const second = await store.saveInstruction(duplicate);
  assert.deepEqual(second, first);
  assert.equal(second.id, RECORD.id);
});

test("createStore without KV outside tests is unconfigured", async () => {
  const store = createStore({
    NODE_TEST_CONTEXT: "",
    NOEMA_GATEWAY_STORE: "",
    KV_REST_API_URL: "",
    KV_REST_API_TOKEN: "",
  });
  assert.ok(store instanceof UnconfiguredStore);
  await assert.rejects(
    () => store.getInstruction("instr_missing"),
    (error: unknown) =>
      error instanceof PersistError && error.message === "persist not configured",
  );
});
