import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import healthHandler from "../api/health.js";
import v1Handler from "../api/v1/[...path].js";
import instructionClaimHandler from "../api/v1/instructions/claim.js";
import instructionByIdHandler from "../api/v1/instructions/[id].js";
import {
  UnconfiguredStore,
  resetStore,
  storeSize,
  useStore,
} from "../lib/store.js";
import type { GatewayRequest } from "../lib/types.js";
import { handleV1 } from "../lib/v1.js";
import { invoke, invokeRaw } from "./harness.js";

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

test("vercel.json routes claim before :id onto claim.ts", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const config = JSON.parse(
    readFileSync(join(root, "vercel.json"), "utf8"),
  ) as {
    rewrites: Array<{ source: string; destination: string }>;
  };
  const claimIndex = config.rewrites.findIndex(
    (entry) => entry.source === "/v1/instructions/claim",
  );
  const idIndex = config.rewrites.findIndex(
    (entry) => entry.source === "/v1/instructions/:id",
  );
  assert.ok(claimIndex >= 0, "missing /v1/instructions/claim rewrite");
  assert.ok(idIndex >= 0, "missing /v1/instructions/:id rewrite");
  assert.ok(claimIndex < idIndex, "claim rewrite must precede :id");
  assert.equal(
    config.rewrites[claimIndex]?.destination,
    "/api/v1/instructions/claim",
  );
  assert.ok(existsSync(join(root, "api/v1/instructions/claim.ts")));
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

test("POST /v1/instructions returns 409 when the same key has a different body", async () => {
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
    body: validBody({ instruction: "a different instruction" }),
  });
  assert.equal(first.status, 201);
  assert.equal(second.status, 409);
  assert.deepEqual(second.body, {
    error: "idempotency_key was reused with a different body",
  });
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

test("GET /v1/instructions/:id without enumerable headers returns 401 not 500", async () => {
  const result = await invoke(instructionByIdHandler, {
    method: "GET",
    url: "/api/v1/instructions/instr_missing",
    query: { id: "instr_missing" },
    omitHeaders: true,
  });
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { error: "unauthorized" });
});

test("GET /v1/instructions/:id keeps non-enumerable IncomingMessage headers", async () => {
  const created = await invoke(v1Handler, {
    method: "POST",
    url: "/v1/instructions",
    headers: authHeaders(),
    body: validBody({ instruction: "getter headers" }),
  });
  const id = (created.body as { id: string }).id;
  const req: GatewayRequest = {
    method: "GET",
    url: `/api/v1/instructions/${id}`,
    query: { id },
  };
  Object.defineProperty(req, "headers", {
    enumerable: false,
    configurable: true,
    get() {
      return authHeaders();
    },
  });
  const result = await invokeRaw(instructionByIdHandler, req);
  assert.equal(result.status, 200);
  assert.equal((result.body as { instruction: string }).instruction, "getter headers");
});

test("POST /v1/instructions/claim without token returns 401", async () => {
  const result = await invoke(instructionClaimHandler, {
    method: "POST",
    url: "/v1/instructions/claim",
    omitHeaders: true,
  });
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { error: "unauthorized" });
});

test("POST /v1/instructions/claim returns 204 when the queue is empty", async () => {
  const result = await invoke(instructionClaimHandler, {
    method: "POST",
    url: "/v1/instructions/claim",
    headers: authHeaders(),
  });
  assert.equal(result.status, 204);
  assert.equal(result.body, undefined);
});

test("POST /v1/instructions/claim is atomic and does not double-claim", async () => {
  const created = await invoke(handleV1, {
    method: "POST",
    url: "/v1/instructions",
    headers: authHeaders(),
    body: validBody({ instruction: "claim me" }),
  });
  assert.equal(created.status, 201);
  const id = (created.body as { id: string }).id;

  const first = await invoke(instructionClaimHandler, {
    method: "POST",
    url: "/v1/instructions/claim",
    headers: authHeaders(),
  });
  const second = await invoke(instructionClaimHandler, {
    method: "POST",
    url: "/v1/instructions/claim",
    headers: authHeaders(),
  });

  assert.equal(first.status, 200);
  assert.deepEqual(first.body, {
    id,
    target: "noema",
    instruction: "claim me",
    status: "seen",
    created_at: (created.body as { created_at: string }).created_at,
  });
  assert.equal(second.status, 204);
  assert.equal(second.body, undefined);

  const fetched = await invoke(handleV1, {
    method: "GET",
    url: `/v1/instructions/${id}`,
    headers: authHeaders(),
  });
  assert.equal(fetched.status, 200);
  assert.equal((fetched.body as { status: string }).status, "seen");
});

test("POST /v1/instructions/claim can filter by target", async () => {
  await invoke(handleV1, {
    method: "POST",
    url: "/v1/instructions",
    headers: authHeaders(),
    body: validBody({
      target: "docs",
      instruction: "docs only",
      idempotency_key: "44444444-4444-4444-8444-444444444444",
    }),
  });
  const empty = await invoke(instructionClaimHandler, {
    method: "POST",
    url: "/v1/instructions/claim",
    headers: authHeaders(),
    body: { target: "noema" },
  });
  assert.equal(empty.status, 204);

  const claimed = await invoke(instructionClaimHandler, {
    method: "POST",
    url: "/v1/instructions/claim",
    headers: authHeaders(),
    body: { target: "docs" },
  });
  assert.equal(claimed.status, 200);
  assert.equal((claimed.body as { target: string }).target, "docs");
  assert.equal((claimed.body as { status: string }).status, "seen");
});

test("PATCH /v1/instructions/:id without token returns 401", async () => {
  const result = await invoke(instructionByIdHandler, {
    method: "PATCH",
    url: "/api/v1/instructions/instr_missing",
    query: { id: "instr_missing" },
    body: { status: "done" },
    omitHeaders: true,
  });
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { error: "unauthorized" });
});

test("PATCH /v1/instructions/:id sets done and rejected", async () => {
  const doneCreated = await invoke(handleV1, {
    method: "POST",
    url: "/v1/instructions",
    headers: authHeaders(),
    body: validBody({ instruction: "mark done" }),
  });
  const doneId = (doneCreated.body as { id: string }).id;
  const done = await invoke(instructionByIdHandler, {
    method: "PATCH",
    url: `/api/v1/instructions/${doneId}`,
    headers: authHeaders(),
    query: { id: doneId },
    body: { status: "done" },
  });
  assert.equal(done.status, 200);
  assert.equal((done.body as { status: string }).status, "done");
  assert.equal((done.body as { instruction: string }).instruction, "mark done");

  const rejectedCreated = await invoke(handleV1, {
    method: "POST",
    url: "/v1/instructions",
    headers: authHeaders(),
    body: validBody({
      instruction: "mark rejected",
      idempotency_key: "55555555-5555-4555-8555-555555555555",
    }),
  });
  const rejectedId = (rejectedCreated.body as { id: string }).id;
  const rejected = await invoke(instructionByIdHandler, {
    method: "PATCH",
    url: `/api/v1/instructions/${rejectedId}`,
    headers: authHeaders(),
    query: { id: rejectedId },
    body: { status: "rejected" },
  });
  assert.equal(rejected.status, 200);
  assert.equal((rejected.body as { status: string }).status, "rejected");

  const fetched = await invoke(handleV1, {
    method: "GET",
    url: `/v1/instructions/${doneId}`,
    headers: authHeaders(),
  });
  assert.equal(fetched.status, 200);
  assert.equal((fetched.body as { status: string }).status, "done");
});

test("PATCH /v1/instructions/:id returns 400 for an invalid status", async () => {
  const created = await invoke(handleV1, {
    method: "POST",
    url: "/v1/instructions",
    headers: authHeaders(),
    body: validBody({ instruction: "bad patch" }),
  });
  const id = (created.body as { id: string }).id;
  const result = await invoke(instructionByIdHandler, {
    method: "PATCH",
    url: `/api/v1/instructions/${id}`,
    headers: authHeaders(),
    query: { id },
    body: { status: "seen" },
  });
  assert.equal(result.status, 400);
});

test("PATCH /v1/instructions/:id returns 404 when missing", async () => {
  const result = await invoke(instructionByIdHandler, {
    method: "PATCH",
    url: "/api/v1/instructions/instr_missing",
    headers: authHeaders(),
    query: { id: "instr_missing" },
    body: { status: "done" },
  });
  assert.equal(result.status, 404);
});

test("claim and PATCH persist return 503 when KV is not configured", async () => {
  useStore(new UnconfiguredStore());
  const claim = await invoke(instructionClaimHandler, {
    method: "POST",
    url: "/v1/instructions/claim",
    headers: authHeaders(),
  });
  assert.equal(claim.status, 503);
  assert.deepEqual(claim.body, { error: "persist not configured" });

  const patched = await invoke(instructionByIdHandler, {
    method: "PATCH",
    url: "/api/v1/instructions/instr_missing",
    headers: authHeaders(),
    query: { id: "instr_missing" },
    body: { status: "done" },
  });
  assert.equal(patched.status, 503);
  assert.deepEqual(patched.body, { error: "persist not configured" });
});
