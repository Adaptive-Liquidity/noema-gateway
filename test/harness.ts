import type { GatewayRequest, GatewayResponse } from "../lib/types.js";

export type InvokeResult = {
  status: number;
  body: unknown;
};

function createMockResponse(): {
  res: GatewayResponse;
  result: () => InvokeResult;
} {
  let status = 200;
  let payload: unknown;

  const res: GatewayResponse = {
    status(code: number) {
      status = code;
      return res;
    },
    json(body: unknown) {
      payload = body;
    },
    setHeader() {
      return undefined;
    },
    end(raw?: string) {
      if (raw) {
        payload = JSON.parse(raw) as unknown;
      }
    },
  };

  return {
    res,
    result: () => ({ status, body: payload }),
  };
}

export async function invokeRaw(
  handler: (
    req: GatewayRequest,
    res: GatewayResponse,
  ) => void | Promise<void>,
  req: GatewayRequest,
): Promise<InvokeResult> {
  const { res, result } = createMockResponse();
  await handler(req, res);
  return result();
}

export async function invoke(
  handler: (
    req: GatewayRequest,
    res: GatewayResponse,
  ) => void | Promise<void>,
  options: {
    method: string;
    url: string;
    headers?: GatewayRequest["headers"];
    body?: unknown;
    query?: GatewayRequest["query"];
    omitHeaders?: boolean;
  },
): Promise<InvokeResult> {
  const req: GatewayRequest = {
    method: options.method,
    url: options.url,
    body: options.body,
    query: options.query,
  };
  if (!options.omitHeaders) {
    req.headers = options.headers ?? {};
  }
  return invokeRaw(handler, req);
}
