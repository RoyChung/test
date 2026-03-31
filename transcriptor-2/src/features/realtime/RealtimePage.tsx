import { useCallback, useEffect, useState } from "react";
import { getApiConfig } from "@/api/client";
import { useRealtimeTranscription } from "@/hooks/useRealtimeTranscription";
import { toTraditionalChinese } from "@/lib/toTraditionalChinese";

function IconPlay({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.14v13.72c0 .81.86 1.33 1.58.94l11-6.86a1.05 1.05 0 0 0 0-1.78l-11-6.86A1.05 1.05 0 0 0 8 5.14z" />
    </svg>
  );
}

function IconStopSquare({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

export function RealtimePage() {
  const { hasToken } = getApiConfig();
  const {
    connectionState,
    connectionUiState,
    isRecording,
    displayText,
    liveDisplayText,
    error,
    start,
    stop,
    clearTranscript,
    clearLiveTranscript,
  } = useRealtimeTranscription();

  const [transcriptDisplay, setTranscriptDisplay] = useState("");
  const [liveTranscriptDisplay, setLiveTranscriptDisplay] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!displayText) {
      setTranscriptDisplay("");
      return;
    }
    setTranscriptDisplay(displayText);
    void toTraditionalChinese(displayText).then((t) => {
      if (!cancelled) setTranscriptDisplay(t);
    });
    return () => {
      cancelled = true;
    };
  }, [displayText]);

  useEffect(() => {
    let cancelled = false;
    if (!liveDisplayText) {
      setLiveTranscriptDisplay("");
      return;
    }
    setLiveTranscriptDisplay(liveDisplayText);
    void toTraditionalChinese(liveDisplayText).then((t) => {
      if (!cancelled) setLiveTranscriptDisplay(t);
    });
    return () => {
      cancelled = true;
    };
  }, [liveDisplayText]);

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
    connectionUiState === "ready"
      ? "Ready"
      : connectionUiState === "connecting"
        ? "Connecting…"
        : connectionUiState === "error"
          ? "Connection error"
          : "Offline";

  const connectionDotClass =
    connectionUiState === "ready"
      ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]"
      : connectionUiState === "connecting"
        ? "animate-pulse bg-amber-400"
        : connectionUiState === "error"
          ? "bg-rose-500"
          : "bg-slate-500";

  const primaryDisabled =
    !hasToken || connectionState === "connecting" || (!isRecording && !canStartRecording);

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 pb-16 pt-12 sm:px-6">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">Transcriptor 2</h1>
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
        {(connectionState === "disconnected" || connectionState === "error") && !isRecording && (
          <span className="text-slate-500">· Click this window to connect.</span>
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
            disabled={primaryDisabled}
            aria-label={isRecording ? "Stop recording" : "Start recording"}
            className={
              isRecording
                ? "flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-red-900/30 transition hover:bg-red-500 disabled:opacity-50"
                : "flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-500 disabled:opacity-50"
            }
          >
            {isRecording ? <IconStopSquare className="h-7 w-7" /> : <IconPlay className="ml-0.5 h-8 w-8" />}
          </button>
        </div>

        <section className="w-full space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-2xs font-medium uppercase tracking-wider text-emerald-400/90">Transcript 2 · Live</p>
            <button
              type="button"
              onClick={clearLiveTranscript}
              disabled={isRecording || !liveDisplayText}
              className="rounded-lg border border-emerald-500/30 bg-emerald-950/40 px-3 py-1.5 text-2xs font-medium text-slate-200 hover:bg-emerald-900/50 disabled:pointer-events-none disabled:opacity-40"
            >
              Clear
            </button>
          </div>
          <div
            className="min-h-[6rem] rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-4 text-[15px] leading-relaxed text-slate-100"
            aria-live="polite"
            aria-relevant="additions text"
          >
            {liveDisplayText ? (
              <p className="min-h-[1.25rem] whitespace-normal break-words" lang="zh-Hant-HK">
                {liveTranscriptDisplay}
              </p>
            ) : (
              <>
                {connectionUiState === "connecting" && !isRecording && (
                  <p className="text-sm text-slate-500">Connecting…</p>
                )}
                {connectionUiState === "ready" && !isRecording && (
                  <p className="text-sm text-slate-500">Transcription will appear here.</p>
                )}
                {(connectionUiState === "disconnected" || connectionUiState === "error") && !isRecording && (
                  <p className="text-sm text-slate-500">No live transcript while offline.</p>
                )}
                {isRecording && <p className="text-sm text-slate-500">Listening…</p>}
              </>
            )}
          </div>
        </section>

        <section className="w-full space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-2xs font-medium uppercase tracking-wider text-slate-500">Transcript · After stop</p>
            <button
              type="button"
              onClick={clearTranscript}
              disabled={isRecording || !displayText}
              className="rounded-lg border border-surface-border bg-surface-raised/80 px-3 py-1.5 text-2xs font-medium text-slate-300 hover:bg-surface-border/80 disabled:pointer-events-none disabled:opacity-40"
            >
              Clear
            </button>
          </div>
          <div
            className="min-h-[8rem] rounded-xl border border-surface-border bg-surface-raised/80 p-4 text-[15px] leading-relaxed text-slate-100"
            aria-live="polite"
            aria-relevant="additions text"
          >
            {connectionUiState === "connecting" && !isRecording && (
              <p className="text-sm text-slate-500">Connecting…</p>
            )}
            {connectionUiState === "ready" && !isRecording && !displayText && (
              <p className="text-sm text-slate-500">Transcription will appear here.</p>
            )}
            {(connectionUiState === "disconnected" || connectionUiState === "error") && !isRecording && (
              <p className="text-sm text-slate-500">Not connected. Focus this tab, then press Record when you see Ready.</p>
            )}
            {isRecording && (
              <p className="text-sm text-slate-500">
                Recording… The full transcript will appear here after you press Stop (live preview is above).
              </p>
            )}
            {!isRecording && displayText ? (
              <p className="min-h-[1.25rem] whitespace-normal break-words" lang="zh-Hant-HK">
                {transcriptDisplay}
              </p>
            ) : null}
            {connectionState === "ready" && !isRecording && displayText && (
              <p className="mt-3 text-2xs text-slate-500">
                Your last result is shown above. Press the green button again to clear and start a new take.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
