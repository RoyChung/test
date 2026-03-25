"use client";

import type { Conversation } from "@/lib/types";

type Props = {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function Sidebar({ conversations, activeId, onSelect, onNew, onDelete }: Props) {
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <aside className="flex max-h-[40vh] w-full shrink-0 flex-col border-[#2d3a4d] bg-[#131a24] md:max-h-none md:h-auto md:max-w-[300px] md:min-w-[240px] md:border-r">
      <div className="border-b border-[#2d3a4d] p-3">
        <button
          type="button"
          onClick={onNew}
          className="w-full rounded-lg border border-[#3d9eff]/40 bg-[#1a2332] py-2.5 text-sm font-medium text-[#e8eaed] transition hover:border-[#3d9eff]/70 hover:bg-[#1e2a3d]"
        >
          New chat
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        {sorted.length === 0 ? (
          <p className="px-2 py-4 text-center text-sm text-[#8b9cb3]">No conversations yet.</p>
        ) : (
          <ul className="space-y-1">
            {sorted.map((c) => {
              const active = c.id === activeId;
              return (
                <li key={c.id}>
                  <div
                    className={`group flex items-center gap-1 rounded-lg ${
                      active ? "bg-[#1e3a5f]/50 ring-1 ring-[#3d9eff]/30" : "hover:bg-[#1a2332]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(c.id)}
                      className="min-w-0 flex-1 truncate px-3 py-2.5 text-left text-sm text-[#e8eaed]"
                      title={c.title}
                    >
                      <span className="block truncate font-medium">{c.title || "New chat"}</span>
                      <span className="text-xs text-[#8b9cb3]">{formatTime(c.updatedAt)}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(c.id);
                      }}
                      className="shrink-0 rounded px-2 py-2 text-[#8b9cb3] opacity-0 transition hover:text-rose-400 group-hover:opacity-100"
                      aria-label="Delete conversation"
                    >
                      ×
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
      <div className="border-t border-[#2d3a4d] p-3 text-xs text-[#8b9cb3]">
        Chats are stored in this browser only.
      </div>
    </aside>
  );
}
