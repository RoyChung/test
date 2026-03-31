import { useCallback, useEffect, useRef, useState } from "react";
import { getApiConfig } from "@/api/client";
import {
  REALTIME_POST_STOP_ACCEPT_MS,
  useRealtimeTranscription,
} from "@/hooks/useRealtimeTranscription";
import { toTraditionalChinese } from "@/lib/toTraditionalChinese";

function IconPlay({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.14v13.72c0 .81.86 1.33 1.58.94l11-6.86a1.05 1.05 0 0 0 0-1.78l-11-6.86A1.05 1.05 0 0 0 8 5.14z" />
    </svg>
  );
}

function formatClockMs(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

function IconSpinner({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" className="opacity-25" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-100" fill="currentColor" d="M12 3a9 9 0 0 1 9 9h-3a6 6 0 0 0-6-6V3z" />
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
    finalizeState,
    isRecording,
    displayText,
    liveDisplayText,
    error,
    start,
    stop,
    clearTranscript,
    lastStopAtMs,
    afterStopTranscriptUpdatedAtMs,
  } = useRealtimeTranscription();

  const [transcriptDisplay, setTranscriptDisplay] = useState("");
  const [liveTranscriptDisplay, setLiveTranscriptDisplay] = useState("");
  const [copyFlash, setCopyFlash] = useState<"live" | "after" | null>(null);
  const copyFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashCopy = useCallback((which: "live" | "after") => {
    if (copyFlashTimerRef.current) clearTimeout(copyFlashTimerRef.current);
    setCopyFlash(which);
    copyFlashTimerRef.current = setTimeout(() => {
      setCopyFlash(null);
      copyFlashTimerRef.current = null;
    }, 2000);
  }, []);

  const copyLiveTranscript = useCallback(async () => {
    const text = liveTranscriptDisplay.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      flashCopy("live");
    } catch {
      // Clipboard may be denied; ignore.
    }
  }, [liveTranscriptDisplay, flashCopy]);

  const copyAfterStopTranscript = useCallback(async () => {
    const text = transcriptDisplay.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      flashCopy("after");
    } catch {
      // Clipboard may be denied; ignore.
    }
  }, [transcriptDisplay, flashCopy]);

  useEffect(() => {
    return () => {
      if (copyFlashTimerRef.current) clearTimeout(copyFlashTimerRef.current);
    };
  }, []);

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

  const isWaitingForFirstTranscript = finalizeState === "waiting_first";
  const isFinalizing = finalizeState !== "idle";
  const canStartRecording = hasToken && connectionState === "ready" && !isFinalizing;

  const onPrimary = useCallback(async () => {
    if (isRecording) {
      stop();
      return;
    }
    if (isFinalizing) return;
    if (connectionState === "connecting") return;
    if (!canStartRecording) return;
    await start();
  }, [canStartRecording, connectionState, isFinalizing, isRecording, start, stop]);

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
    !hasToken || connectionState === "connecting" || isFinalizing || (!isRecording && !canStartRecording);

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
            aria-label={isRecording ? "Stop recording" : isWaitingForFirstTranscript ? "Finalizing transcript" : "Start recording"}
            className={
              isRecording
                ? "flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-red-900/30 transition hover:bg-red-500 disabled:opacity-50"
                : isWaitingForFirstTranscript
                  ? "flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white shadow-lg shadow-amber-900/30 transition disabled:opacity-100"
                : "flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-500 disabled:opacity-50"
            }
          >
            {isRecording ? (
              <IconStopSquare className="h-7 w-7" />
            ) : isWaitingForFirstTranscript ? (
              <IconSpinner className="h-8 w-8 animate-spin" />
            ) : (
              <IconPlay className="ml-0.5 h-8 w-8" />
            )}
          </button>
          {isFinalizing && (
            <p className="w-full text-center text-xs text-slate-500">
              {isWaitingForFirstTranscript ? "Finalizing transcript..." : "Transcript is still updating..."}
            </p>
          )}
        </div>

        <section className="w-full space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-2xs font-medium uppercase tracking-wider text-emerald-400/90">Transcript 2 · Live</p>
            <button
              type="button"
              onClick={copyLiveTranscript}
              disabled={!liveTranscriptDisplay.trim()}
              aria-label="Copy live transcript"
              className="rounded-lg border border-emerald-500/30 bg-emerald-950/40 px-3 py-1.5 text-2xs font-medium text-slate-200 hover:bg-emerald-900/50 disabled:pointer-events-none disabled:opacity-40"
            >
              {copyFlash === "live" ? "Copied" : "Copy"}
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
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={copyAfterStopTranscript}
                disabled={!transcriptDisplay.trim()}
                aria-label="Copy after-stop transcript"
                className="rounded-lg border border-surface-border bg-surface-raised/80 px-3 py-1.5 text-2xs font-medium text-slate-300 hover:bg-surface-border/80 disabled:pointer-events-none disabled:opacity-40"
              >
                {copyFlash === "after" ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={clearTranscript}
                disabled={isRecording || isFinalizing || !displayText}
                className="rounded-lg border border-surface-border bg-surface-raised/80 px-3 py-1.5 text-2xs font-medium text-slate-300 hover:bg-surface-border/80 disabled:pointer-events-none disabled:opacity-40"
              >
                Clear
              </button>
            </div>
          </div>
          {lastStopAtMs != null && (
            <p className="text-2xs leading-relaxed text-slate-500 tabular-nums">
              <span className="font-medium text-slate-400">Stop</span> {formatClockMs(lastStopAtMs)}
              {afterStopTranscriptUpdatedAtMs != null &&
                Math.abs(afterStopTranscriptUpdatedAtMs - lastStopAtMs) > 250 && (
                  <>
                    {" "}
                    <span className="text-slate-600">·</span>{" "}
                    <span className="font-medium text-slate-400">Last text update</span>{" "}
                    {formatClockMs(afterStopTranscriptUpdatedAtMs)}
                    <span className="text-slate-600">
                      {" "}
                      (+{(afterStopTranscriptUpdatedAtMs - lastStopAtMs).toFixed(0)} ms)
                    </span>
                  </>
                )}
              <span className="mt-1 block text-slate-600">
                If a pending snapshot exists, it appears immediately after Stop. Otherwise the button waits for the first
                result; once text appears, this box may keep refining in the background for up to{" "}
                {REALTIME_POST_STOP_ACCEPT_MS / 1000} s.
              </span>
            </p>
          )}
          <div
            className="min-h-[8rem] rounded-xl border border-surface-border bg-surface-raised/80 p-4 text-[15px] leading-relaxed text-slate-100"
            aria-live="polite"
            aria-relevant="additions text"
          >
            {isWaitingForFirstTranscript && !displayText && <p className="text-sm text-slate-500">Finalizing transcript...</p>}
            {connectionUiState === "ready" && !isRecording && !displayText && !isWaitingForFirstTranscript && (
              <p className="text-sm text-slate-500">Transcription will appear here.</p>
            )}
            {(connectionUiState === "disconnected" || connectionUiState === "error") && !isRecording && !isFinalizing && (
              <p className="text-sm text-slate-500">Not connected. Focus this tab, then press Record when you see Ready.</p>
            )}
            {isRecording && <p className="text-sm text-slate-500">Listening…</p>}
            {!isRecording && displayText ? (
              <p className="min-h-[1.25rem] whitespace-normal break-words" lang="zh-Hant-HK">
                {transcriptDisplay}
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
