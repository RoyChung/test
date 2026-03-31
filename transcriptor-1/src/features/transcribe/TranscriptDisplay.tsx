import { useCallback, useState } from "react";
import type { TranscriptionResponse } from "@/api/types";

interface TranscriptDisplayProps {
  text: string | null;
  response: TranscriptionResponse | null;
  error: string | null;
  /** When true, show a note that STT can invent plausible text on silence/noise. */
  showHallucinationHint?: boolean;
}

export function TranscriptDisplay({
  text,
  response,
  error,
  showHallucinationHint = true,
}: TranscriptDisplayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [text]);

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-rose-100"
      >
        {error}
      </div>
    );
  }

  if (text === null || text === "") {
    return (
      <p className="text-center text-sm text-slate-500">
        {text === "" ? "No speech detected." : "Transcript will appear here after you stop recording."}
      </p>
    );
  }

  const conf = response?.confidence;
  const lowConfidence =
    typeof conf === "number" && !Number.isNaN(conf) && conf < 0.45;

  return (
    <div className="space-y-3">
      {showHallucinationHint && (
        <p className="rounded-lg border border-surface-border bg-surface-raised/50 px-3 py-2 text-2xs leading-relaxed text-slate-400">
          <span className="text-slate-500">點解有時會出現唔相關嘅字？</span>{" "}
          靜音、環境雜音或訊號太弱時，語音模型有時都會照樣輸出「讀落似真」嘅句子（hallucination），唔代表你真係講過呢啲內容。我哋會喺瀏覽器度用短時能量估計有冇講嘢，但風扇／冷氣等穩定雜音有時仍然會當「有聲」而送去辨識。可以睇信心度，唔對路就當無效、再录過。
        </p>
      )}
      {lowConfidence && (
        <p
          role="status"
          className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-2xs text-amber-100/95"
        >
          信心度偏低（{conf!.toFixed(2)}）— 請核對內容是否與錄音一致。 / Low confidence — verify before using.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xs font-medium uppercase tracking-wider text-slate-500">Transcript</p>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-lg border border-surface-border bg-surface-raised px-3 py-1.5 text-2xs font-medium text-slate-200 hover:bg-surface-border/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="rounded-xl border border-surface-border bg-surface-raised/80 p-4 shadow-inner">
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-100">{text}</p>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-slate-500">
        {response?.detected_language && (
          <p>
            Detected language: <span className="text-slate-400">{response.detected_language}</span>
          </p>
        )}
        {typeof conf === "number" && !Number.isNaN(conf) && (
          <p>
            Confidence: <span className="text-slate-400">{conf.toFixed(2)}</span>
          </p>
        )}
      </div>
    </div>
  );
}
