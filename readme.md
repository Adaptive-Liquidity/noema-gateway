# noema-gateway

Minimal authenticated NOEMA instruction gateway. Platform, not product.

Preview only. Do not treat this repository as an Adaptive-Liquidity product repo.

## Contract

- `Authorization: Bearer <NOEMA_GATEWAY_TOKEN>` on all `/v1/*`
- `POST /v1/instructions`
- `GET /v1/instructions/:id`
- `GET /v1/bots`
- `GET /health` (no auth)

Set `NOEMA_GATEWAY_TOKEN` in the environment. Do not commit a token.

## Status

Initial commit so the default branch exists. Implementation follows on a PR.