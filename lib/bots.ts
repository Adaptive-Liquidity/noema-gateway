import type { Bot, NamedTarget } from "./types.js";

export const NAMED_TARGETS: readonly NamedTarget[] = [
  "noema",
  "code",
  "deploy",
  "design",
  "docs",
];

const BOT_NAMES: Record<NamedTarget, string> = {
  noema: "NOEMA",
  code: "Code",
  deploy: "Deploy",
  design: "Design",
  docs: "Docs",
};

export function listBots(): Bot[] {
  return NAMED_TARGETS.map((id) => ({
    id,
    name: BOT_NAMES[id],
    accepts_instructions: true,
  }));
}

export function isNamedTarget(value: string): value is NamedTarget {
  return (NAMED_TARGETS as readonly string[]).includes(value);
}
