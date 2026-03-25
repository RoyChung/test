"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatPane } from "@/components/ChatPane";
import { Sidebar } from "@/components/Sidebar";
import { loadConversations, saveConversations } from "@/lib/conversations";
import { agentChatCompletion } from "@/lib/agent-chat";
import { fallbackTitle, generateConversationTitle } from "@/lib/generate-title";
import type { ChatMessage, Conversation } from "@/lib/types";
import { DEFAULT_MODEL } from "@/lib/types";

function newId(): string {
  return crypto.randomUUID();
}

function emptyConversation(): Conversation {
  const id = newId();
  return {
    id,
    title: "New chat",
    messages: [],
    model: DEFAULT_MODEL,
    updatedAt: Date.now(),
  };
}

export default function ChatApp() {
  const [list, setList] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    const stored = loadConversations();
    hydrated.current = true;
    if (stored.length === 0) {
      const first = emptyConversation();
      setList([first]);
      setActiveId(first.id);
      saveConversations([first]);
    } else {
      setList(stored);
      setActiveId(stored[0]?.id ?? null);
    }
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    saveConversations(list);
  }, [list]);

  const active = list.find((c) => c.id === activeId) ?? null;

  const updateConversation = useCallback((id: string, patch: Partial<Conversation>) => {
    setList((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c)),
    );
  }, []);

  const runAssistantAgent = useCallback(
    async (
      convId: string,
      model: string,
      forApi: ChatMessage[],
      assistantId: string,
      signal: AbortSignal,
    ) => {
      try {
        const text = await agentChatCompletion(forApi, model, signal);
        const finalText = text.trim() || "(empty reply)";
        setList((prev) =>
          prev.map((c) => {
            if (c.id !== convId) return c;
            return {
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistantId ? { ...m, content: finalText } : m,
              ),
              updatedAt: Date.now(),
            };
          }),
        );
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setList((prev) =>
            prev.map((c) => {
              if (c.id !== convId) return c;
              const msgs = c.messages.filter((m) => m.id !== assistantId);
              return { ...c, messages: msgs, updatedAt: Date.now() };
            }),
          );
        } else {
          const errText = e instanceof Error ? e.message : String(e);
          setList((prev) =>
            prev.map((c) => {
              if (c.id !== convId) return c;
              return {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistantId ? { ...m, content: `Error: ${errText}` } : m,
                ),
                updatedAt: Date.now(),
              };
            }),
          );
        }
      }
    },
    [],
  );

  const scheduleTitleGeneration = useCallback(
    (convId: string, firstUserText: string, model: string) => {
      generateConversationTitle(firstUserText, model)
        .then((title) => {
          setList((prev) =>
            prev.map((c) => (c.id === convId ? { ...c, title: title.trim() } : c)),
          );
        })
        .catch(() => {
          setList((prev) =>
            prev.map((c) =>
              c.id === convId ? { ...c, title: fallbackTitle(firstUserText) } : c,
            ),
          );
        });
    },
    [],
  );

  const handleNew = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    const c = emptyConversation();
    setList((prev) => [c, ...prev]);
    setActiveId(c.id);
  }, []);

  const handleSelect = useCallback((id: string) => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setActiveId(id);
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      abortRef.current?.abort();
      abortRef.current = null;
      setStreaming(false);
      setList((prev) => {
        const next = prev.filter((c) => c.id !== id);
        if (next.length === 0) {
          const c = emptyConversation();
          setActiveId(c.id);
          return [c];
        }
        if (activeId === id) {
          setActiveId(next[0].id);
        }
        return next;
      });
    },
    [activeId],
  );

  const handleModelChange = useCallback(
    (model: string) => {
      if (!activeId) return;
      updateConversation(activeId, { model });
    },
    [activeId, updateConversation],
  );

  const handleSend = useCallback(
    async (text: string) => {
      if (!activeId || !active) return;

      const userMsg: ChatMessage = { id: newId(), role: "user", content: text };
      const assistantId = newId();
      const assistantPlaceholder: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
      };

      const forApi: ChatMessage[] = [...active.messages, userMsg];
      const forUi: ChatMessage[] = [...forApi, assistantPlaceholder];

      const shouldGenerateTitle =
        forApi.length === 1 && forApi[0].role === "user" && forApi[0].content.trim().length > 0;

      const convId = activeId;
      const model = active.model;

      updateConversation(convId, {
        messages: forUi,
        title: shouldGenerateTitle ? "New chat" : active.title,
      });

      if (shouldGenerateTitle) {
        scheduleTitleGeneration(convId, text, model);
      }

      setStreaming(true);
      const ac = new AbortController();
      abortRef.current = ac;

      try {
        await runAssistantAgent(convId, model, forApi, assistantId, ac.signal);
      } finally {
        setStreaming(false);
        if (abortRef.current === ac) abortRef.current = null;
      }
    },
    [active, activeId, runAssistantAgent, scheduleTitleGeneration, updateConversation],
  );

  const handleEditUserMessage = useCallback(
    async (messageId: string, newText: string) => {
      const trimmed = newText.trim();
      if (!activeId || !active || !trimmed) return;

      const idx = active.messages.findIndex((m) => m.id === messageId);
      if (idx < 0 || active.messages[idx].role !== "user") return;

      abortRef.current?.abort();
      abortRef.current = null;

      const base = active.messages.slice(0, idx);
      const userMsg: ChatMessage = { id: newId(), role: "user", content: trimmed };
      const assistantId = newId();
      const assistantPlaceholder: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
      };

      const forApi: ChatMessage[] = [...base, userMsg];
      const forUi: ChatMessage[] = [...forApi, assistantPlaceholder];

      const shouldGenerateTitle =
        forApi.length === 1 && forApi[0].role === "user" && forApi[0].content.trim().length > 0;

      const convId = activeId;
      const model = active.model;

      updateConversation(convId, {
        messages: forUi,
        title: shouldGenerateTitle ? "New chat" : active.title,
      });

      if (shouldGenerateTitle) {
        scheduleTitleGeneration(convId, trimmed, model);
      }

      setStreaming(true);
      const ac = new AbortController();
      abortRef.current = ac;

      try {
        await runAssistantAgent(convId, model, forApi, assistantId, ac.signal);
      } finally {
        setStreaming(false);
        if (abortRef.current === ac) abortRef.current = null;
      }
    },
    [active, activeId, runAssistantAgent, scheduleTitleGeneration, updateConversation],
  );

  return (
    <div className="flex h-[100dvh] w-full min-h-0 flex-col overflow-hidden md:flex-row">
      <Sidebar
        conversations={list}
        activeId={activeId}
        onSelect={handleSelect}
        onNew={handleNew}
        onDelete={handleDelete}
      />
      {active && (
        <ChatPane
          messages={active.messages}
          model={active.model}
          onModelChange={handleModelChange}
          onSend={handleSend}
          onEditUserMessage={handleEditUserMessage}
          disabled={streaming}
          streaming={streaming}
        />
      )}
    </div>
  );
}
