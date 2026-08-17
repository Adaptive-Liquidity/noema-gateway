import { authorizeV1 } from "./auth.js";
import { listBots } from "./bots.js";
import {
  parseJsonBody,
  resolvePathSegments,
  sendJson,
  sendNoContent,
} from "./http.js";
import {
  IdempotencyConflictError,
  ValidationError,
  acceptInstruction,
  claimNextInstruction,
  completeInstruction,
  toClaimedPayload,
  toCreatedPayload,
  toStatusPayload,
} from "./instructions.js";
import { PersistError, getInstruction } from "./store.js";
import type { GatewayRequest, GatewayResponse } from "./types.js";

function unauthorized(res: GatewayResponse): void {
  sendJson(res, 401, { error: "unauthorized" });
}

function persistFailure(res: GatewayResponse, error: unknown): boolean {
  if (error instanceof PersistError) {
    sendJson(res, error.status, { error: error.message });
    return true;
  }
  return false;
}

export async function handleV1(
  req: GatewayRequest,
  res: GatewayResponse,
): Promise<void> {
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
      const { record, replay } = await acceptInstruction(body);
      sendJson(res, replay ? 200 : 201, toCreatedPayload(record));
    } catch (error) {
      if (
        error instanceof ValidationError ||
        error instanceof IdempotencyConflictError
      ) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      if (persistFailure(res, error)) {
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
    try {
      const record = await getInstruction(id);
      if (!record) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      sendJson(res, 200, toStatusPayload(record));
    } catch (error) {
      if (persistFailure(res, error)) {
        return;
      }
      throw error;
    }
    return;
  }

  if (
    method === "POST" &&
    segments.length === 2 &&
    segments[0] === "instructions" &&
    segments[1] === "claim"
  ) {
    let body: unknown;
    try {
      body = parseJsonBody(req.body);
    } catch {
      sendJson(res, 400, { error: "body must be valid JSON" });
      return;
    }

    try {
      const record = await claimNextInstruction(body);
      if (!record) {
        sendNoContent(res);
        return;
      }
      sendJson(res, 200, toClaimedPayload(record));
    } catch (error) {
      if (error instanceof ValidationError) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      if (persistFailure(res, error)) {
        return;
      }
      throw error;
    }
    return;
  }

  if (
    method === "PATCH" &&
    segments.length === 2 &&
    segments[0] === "instructions"
  ) {
    const id = segments[1];
    if (!id) {
      sendJson(res, 404, { error: "not found" });
      return;
    }

    let body: unknown;
    try {
      body = parseJsonBody(req.body);
    } catch {
      sendJson(res, 400, { error: "body must be valid JSON" });
      return;
    }

    try {
      const record = await completeInstruction(id, body);
      if (!record) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      sendJson(res, 200, toStatusPayload(record));
    } catch (error) {
      if (error instanceof ValidationError) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      if (persistFailure(res, error)) {
        return;
      }
      throw error;
    }
    return;
  }

  sendJson(res, 404, { error: "not found" });
}
