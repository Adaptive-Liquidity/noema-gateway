import { createHash, randomUUID } from "node:crypto";
import { isNamedTarget } from "./bots.js";
import {
  getInstructionByIdempotencyKey,
  saveInstruction,
} from "./store.js";
import type {
  InstructionCreated,
  InstructionRecord,
  InstructionSource,
} from "./types.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SOURCES: readonly InstructionSource[] = [
  "agent-bridge",
  "chatgpt",
  "codex",
];

const MAX_INSTRUCTION_LENGTH = 8000;

export class ValidationError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class IdempotencyConflictError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function normalizeTarget(target: unknown): string {
  if (typeof target !== "string" || target.length === 0) {
    throw new ValidationError("target is required");
  }
  if (isNamedTarget(target)) {
    return target;
  }
  if (isUuid(target)) {
    return target;
  }
  throw new ValidationError("unknown target");
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} is required`);
  }
  return value;
}

function normalizeInstruction(value: unknown): string {
  const instruction = requireString(value, "instruction");
  if (instruction.length === 0 || instruction.length > MAX_INSTRUCTION_LENGTH) {
    throw new ValidationError("instruction must be 1-8000 characters");
  }
  return instruction;
}

function normalizeIdempotencyKey(value: unknown): string {
  const key = requireString(value, "idempotency_key");
  if (!isUuid(key)) {
    throw new ValidationError("idempotency_key must be a uuid");
  }
  return key;
}

function normalizeSource(value: unknown): InstructionSource {
  const source = requireString(value, "source");
  if (!(SOURCES as readonly string[]).includes(source)) {
    throw new ValidationError("source is not allowed");
  }
  return source as InstructionSource;
}

function normalizeActor(value: unknown): string {
  const actor = requireString(value, "actor");
  if (actor.trim().length === 0) {
    throw new ValidationError("actor is required");
  }
  return actor;
}

export function bodyFingerprint(fields: {
  target: unknown;
  instruction: unknown;
  idempotency_key: unknown;
  source: unknown;
  actor: unknown;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        actor: fields.actor,
        idempotency_key: fields.idempotency_key,
        instruction: fields.instruction,
        source: fields.source,
        target: fields.target,
      }),
    )
    .digest("hex");
}

export function toCreatedPayload(record: InstructionRecord): InstructionCreated {
  return {
    id: record.id,
    status: record.status,
    target: record.target,
    created_at: record.created_at,
  };
}

export function acceptInstruction(body: unknown): {
  record: InstructionRecord;
  replay: boolean;
} {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("body must be a JSON object");
  }

  const input = body as Record<string, unknown>;
  const target = normalizeTarget(input.target);
  const instruction = normalizeInstruction(input.instruction);
  const idempotency_key = normalizeIdempotencyKey(input.idempotency_key);
  const source = normalizeSource(input.source);
  const actor = normalizeActor(input.actor);
  const fingerprint = bodyFingerprint({
    target: input.target,
    instruction: input.instruction,
    idempotency_key: input.idempotency_key,
    source: input.source,
    actor: input.actor,
  });

  const existing = getInstructionByIdempotencyKey(idempotency_key);
  if (existing) {
    if (existing.body_fingerprint !== fingerprint) {
      throw new IdempotencyConflictError(
        "idempotency_key was reused with a different body",
      );
    }
    return { record: existing, replay: true };
  }

  const record: InstructionRecord = {
    id: `instr_${randomUUID().replaceAll("-", "")}`,
    status: "accepted",
    target,
    created_at: new Date().toISOString(),
    instruction,
    source,
    actor,
    idempotency_key,
    body_fingerprint: fingerprint,
  };
  saveInstruction(record);
  return { record, replay: false };
}
