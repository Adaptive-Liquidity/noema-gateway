import type { GatewayRequest, GatewayResponse } from "../lib/types";

export type InvokeResult = {
  status: number;
  body: unknown;
};

export function invoke(
  handler: (req: GatewayRequest, res: GatewayResponse) => void,
  options: {
    method: string;
    url: string;
    headers?: GatewayRequest["headers"];
    body?: unknown;
    query?: GatewayRequest["query"];
  },
): InvokeResult {
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

  handler(
    {
      method: options.method,
      url: options.url,
      headers: options.headers ?? {},
      body: options.body,
      query: options.query,
    },
    res,
  );

  return { status, body: payload };
}
