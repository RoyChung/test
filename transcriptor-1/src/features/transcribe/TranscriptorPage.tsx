import { useCallback } from "react";
import { getApiConfig } from "@/api";
import { useRecording } from "@/hooks/useRecording";
import { useTranscription } from "@/hooks/useTranscription";
import { RecordButton } from "./RecordButton";
import { TranscriptDisplay } from "./TranscriptDisplay";

export function TranscriptorPage() {
  const { hasToken } = getApiConfig();
  const { isRecording, start, stop, error: recordError, resetError } = useRecording();
  const { text, response, isLoading, error: apiError, transcribe, clear } = useTranscription();

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
      await transcribe(blob);
    } catch (e) {
      console.error(e);
    }
  }, [isRecording, start, stop, transcribe, clear, resetError]);

  const combinedError = recordError || apiError;

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 pb-16 pt-12 sm:px-6">
      <header className="mb-10 text-center">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Transcriptor 1
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          <span className="text-slate-300">Cloud batch STT</span> — record, stop, one upload. Chinese shown as
          Traditional (繁體, HK). Dev URL <span className="font-mono text-2xs">http://localhost:5181</span>. Use with
          Transcriptor 2
          (realtime) &amp; 3 (local Whisper).
        </p>
      </header>

      {!hasToken && (
        <div
          role="status"
          className="mb-8 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
        >
          Set <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-2xs">AI_BUILDER_TOKEN</code> in your
          project <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-2xs">.env</code> (repo root or{" "}
          <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-2xs">transcriptor/.env</code>), then
          restart <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-2xs">npm run dev</code>.
        </div>
      )}

      <div className="flex flex-col items-center gap-10">
        <RecordButton
          isRecording={isRecording}
          isBusy={isLoading}
          disabled={!hasToken}
          onPress={onPrimary}
        />

        <section className="w-full">
          <TranscriptDisplay text={text} response={response} error={combinedError} />
        </section>
      </div>
    </div>
  );
}
