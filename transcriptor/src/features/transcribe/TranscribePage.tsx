import { useCallback, useState } from "react";
import { getApiConfig } from "@/api/client";
import { useRealtimeTranscription } from "@/hooks/useRealtimeTranscription";

export function TranscribePage() {
  const { hasToken } = getApiConfig();
  const {
    connectionState,
    isRecording,
    displayText,
    replayAudioUrl,
    replayDurationSec,
    lastTakeWavBlob,
    replayWsText,
    replayWsError,
    isReplaySending,
    sendRecordingViaRealtime,
    error,
    start,
    stop,
  } = useRealtimeTranscription();
  const [copied, setCopied] = useState(false);

  const label = isRecording ? "Stop" : "Record";

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
        ? "Connecting…"
        : connectionState === "error"
          ? "Connection error"
          : "Offline";

  const connectionDotClass =
    connectionState === "ready"
      ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]"
      : connectionState === "connecting"
        ? "animate-pulse bg-amber-400"
        : connectionState === "error"
          ? "bg-rose-500"
          : "bg-slate-500";

  const copyTranscript = useCallback(async () => {
    if (!displayText.trim()) return;
    try {
      await navigator.clipboard.writeText(displayText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [displayText]);

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 pb-16 pt-12 sm:px-6">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">Transcriptor!</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          Realtime speech-to-text via{" "}
          <code className="rounded bg-black/30 px-1 font-mono text-2xs">POST /v1/audio/realtime/sessions</code>.
          The page connects on load (see Live). Record / Stop streams PCM over the websocket; Stop does not drop the
          connection. Transcript and replay audio are for this take only. Dev server:{" "}
          <span className="font-mono text-2xs">http://localhost:5185</span>. Set{" "}
          <code className="rounded bg-black/30 px-1 font-mono text-2xs">AI_BUILDER_TOKEN</code> in the repo root{" "}
          <code className="rounded bg-black/30 px-1 font-mono text-2xs">.env</code>.
        </p>
      </header>

      {!hasToken && (
        <div
          role="status"
          className="mb-8 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
        >
          Set <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-2xs">AI_BUILDER_TOKEN</code> in the
          repository root <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-2xs">.env</code> and
          restart the dev server.
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
          <span className="text-slate-500">· Ready to record</span>
        )}
        {(connectionState === "disconnected" || connectionState === "error") && !isRecording && (
          <span className="text-slate-500">· Click this window to reconnect</span>
        )}
      </div>

      {error && (
        <div role="alert" className="mb-6 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      )}

      <div className="flex flex-col items-center gap-8">
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

        <section className="w-full space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-2xs font-medium uppercase tracking-wider text-slate-500">Transcript (this take)</p>
            <button
              type="button"
              onClick={copyTranscript}
              disabled={!displayText.trim()}
              className="rounded-lg border border-surface-border bg-surface-raised/80 px-3 py-1.5 text-2xs font-medium text-slate-200 hover:bg-surface-raised disabled:opacity-40"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="min-h-[8rem] rounded-xl border border-surface-border bg-surface-raised/80 p-4 text-[15px] leading-relaxed text-slate-100">
            {connectionState === "connecting" && !isRecording && (
              <p className="text-sm text-slate-500">Connecting…</p>
            )}
            {connectionState === "ready" && !isRecording && !displayText && (
              <p className="text-sm text-slate-500">Live — press Record to speak; text streams in as you go.</p>
            )}
            {(connectionState === "disconnected" || connectionState === "error") && !isRecording && (
              <p className="text-sm text-slate-500">Not connected. Click this browser window to retry.</p>
            )}
            {isRecording && !displayText && (
              <p className="text-sm text-slate-500">Recording… waiting for speech.</p>
            )}
            {displayText && <p className="whitespace-pre-wrap text-slate-100">{displayText}</p>}
          </div>

          {replayAudioUrl && (
            <div className="space-y-2 pt-2">
              <p className="text-2xs font-medium uppercase tracking-wider text-slate-500">
                Replay · 重播（今次錄音）{" "}
                {replayDurationSec != null && (
                  <span className="tabular-nums text-slate-400">~{replayDurationSec.toFixed(1)}s</span>
                )}
              </p>
              <audio
                key={replayAudioUrl}
                className="h-10 w-full rounded-lg border border-surface-border bg-black/20"
                controls
                src={replayAudioUrl}
                preload="metadata"
              />
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => void sendRecordingViaRealtime()}
                  disabled={!hasToken || !lastTakeWavBlob || isReplaySending || isRecording}
                  className="w-full rounded-lg border border-surface-border bg-surface-raised px-4 py-2.5 text-sm font-medium text-slate-100 hover:bg-surface-raised/90 disabled:opacity-40"
                >
                  {isReplaySending
                    ? "Sending PCM… 傳送緊…"
                    : "Send recording via realtime · 經 WebSocket 再轉寫（同 /v1/audio/realtime/sessions）"}
                </button>
              </div>
            </div>
          )}

          {(replayWsText !== null || replayWsError) && (
            <div className="space-y-2 pt-2">
              <p className="text-2xs font-medium uppercase tracking-wider text-slate-500">
                Replay via WebSocket transcript · 再送轉寫結果
              </p>
              {replayWsError && (
                <div
                  role="alert"
                  className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-rose-100"
                >
                  {replayWsError}
                </div>
              )}
              {replayWsText !== null && !replayWsError && (
                <div className="rounded-xl border border-surface-border bg-surface-raised/80 p-4 text-[15px] leading-relaxed text-slate-100">
                  <p className="whitespace-pre-wrap">{replayWsText || "（無文字）"}</p>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
