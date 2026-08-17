import type { GatewayRequest, GatewayResponse } from "./types";

export function sendJson(
  res: GatewayResponse,
  status: number,
  body: unknown,
): void {
  res.setHeader?.("content-type", "application/json; charset=utf-8");
  res.status(status).json(body);
}

export function headerValue(
  headers: GatewayRequest["headers"],
  name: string,
): string | undefined {
  const key = Object.keys(headers).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase(),
  );
  if (!key) {
    return undefined;
  }
  const value = headers[key];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export function parseJsonBody(body: unknown): unknown {
  if (body == null || body === "") {
    return undefined;
  }
  if (typeof body === "string") {
    return JSON.parse(body) as unknown;
  }
  if (Buffer.isBuffer(body)) {
    return JSON.parse(body.toString("utf8")) as unknown;
  }
  return body;
}

export function resolvePathSegments(
  req: GatewayRequest,
  prefix: "/v1" | "/health",
): string[] {
  const queryPath = req.query?.path;
  if (Array.isArray(queryPath)) {
    return queryPath.filter((segment) => segment.length > 0);
  }
  if (typeof queryPath === "string" && queryPath.length > 0) {
    return queryPath.split("/").filter(Boolean);
  }

  const raw = (req.url ?? "").split("?")[0] ?? "";
  const markers = [`/api${prefix}/`, `${prefix}/`, `/api${prefix}`, prefix];
  for (const marker of markers) {
    const index = raw.indexOf(marker);
    if (index === -1) {
      continue;
    }
    const rest = raw.slice(index + marker.length);
    return rest.split("/").filter(Boolean);
  }
  return [];
}
