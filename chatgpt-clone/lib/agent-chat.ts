import type { ChatMessage } from "./types";

type ApiMessage = { role: string; content: string };

/**
 * Non-streaming agent chat (web_search / read_page) via local FastAPI POST /v1/chat/agent.
 */
export async function agentChatCompletion(
  messages: ChatMessage[],
  model: string,
  signal?: AbortSignal,
): Promise<string> {
  const apiMessages: ApiMessage[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const res = await fetch("/v1/chat/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: apiMessages,
      stream: false,
    }),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    let detail = errText || res.statusText;
    try {
      const j = JSON.parse(errText) as { detail?: unknown };
      if (j.detail !== undefined) detail = JSON.stringify(j.detail);
    } catch {
      /* keep text */
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    error?: { message?: string };
  };

  if (data.error?.message) {
    throw new Error(data.error.message);
  }

  const content = data.choices?.[0]?.message?.content;
  if (content === undefined || content === null) {
    throw new Error("No assistant message in response");
  }

  return String(content);
}
