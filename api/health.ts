import { sendJson } from "../lib/http.js";
import type { GatewayRequest, GatewayResponse } from "../lib/types.js";

export default function handler(
  _req: GatewayRequest,
  res: GatewayResponse,
): void {
  sendJson(res, 200, { ok: true });
}
