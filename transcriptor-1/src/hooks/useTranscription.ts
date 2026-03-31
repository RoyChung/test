import { useCallback, useState } from "react";
import { ApiError, transcribeAudio } from "@/api";
import type { TranscriptionResponse } from "@/api/types";
import type { TranscribeOptions } from "@/api/transcribe";
import { analyzeRecording, shouldSkipTranscription } from "@/lib/analyzeRecording";
import { toTraditionalChinese } from "@/lib/toTraditionalChinese";

const SILENT_CLIP_MESSAGE =
  "聽唔到清晰語音，未送出辨識。若你已經有講嘢，請檢查咪高峰或音量。 / No clear speech detected — not sent for transcription. Check your mic or input level if you did speak.";

export interface UseTranscriptionResult {
  text: string | null;
  response: TranscriptionResponse | null;
  isLoading: boolean;
  error: string | null;
  transcribe: (blob: Blob, options?: TranscribeOptions) => Promise<void>;
  clear: () => void;
}

export function useTranscription(): UseTranscriptionResult {
  const [text, setText] = useState<string | null>(null);
  const [response, setResponse] = useState<TranscriptionResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transcribe = useCallback(async (blob: Blob, options?: TranscribeOptions) => {
    setIsLoading(true);
    setError(null);
    try {
      const analysis = await analyzeRecording(blob);
      if (analysis && shouldSkipTranscription(analysis)) {
        setError(SILENT_CLIP_MESSAGE);
        setResponse(null);
        setText(null);
        return;
      }

      const ext =
        blob.type.includes("mp4") || blob.type.includes("m4a")
          ? "m4a"
          : blob.type.includes("ogg")
            ? "ogg"
            : "webm";
      const filename = `recording.${ext}`;
      const data = await transcribeAudio(blob, filename, options);
      const raw = data.text ?? "";
      const displayText = await toTraditionalChinese(raw);
      setResponse({ ...data, text: displayText });
      setText(displayText);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : "Transcription failed");
      }
      setResponse(null);
      setText(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setText(null);
    setResponse(null);
    setError(null);
  }, []);

  return {
    text,
    response,
    isLoading,
    error,
    transcribe,
    clear,
  };
}
