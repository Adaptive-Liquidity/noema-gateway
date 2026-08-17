import type { GatewayRequest, GatewayResponse } from "../../../lib/types.js";
import { handleV1 } from "../../../lib/v1.js";

export default async function handler(
  req: GatewayRequest,
  res: GatewayResponse,
): Promise<void> {
  req.url = "/v1/instructions/claim";
  await handleV1(req, res);
}
