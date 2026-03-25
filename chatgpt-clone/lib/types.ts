export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

export type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  model: string;
  updatedAt: number;
};

export const DEFAULT_MODEL = "grok-4-fast";

export const MODEL_OPTIONS: { id: string; label: string }[] = [
  { id: "grok-4-fast", label: "Grok 4 Fast" },
  { id: "gpt-5", label: "GPT-5" },
  { id: "gpt-4o", label: "GPT-4o" },
];
