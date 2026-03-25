import type { Conversation } from "./types";

const KEY = "chatgpt-clone-conversations-v1";

export function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as Conversation[];
  } catch {
    return [];
  }
}

export function saveConversations(list: Conversation[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* quota or private mode */
  }
}

export function conversationTitleFromUserText(text: string): string {
  const line = text.trim().split(/\r?\n/)[0] ?? "";
  const t = line.slice(0, 56);
  return t.length < line.length ? `${t}…` : t || "New chat";
}
