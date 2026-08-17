import type { InstructionRecord } from "./types";

const instructionsById = new Map<string, InstructionRecord>();
const instructionsByIdempotencyKey = new Map<string, InstructionRecord>();

export function getInstruction(id: string): InstructionRecord | undefined {
  return instructionsById.get(id);
}

export function getInstructionByIdempotencyKey(
  key: string,
): InstructionRecord | undefined {
  return instructionsByIdempotencyKey.get(key);
}

export function saveInstruction(record: InstructionRecord): void {
  instructionsById.set(record.id, record);
  instructionsByIdempotencyKey.set(record.idempotency_key, record);
}

export function resetStore(): void {
  instructionsById.clear();
  instructionsByIdempotencyKey.clear();
}

export function storeSize(): number {
  return instructionsById.size;
}
