import { useCallback } from "react";
import { getApiConfig } from "@/api/client";
import { useRealtimeTranscription } from "@/hooks/useRealtimeTranscription";

export function RealtimePage() {
  const { hasToken } = getApiConfig();
  const {
    connectionState,
    isRecording,
    displayText,
    error,
    transcriptFrozen,
    toggleTranscriptFreeze,
    start,
    stop,
  } = useRealtimeTranscription();

  const label = isRecording
    ? "停止"
    : connectionState === "connecting"
      ? "連接中…"
      : connectionState === "error"
        ? "錄音"
        : "錄音";

  const canStartRecording = hasToken && connectionState === "ready";

  const onPrimary = useCallback(async () => {
    if (isRecording) {
      stop();
      return;
    }
    if (connectionState === "connecting") return;
    if (!canStartRecording) return;
    await start();
  }, [canStartRecording, connectionState, isRecording, start, stop]);

  const connectionLabel =
    connectionState === "ready"
      ? "Live"
      : connectionState === "connecting"
        ? "連接中…"
        : connectionState === "error"
          ? "連線錯誤"
          : "離線";

  const connectionDotClass =
    connectionState === "ready"
      ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]"
      : connectionState === "connecting"
        ? "animate-pulse bg-amber-400"
        : connectionState === "error"
          ? "bg-rose-500"
          : "bg-slate-500";

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 pb-16 pt-12 sm:px-6">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">Transcriptor 2</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          <span className="text-slate-300">雲端即時 STT</span> —{" "}
          <code className="rounded bg-black/30 px-1 font-mono text-2xs">GET /v1/audio/realtime/protocol</code>{" "}
          拉協議說明；{" "}
          <code className="rounded bg-black/30 px-1 font-mono text-2xs">POST …/sessions</code>{" "}
          開 WebSocket，跟協議送{" "}
          <code className="rounded bg-black/30 px-1 font-mono text-2xs">start</code>→PCM→
          <code className="rounded bg-black/30 px-1 font-mono text-2xs">commit</code>→
          <code className="rounded bg-black/30 px-1 font-mono text-2xs">stop</code>
          。連線由視窗聚焦建立；見到 Live 後先可以撳錄音。閒置{" "}
          <span className="font-mono text-2xs">5</span> 分鐘後斷線。Dev{" "}
          <span className="font-mono text-2xs">http://localhost:5182</span>。需要{" "}
          <code className="rounded bg-black/30 px-1 font-mono text-2xs">AI_BUILDER_TOKEN</code>。
        </p>
      </header>

      {!hasToken && (
        <div
          role="status"
          className="mb-8 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
        >
          Set <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-2xs">AI_BUILDER_TOKEN</code> in repo root{" "}
          <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-2xs">.env</code> and restart dev server.
        </div>
      )}

      <div
        role="status"
        aria-live="polite"
        className="mb-6 flex flex-wrap items-center justify-center gap-2 rounded-lg border border-surface-border bg-surface-raised/60 px-4 py-2.5 text-sm text-slate-200"
      >
        <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${connectionDotClass}`} aria-hidden />
        <span className="font-medium tabular-nums">{connectionLabel}</span>
        {connectionState === "ready" && !isRecording && (
          <span className="text-slate-500">· 可開始錄音</span>
        )}
        {(connectionState === "disconnected" || connectionState === "error") && !isRecording && (
          <span className="text-slate-500">· 請點返呢個視窗以連線</span>
        )}
      </div>

      {error && (
        <div role="alert" className="mb-6 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      )}

      <div className="flex flex-col items-center gap-8">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onPrimary}
            disabled={!hasToken || connectionState === "connecting" || (!isRecording && !canStartRecording)}
            className={
              isRecording
                ? "min-h-14 min-w-[10rem] rounded-xl bg-danger px-8 py-4 font-semibold text-danger-foreground shadow-lg disabled:opacity-50"
                : "min-h-14 min-w-[10rem] rounded-xl bg-accent px-8 py-4 font-semibold text-accent-foreground shadow-lg shadow-accent/20 hover:bg-accent-muted disabled:opacity-50"
            }
          >
            {label}
          </button>
          {isRecording && (
            <button
              type="button"
              onClick={toggleTranscriptFreeze}
              className={
                transcriptFrozen
                  ? "min-h-14 min-w-[10rem] rounded-xl border border-surface-border bg-surface-raised px-6 py-4 font-semibold text-slate-100 hover:bg-surface-border/80"
                  : "min-h-14 min-w-[10rem] rounded-xl border border-surface-border bg-surface-raised/60 px-6 py-4 font-semibold text-slate-200 hover:bg-surface-border/80"
              }
            >
              {transcriptFrozen ? "Unfreeze" : "Freeze"}
            </button>
          )}
        </div>

        <section className="w-full space-y-3">
          <p className="text-2xs font-medium uppercase tracking-wider text-slate-500">Transcript（即時）</p>
          <div
            className="min-h-[8rem] rounded-xl border border-surface-border bg-surface-raised/80 p-4 text-[15px] leading-relaxed text-slate-100"
            aria-live="polite"
            aria-relevant="additions text"
          >
            {connectionState === "connecting" && !isRecording && (
              <p className="text-sm text-slate-500">建立連線中…</p>
            )}
            {connectionState === "ready" && !isRecording && !displayText && (
              <p className="text-sm text-slate-500">已連線；撳「錄音」開始，轉寫會即時出現。</p>
            )}
            {(connectionState === "disconnected" || connectionState === "error") && !isRecording && (
              <p className="text-sm text-slate-500">未連線：切返呢個瀏覽器視窗並確保分頁喺前景，見到 Live 後先可以錄音。</p>
            )}
            {isRecording && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <p className="text-2xs font-medium uppercase tracking-wider text-emerald-400/90">
                  錄音中 · 即時轉寫
                </p>
                {transcriptFrozen && (
                  <span className="rounded bg-amber-500/20 px-2 py-0.5 text-2xs font-medium text-amber-200">
                    轉寫已暫停更新
                  </span>
                )}
              </div>
            )}
            {(isRecording || displayText) && (
              <p className="min-h-[1.25rem] whitespace-pre-wrap">{displayText}</p>
            )}
            {connectionState === "ready" && !isRecording && displayText && (
              <p className="mt-3 text-2xs text-slate-500">以上係上次結果；再撳「錄音」清空並開始新一段。</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
