import { authorizeV1 } from "./auth.js";
import { listBots } from "./bots.js";
import { parseJsonBody, resolvePathSegments, sendJson } from "./http.js";
import {
  IdempotencyConflictError,
  ValidationError,
  acceptInstruction,
  toCreatedPayload,
} from "./instructions.js";
import { getInstruction } from "./store.js";
import type { GatewayRequest, GatewayResponse } from "./types.js";

function unauthorized(res: GatewayResponse): void {
  sendJson(res, 401, { error: "unauthorized" });
}

export function handleV1(req: GatewayRequest, res: GatewayResponse): void {
  if (!authorizeV1(req)) {
    unauthorized(res);
    return;
  }

  const segments = resolvePathSegments(req, "/v1");
  const method = (req.method ?? "GET").toUpperCase();

  if (method === "GET" && segments.length === 1 && segments[0] === "bots") {
    sendJson(res, 200, { bots: listBots() });
    return;
  }

  if (
    method === "POST" &&
    segments.length === 1 &&
    segments[0] === "instructions"
  ) {
    let body: unknown;
    try {
      body = parseJsonBody(req.body);
    } catch {
      sendJson(res, 400, { error: "body must be valid JSON" });
      return;
    }

    try {
      const { record, replay } = acceptInstruction(body);
      sendJson(res, replay ? 200 : 201, toCreatedPayload(record));
    } catch (error) {
      if (
        error instanceof ValidationError ||
        error instanceof IdempotencyConflictError
      ) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      throw error;
    }
    return;
  }

  if (
    method === "GET" &&
    segments.length === 2 &&
    segments[0] === "instructions"
  ) {
    const id = segments[1];
    if (!id) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    const record = getInstruction(id);
    if (!record) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    sendJson(res, 200, {
      id: record.id,
      status: record.status,
      target: record.target,
      created_at: record.created_at,
      instruction: record.instruction,
    });
    return;
  }

  sendJson(res, 404, { error: "not found" });
}
