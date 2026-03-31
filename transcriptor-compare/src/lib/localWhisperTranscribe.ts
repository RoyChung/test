import { blobTo16kMonoFloat32 } from "@/lib/audio";
import { toTraditionalChinese } from "@/lib/toTraditionalChinese";

type TranscriberFn = (audio: Float32Array, opts?: Record<string, unknown>) => Promise<unknown>;

let transcriberPromise: Promise<TranscriberFn> | null = null;

async function configureTransformersEnv(): Promise<void> {
  const { env } = await import("@xenova/transformers");
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

async function getTranscriber(): Promise<TranscriberFn> {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      await configureTransformersEnv();
      const { pipeline } = await import("@xenova/transformers");
      const t = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny", {});
      return t as TranscriberFn;
    })();
  }
  return transcriberPromise;
}

export async function transcribeLocalWhisper(blob: Blob): Promise<string> {
  const audio = await blobTo16kMonoFloat32(blob);
  const transcriber = await getTranscriber();
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
  return toTraditionalChinese(raw);
}
