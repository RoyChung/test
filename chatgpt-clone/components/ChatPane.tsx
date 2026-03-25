"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MarkdownMessage } from "@/components/MarkdownMessage";
import type { ChatMessage } from "@/lib/types";
import { DEFAULT_MODEL, MODEL_OPTIONS } from "@/lib/types";

type Props = {
  messages: ChatMessage[];
  model: string;
  onModelChange: (m: string) => void;
  onSend: (text: string) => void;
  onEditUserMessage: (messageId: string, newText: string) => void;
  disabled: boolean;
  streaming: boolean;
};

export function ChatPane({
  messages,
  model,
  onModelChange,
  onSend,
  onEditUserMessage,
  disabled,
  streaming,
}: Props) {
  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editAreaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editingId) {
      editAreaRef.current?.focus();
    }
  }, [editingId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  const submit = useCallback(() => {
    const t = input.trim();
    if (!t || disabled) return;
    onSend(t);
    setInput("");
    textareaRef.current?.focus();
  }, [input, disabled, onSend]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#0f1419]">
      <header className="flex flex-wrap items-center gap-3 border-b border-[#2d3a4d] bg-[#1a2332] px-4 py-3">
        <h1 className="text-base font-semibold tracking-tight text-[#e8eaed]">Chat</h1>
        <p className="hidden text-xs text-[#8b9cb3] sm:block sm:max-w-[14rem] md:max-w-none">
          Agent mode — the model may search or read pages when needed (no token streaming).
        </p>
        <label className="ml-auto flex items-center gap-2 text-xs text-[#8b9cb3]">
          Model
          <select
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={disabled}
            className="rounded-lg border border-[#2d3a4d] bg-[#0f1419] px-2 py-1.5 text-sm text-[#e8eaed] outline-none focus:border-[#3d9eff]/50"
          >
            {MODEL_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
            {!MODEL_OPTIONS.some((o) => o.id === model) && (
              <option value={model}>{model}</option>
            )}
          </select>
        </label>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-[52rem]">
          {messages.length === 0 && (
            <p className="py-12 text-center text-[#8b9cb3]">
              Start a conversation. Each turn uses{" "}
              <code className="rounded bg-white/10 px-1">POST /v1/chat/agent</code> — the model decides
              when to search the web or read a page. Default model{" "}
              <span className="text-[#e8eaed]">{DEFAULT_MODEL}</span> (replies are not streamed).
            </p>
          )}
          {messages.map((m, i) => {
            const isPendingAssistant =
              streaming &&
              m.role === "assistant" &&
              m.content === "" &&
              i === messages.length - 1;
            const isEditingUser = m.role === "user" && editingId === m.id;
            return (
              <div
                key={m.id}
                className={`group/msg mb-4 flex flex-col gap-1 ${
                  m.role === "user" ? "items-end" : "items-start"
                }`}
              >
                <span className="text-[0.65rem] uppercase tracking-wider text-[#8b9cb3]">
                  {m.role}
                </span>
                <div
                  className={`max-w-[min(100%,42rem)] rounded-xl border px-4 py-3 ${
                    m.role === "user"
                      ? "border-[#3d9eff]/25 bg-[#1e3a5f] text-[#e8eaed]"
                      : m.content.startsWith("Error:")
                        ? "border-rose-500/40 bg-[#2a1a1a] text-[#fecaca]"
                        : "border-[#2d3a4d] bg-[#252d3a] text-[#e8eaed]"
                  }`}
                >
                  {m.role === "user" && isEditingUser ? (
                    <div className="flex w-full min-w-[min(100%,24rem)] flex-col gap-2">
                      <textarea
                        ref={editAreaRef}
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            const t = editDraft.trim();
                            if (t && !disabled) {
                              onEditUserMessage(m.id, t);
                              setEditingId(null);
                              setEditDraft("");
                            }
                          }
                          if (e.key === "Escape") {
                            setEditingId(null);
                            setEditDraft("");
                          }
                        }}
                        rows={4}
                        disabled={disabled}
                        className="w-full resize-y rounded-lg border border-[#3d9eff]/40 bg-[#0f1419] px-3 py-2 text-sm text-[#e8eaed] outline-none focus:border-[#3d9eff]/70 disabled:opacity-50"
                      />
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            setEditingId(null);
                            setEditDraft("");
                          }}
                          className="rounded-lg border border-[#2d3a4d] px-3 py-1.5 text-xs text-[#e8eaed] hover:bg-white/5 disabled:opacity-40"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={disabled || !editDraft.trim()}
                          onClick={() => {
                            onEditUserMessage(m.id, editDraft.trim());
                            setEditingId(null);
                            setEditDraft("");
                          }}
                          className="rounded-lg bg-[#3d9eff] px-3 py-1.5 text-xs font-medium text-[#0f1419] hover:bg-[#5eb0ff] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Save & resend
                        </button>
                      </div>
                    </div>
                  ) : isPendingAssistant ? (
                    <div className="flex items-center gap-2 text-sm text-[#8b9cb3]">
                      <span className="inline-flex gap-1">
                        <span className="animate-pulse">●</span>
                        <span className="animate-pulse [animation-delay:150ms]">●</span>
                        <span className="animate-pulse [animation-delay:300ms]">●</span>
                      </span>
                      Working… (search / read only if the model chooses)
                    </div>
                  ) : m.role === "assistant" && !m.content.startsWith("Error:") ? (
                    <MarkdownMessage content={m.content} />
                  ) : (
                    <div className="relative w-full">
                      <p className="whitespace-pre-wrap text-[0.95rem] leading-relaxed">{m.content}</p>
                      {m.role === "user" && !disabled && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(m.id);
                            setEditDraft(m.content);
                          }}
                          className="mt-2 text-xs text-[#8b9cb3] underline decoration-[#8b9cb3]/50 underline-offset-2 opacity-100 transition hover:text-[#e8eaed] md:opacity-0 md:group-hover/msg:opacity-100"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-[#2d3a4d] bg-[#131a24] p-4">
        <div className="mx-auto flex max-w-[52rem] flex-col gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Message… (Enter to send, Shift+Enter for newline)"
            rows={3}
            disabled={disabled}
            className="w-full resize-y rounded-xl border border-[#2d3a4d] bg-[#0f1419] px-4 py-3 text-sm text-[#e8eaed] placeholder:text-[#5c6b7f] outline-none focus:border-[#3d9eff]/50 disabled:opacity-50"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={submit}
              disabled={disabled || !input.trim()}
              className="rounded-lg bg-[#3d9eff] px-5 py-2 text-sm font-medium text-[#0f1419] transition hover:bg-[#5eb0ff] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
