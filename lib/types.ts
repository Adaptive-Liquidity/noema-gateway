export type NamedTarget = "noema" | "code" | "deploy" | "design" | "docs";

export type InstructionSource = "agent-bridge" | "chatgpt" | "codex";

export type InstructionRecord = {
  id: string;
  status: "accepted";
  target: string;
  created_at: string;
  instruction: string;
  source: InstructionSource;
  actor: string;
  idempotency_key: string;
  body_fingerprint: string;
};

export type InstructionCreated = {
  id: string;
  status: "accepted";
  target: string;
  created_at: string;
};

export type InstructionStatus = InstructionCreated & {
  instruction: string;
};

export type Bot = {
  id: NamedTarget;
  name: string;
  accepts_instructions: true;
};

export type GatewayHeaders = Record<string, string | string[] | undefined>;

export type GatewayRequest = {
  method?: string;
  headers: GatewayHeaders;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
  url?: string;
};

export type GatewayResponse = {
  status(code: number): GatewayResponse;
  json(body: unknown): void;
  setHeader?(name: string, value: string): void;
  end?(body?: string): void;
};
