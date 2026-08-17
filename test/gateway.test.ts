import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import healthHandler from "../api/health.js";
import v1Handler from "../api/v1/[...path].js";
import instructionByIdHandler from "../api/v1/instructions/[id].js";
import {
  UnconfiguredStore,
  resetStore,
  storeSize,
  useStore,
} from "../lib/store.js";
import { handleV1 } from "../lib/v1.js";
import { invoke } from "./harness.js";

const FIXTURE_TOKEN = "test-noema-gateway-token-fixture-32chars";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const BOT_UUID = "22222222-2222-4222-8222-222222222222";

function authHeaders(token = FIXTURE_TOKEN) {
  return { authorization: `Bearer ${token}` };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    target: "noema",
    instruction: "ping the gateway contract",
    idempotency_key: VALID_UUID,
    source: "agent-bridge",
    actor: "contract-test",
    ...overrides,
  };
}

beforeEach(() => {
  process.env.NOEMA_GATEWAY_TOKEN = FIXTURE_TOKEN;
  process.env.NOEMA_GATEWAY_STORE = "memory";
  resetStore();
});

afterEach(() => {
  resetStore();
});

function collectTsFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectTsFiles(full));
      continue;
    }
    if (full.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

test("api and lib relative ESM imports use explicit .js extensions", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const files = [
    ...collectTsFiles(join(root, "api")),
    ...collectTsFiles(join(root, "lib")),
  ];
  assert.ok(files.length > 0);
  const relativeImport = /from\s+["'](\.\.?\/[^"']+)["']/g;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const specifiers = [...source.matchAll(relativeImport)].map((match) => match[1]);
    assert.ok(specifiers.length > 0 || file.endsWith("types.ts"), file);
    for (const specifier of specifiers) {
      assert.match(
        specifier,
        /\.js$/,
        `${file} imports ${specifier} without a .js extension`,
      );
    }
  }
});

test("vercel.json routes two-segment instruction ids onto [id].ts", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const config = JSON.parse(
    readFileSync(join(root, "vercel.json"), "utf8"),
  ) as {
    rewrites: Array<{ source: string; destination: string }>;
  };
  const rewrite = config.rewrites.find(
    (entry) => entry.source === "/v1/instructions/:id",
  );
  assert.ok(rewrite, "missing /v1/instructions/:id rewrite");
  assert.equal(rewrite.destination, "/api/v1/instructions/:id");
  assert.ok(existsSync(join(root, "api/v1/instructions/[id].ts")));
});

test("Vercel function entries load and serve the existing contract", async () => {
  const health = await invoke(healthHandler, {
    method: "GET",
    url: "/health",
  });
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { ok: true });

  const bots = await invoke(v1Handler, {
    method: "GET",
    url: "/v1/bots",
    headers: authHeaders(),
  });
  assert.equal(bots.status, 200);
});

test("GET /health returns 200 {ok:true} without auth", async () => {
  const result = await invoke(healthHandler, {
    method: "GET",
    url: "/health",
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });
});

test("GET /v1/bots without token returns 401", async () => {
  const result = await invoke(handleV1, {
    method: "GET",
    url: "/v1/bots",
  });
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { error: "unauthorized" });
});

test("GET /v1/bots with wrong token returns 401", async () => {
  const result = await invoke(handleV1, {
    method: "GET",
    url: "/v1/bots",
    headers: authHeaders("wrong-token-that-is-also-long-enough"),
  });
  assert.equal(result.status, 401);
});

test("POST /v1/instructions without token returns 401", async () => {
  const result = await invoke(handleV1, {
    method: "POST",
    url: "/v1/instructions",
    body: validBody(),
  });
  assert.equal(result.status, 401);
});

test("POST /v1/instructions accepts a valid body", async () => {
  const result = await invoke(handleV1, {
    method: "POST",
    url: "/v1/instructions",
    headers: authHeaders(),
    body: validBody(),
  });
  assert.equal(result.status, 201);
  const body = result.body as {
    id: string;
    status: string;
    target: string;
    created_at: string;
  };
  assert.match(body.id, /^instr_[0-9a-f]+$/);
  assert.equal(body.status, "accepted");
  assert.equal(body.target, "noema");
  assert.equal(new Date(body.created_at).toISOString(), body.created_at);
  assert.equal("instruction" in body, false);
});

test("POST /v1/instructions is idempotent for the same key and body", async () => {
  const first = await invoke(handleV1, {
    method: "POST",
    url: "/v1/instructions",
    headers: authHeaders(),
    body: validBody(),
  });
  const second = await invoke(handleV1, {
    method: "POST",
    url: "/v1/instructions",
    headers: authHeaders(),
    body: validBody(),
  });
  assert.equal(first.status, 201);
  assert.ok(second.status === 200 || second.status === 201);
  assert.deepEqual(second.body, first.body);
  assert.equal(storeSize(), 1);
});

test("GET /v1/instructions/:id returns status plus instruction", async () => {
  const created = await invoke(handleV1, {
    method: "POST",
    url: "/v1/instructions",
    headers: authHeaders(),
    body: validBody({ instruction: "status check" }),
  });
  const id = (created.body as { id: string }).id;
  const result = await invoke(handleV1, {
    method: "GET",
    url: `/v1/instructions/${id}`,
    headers: authHeaders(),
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    ...(created.body as object),
    instruction: "status check",
  });
});

test("GET /v1/instructions/:id reaches the dedicated [id] function", async () => {
  const created = await invoke(v1Handler, {
    method: "POST",
    url: "/v1/instructions",
    headers: authHeaders(),
    body: validBody({ instruction: "via id function" }),
  });
  const id = (created.body as { id: string }).id;
  const result = await invoke(instructionByIdHandler, {
    method: "GET",
    url: `/api/v1/instructions/${id}`,
    headers: authHeaders(),
    query: { id },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    ...(created.body as object),
    instruction: "via id function",
  });
});

test("GET /v1/bots lists exactly the five instruction bots", async () => {
  const result = await invoke(handleV1, {
    method: "GET",
    url: "/v1/bots",
    headers: authHeaders(),
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    bots: [
      { id: "noema", name: "NOEMA", accepts_instructions: true },
      { id: "code", name: "Code", accepts_instructions: true },
      { id: "deploy", name: "Deploy", accepts_instructions: true },
      { id: "design", name: "Design", accepts_instructions: true },
      { id: "docs", name: "Docs", accepts_instructions: true },
    ],
  });
});

test("POST /v1/instructions returns 400 on bad body", async () => {
  const cases: Array<{ name: string; body: unknown }> = [
    { name: "empty instruction", body: validBody({ instruction: "" }) },
    {
      name: "instruction too long",
      body: validBody({ instruction: "x".repeat(8001) }),
    },
    { name: "missing actor", body: validBody({ actor: "" }) },
    { name: "unknown target", body: validBody({ target: "phi" }) },
    { name: "bad source", body: validBody({ source: "slack" }) },
    {
      name: "invalid idempotency_key",
      body: validBody({ idempotency_key: "not-a-uuid" }),
    },
    { name: "missing fields", body: {} },
  ];

  for (const testCase of cases) {
    const result = await invoke(handleV1, {
      method: "POST",
      url: "/v1/instructions",
      headers: authHeaders(),
      body: testCase.body,
    });
    assert.equal(result.status, 400, testCase.name);
  }
});

test("GET /v1/instructions/:id returns 404 when missing", async () => {
  const result = await invoke(handleV1, {
    method: "GET",
    url: "/v1/instructions/instr_missing",
    headers: authHeaders(),
  });
  assert.equal(result.status, 404);
});

test("POST /v1/instructions echoes a bot UUID as the normalized target", async () => {
  const result = await invoke(handleV1, {
    method: "POST",
    url: "/v1/instructions",
    headers: authHeaders(),
    body: validBody({
      target: BOT_UUID,
      idempotency_key: "33333333-3333-4333-8333-333333333333",
    }),
  });
  assert.equal(result.status, 201);
  assert.equal((result.body as { target: string }).target, BOT_UUID);
});

test("instruction persist returns 503 when KV is not configured", async () => {
  useStore(new UnconfiguredStore());
  const created = await invoke(handleV1, {
    method: "POST",
    url: "/v1/instructions",
    headers: authHeaders(),
    body: validBody(),
  });
  assert.equal(created.status, 503);
  assert.deepEqual(created.body, { error: "persist not configured" });

  const missing = await invoke(handleV1, {
    method: "GET",
    url: "/v1/instructions/instr_missing",
    headers: authHeaders(),
  });
  assert.equal(missing.status, 503);
  assert.deepEqual(missing.body, { error: "persist not configured" });
});

test("health and bots still work when persist is not configured", async () => {
  useStore(new UnconfiguredStore());
  const health = await invoke(healthHandler, {
    method: "GET",
    url: "/health",
  });
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { ok: true });

  const bots = await invoke(handleV1, {
    method: "GET",
    url: "/v1/bots",
    headers: authHeaders(),
  });
  assert.equal(bots.status, 200);
});
