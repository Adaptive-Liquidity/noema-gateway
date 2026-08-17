# noema-gateway

Minimal authenticated NOEMA instruction gateway. Platform, not product.

Preview only. Do not treat this repository as an Adaptive-Liquidity product repo.
Do not merge this as production. Do not deploy with `--prod`.

## Contract

- `Authorization: Bearer <NOEMA_GATEWAY_TOKEN>` on all `/v1/*`
- `POST /v1/instructions`
- `GET /v1/instructions/:id`
- `GET /v1/bots`
- `GET /health` (no auth)

Set `NOEMA_GATEWAY_TOKEN` in the environment. Do not commit a token.

## Auth

All `/v1/*` routes require:

```http
Authorization: Bearer <NOEMA_GATEWAY_TOKEN>
```

Set the token with the environment variable `NOEMA_GATEWAY_TOKEN`.

- Use the env **name** only in docs, PRs, and commits.
- Do not invent or commit a production secret.
- Tests inject a fixture token in the test process only.
- Missing or wrong token → `401`.

## Endpoints

### `GET /health`

No auth. Returns `200`:

```json
{"ok":true}
```

### `GET /v1/bots`

Auth required. Returns exactly these bots (no other agents):

```json
{
  "bots": [
    { "id": "noema", "name": "NOEMA", "accepts_instructions": true },
    { "id": "code", "name": "Code", "accepts_instructions": true },
    { "id": "deploy", "name": "Deploy", "accepts_instructions": true },
    { "id": "design", "name": "Design", "accepts_instructions": true },
    { "id": "docs", "name": "Docs", "accepts_instructions": true }
  ]
}
```

### `POST /v1/instructions`

Auth required. Body:

```json
{
  "target": "noema",
  "instruction": "string, 1-8000 chars",
  "idempotency_key": "<uuid>",
  "source": "agent-bridge",
  "actor": "string"
}
```

- `target`: `noema` | `code` | `deploy` | `design` | `docs`, or a bot UUID
- `source`: `agent-bridge` | `chatgpt` | `codex`
- Named targets stay as those ids. A UUID target is echoed as the normalized id.
- Unknown target, empty/`>8000` instruction, missing/invalid `idempotency_key`,
  disallowed `source`, or missing `actor` → `400`

`201` (first accept):

```json
{
  "id": "instr_...",
  "status": "accepted",
  "target": "<normalized id>",
  "created_at": "2026-08-17T00:00:00.000Z"
}
```

The same `idempotency_key` plus the same body returns the original `201`/`200`
payload and does not create a duplicate.

### `GET /v1/instructions/:id`

Auth required. Returns the created object plus `instruction`. Missing id → `404`.

## Persistence

Accepted instructions are stored in a **module-level `Map` for the process**.
That is enough for status across invocations in the same Node process.

Preview persistence is process-local until KV. A later Vercel preview cold start
or a different isolate will not see earlier in-memory rows. This HTTP contract
does not call Grok Bot, Slack, Notion, or wake NOEMA.

## Local

```bash
npm install
npm test
```

For a local or Vercel **preview** (not production), set `NOEMA_GATEWAY_TOKEN` in
the environment of that process or preview project. Do not put a token in git.

Handlers live under `api/` so Deploy can attach a preview later. `vercel.json`
rewrites `/health` and `/v1/*` onto those functions.

## Status

HTTP contract only. Preview only. Do not merge. Do not `--prod`.
