import { useCallback } from "react";
import { useRecording } from "@/hooks/useRecording";
import { useLocalWhisper } from "@/hooks/useLocalWhisper";

export function LocalWhisperPage() {
  const { isRecording, start, stop, error: recErr, resetError } = useRecording();
  const { text, isLoading, loadStatus, error: whisperErr, transcribeBlob, clear } = useLocalWhisper();

  const onPrimary = useCallback(async () => {
    resetError();
    if (!isRecording) {
      try {
        await start();
        clear();
      } catch {
        return;
      }
      return;
    }
    try {
      const blob = await stop();
      await transcribeBlob(blob);
    } catch (e) {
      console.error(e);
    }
  }, [isRecording, start, stop, transcribeBlob, clear, resetError]);

  const err = recErr || whisperErr;

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 pb-16 pt-12 sm:px-6">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">Transcriptor 3</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          <span className="text-slate-300">Local Whisper</span> (
          <code className="rounded bg-black/30 px-1 font-mono text-2xs">Xenova/whisper-tiny</code> in-browser). No
          API token. First run downloads the model (large). Dev URL{" "}
          <span className="font-mono text-2xs">http://localhost:5183</span>.
        </p>
      </header>

      <div className="flex flex-col items-center gap-8">
        <button
          type="button"
          onClick={onPrimary}
          disabled={isLoading}
          className={
            isRecording
              ? "min-h-14 min-w-[10rem] rounded-xl bg-danger px-8 py-4 font-semibold text-danger-foreground shadow-lg disabled:opacity-50"
              : "min-h-14 min-w-[10rem] rounded-xl bg-accent px-8 py-4 font-semibold text-accent-foreground shadow-lg shadow-accent/20 hover:brightness-110 disabled:opacity-50"
          }
        >
          {isLoading ? "Processing…" : isRecording ? "Stop" : "Record"}
        </button>

        {(loadStatus || isLoading) && (
          <p className="text-center text-sm text-violet-200/90">{loadStatus ?? "…"}</p>
        )}

        {err && (
          <div role="alert" className="w-full rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-rose-100">
            {err}
          </div>
        )}

        <section className="w-full">
          <div className="mb-2 flex justify-between">
            <span className="text-2xs font-medium uppercase tracking-wider text-slate-500">Transcript</span>
            {text && (
              <button
                type="button"
                className="text-2xs text-slate-400 hover:text-slate-200"
                onClick={() => void navigator.clipboard.writeText(text)}
              >
                Copy
              </button>
            )}
          </div>
          <div className="min-h-[6rem] rounded-xl border border-surface-border bg-surface-raised/80 p-4 text-[15px] leading-relaxed text-slate-100">
            {text ? (
              <p className="whitespace-pre-wrap">{text}</p>
            ) : (
              <p className="text-sm text-slate-500">
                Record, stop — text appears after local inference. Chinese shown as 繁體 (HK) via OpenCC.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
