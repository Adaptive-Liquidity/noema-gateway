import type { GatewayRequest, GatewayResponse } from "../../lib/types";
import { handleV1 } from "../../lib/v1";

export default function handler(
  req: GatewayRequest,
  res: GatewayResponse,
): void {
  handleV1(req, res);
}
