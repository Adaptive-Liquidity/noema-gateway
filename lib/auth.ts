import { timingSafeEqual } from "node:crypto";
import type { GatewayRequest } from "./types";
import { headerValue } from "./http";

export function configuredGatewayToken(): string | undefined {
  const token = process.env.NOEMA_GATEWAY_TOKEN;
  if (typeof token !== "string" || token.length === 0) {
    return undefined;
  }
  return token;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  const size = Math.max(leftBuf.length, rightBuf.length, 1);
  const leftPad = Buffer.alloc(size);
  const rightPad = Buffer.alloc(size);
  leftBuf.copy(leftPad);
  rightBuf.copy(rightPad);
  return timingSafeEqual(leftPad, rightPad) && leftBuf.length === rightBuf.length;
}

export function authorizeV1(req: GatewayRequest): boolean {
  const expected = configuredGatewayToken();
  if (!expected) {
    return false;
  }

  const authorization = headerValue(req.headers, "authorization");
  if (!authorization) {
    return false;
  }

  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  if (!match?.[1]) {
    return false;
  }

  return safeEqual(match[1], expected);
}
