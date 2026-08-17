import { sendJson } from "../lib/http";
import type { GatewayRequest, GatewayResponse } from "../lib/types";

export default function handler(
  _req: GatewayRequest,
  res: GatewayResponse,
): void {
  sendJson(res, 200, { ok: true });
}
