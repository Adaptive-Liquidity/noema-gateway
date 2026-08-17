import type { GatewayRequest, GatewayResponse } from "../../lib/types.js";
import { handleV1 } from "../../lib/v1.js";

export default function handler(
  req: GatewayRequest,
  res: GatewayResponse,
): void {
  handleV1(req, res);
}
