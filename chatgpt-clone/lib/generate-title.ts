import { conversationTitleFromUserText } from "./conversations";

const SYSTEM =
  "You write very short chat titles. Reply with the title only: 2–6 words, plain text, no quotes, no markdown, no trailing period unless it is an abbreviation.";

/**
 * Non-streaming chat completion (same origin as FastAPI: /v1/chat/completions).
 */
export async function generateConversationTitle(
  firstUserText: string,
  model: string,
  signal?: AbortSignal,
): Promise<string> {
  const trimmed = firstUserText.trim().slice(0, 4000);
  if (!trimmed) return "New chat";

  const res = await fetch("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `What is a good short title for a conversation that begins with this message?\n\n---\n${trimmed}\n---`,
        },
      ],
      max_tokens: 48,
      temperature: 0.5,
      stream: false,
    }),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || `HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    error?: { message?: string };
  };

  if (data.error?.message) {
    throw new Error(data.error.message);
  }

  const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
  const oneLine = raw.split(/\r?\n/)[0]?.trim() ?? "";
  const cleaned = oneLine.replace(/^["'「」]|["'「」]$/g, "").trim();
  const title = cleaned.slice(0, 80);
  if (title.length > 0) return title;
  return conversationTitleFromUserText(firstUserText);
}

export function fallbackTitle(firstUserText: string): string {
  return conversationTitleFromUserText(firstUserText);
}
