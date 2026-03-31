import { useCallback, useState } from "react";
import { blobTo16kMonoFloat32 } from "@/lib/audio";
import { toTraditionalChinese } from "@/lib/toTraditionalChinese";

type ProgressStatus = string;

/** Lazy pipeline — static import of @xenova/transformers breaks or white-screens first paint. */
type TranscriberFn = (audio: Float32Array, opts?: Record<string, unknown>) => Promise<unknown>;

let transcriberPromise: Promise<TranscriberFn> | null = null;

async function configureTransformersEnv(): Promise<void> {
  const { env } = await import("@xenova/transformers");
  // Default allowLocalModels=true makes hub.js fetch `/models/.../config.json` on the dev origin;
  // Vite returns index.html (200) → JSON.parse sees "<!doctype".
  env.allowLocalModels = false;
  env.useFS = false;
  env.useBrowserCache = false;
  if (typeof caches !== "undefined") {
    try {
      await caches.delete("transformers-cache");
    } catch {
      /* ignore */
    }
  }
}

async function getTranscriber(onProgress?: (s: ProgressStatus) => void): Promise<TranscriberFn> {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      await configureTransformersEnv();
      const { pipeline } = await import("@xenova/transformers");
      const t = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny", {
        progress_callback: (info: { status?: string; file?: string }) => {
          if (info.status === "progress" && info.file) {
            onProgress?.(`Loading ${info.file}…`);
          } else if (info.status === "download") {
            onProgress?.("Downloading model…");
          } else if (info.status === "ready") {
            onProgress?.("Ready");
          }
        },
      });
      return t as TranscriberFn;
    })();
  }
  return transcriberPromise;
}

function resetPipeline(): void {
  transcriberPromise = null;
}

export interface UseLocalWhisperResult {
  text: string | null;
  isLoading: boolean;
  loadStatus: string | null;
  error: string | null;
  transcribeBlob: (blob: Blob) => Promise<void>;
  clear: () => void;
}

export function useLocalWhisper(): UseLocalWhisperResult {
  const [text, setText] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadStatus, setLoadStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const transcribeBlob = useCallback(async (blob: Blob) => {
    setIsLoading(true);
    setError(null);
    setLoadStatus("Preparing audio…");
    try {
      const audio = await blobTo16kMonoFloat32(blob);
      setLoadStatus("Loading Whisper (first run downloads model)…");
      const transcriber = await getTranscriber((s) => setLoadStatus(s));
      setLoadStatus("Transcribing…");
      const out = await transcriber(audio, {
        sampling_rate: 16000,
        language: "zh",
        task: "transcribe",
      });
      const raw =
        typeof out === "string"
          ? out
          : out && typeof out === "object" && "text" in out
            ? String((out as { text: string }).text)
            : "";
      const display = await toTraditionalChinese(raw);
      setText(display);
      setLoadStatus(null);
    } catch (e) {
      resetPipeline();
      setError(e instanceof Error ? e.message : "Transcription failed");
      setText(null);
      setLoadStatus(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setText(null);
    setError(null);
    setLoadStatus(null);
    resetPipeline();
  }, []);

  return { text, isLoading, loadStatus, error, transcribeBlob, clear };
}
