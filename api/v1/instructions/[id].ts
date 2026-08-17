import type { GatewayRequest, GatewayResponse } from "../../../lib/types.js";
import { handleV1 } from "../../../lib/v1.js";

function instructionId(req: GatewayRequest): string | undefined {
  const raw = req.query?.id;
  if (typeof raw === "string" && raw.length > 0) {
    return raw;
  }
  if (Array.isArray(raw) && raw[0]) {
    return raw[0];
  }
  return undefined;
}

export default async function handler(
  req: GatewayRequest,
  res: GatewayResponse,
): Promise<void> {
  const id = instructionId(req);
  const url = id ? `/v1/instructions/${id}` : (req.url ?? "/v1/instructions");
  await handleV1({ ...req, url }, res);
}
