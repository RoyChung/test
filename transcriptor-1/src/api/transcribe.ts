import { apiFetch } from "./client";
import type { TranscriptionResponse } from "./types";

const TRANSCRIBE_PATH = "/v1/audio/transcriptions";

/** Default output locale for Chinese segments (Traditional, HK). Prevents Simplified as auto-detect default. */
export const DEFAULT_TRANSCRIPTION_LANGUAGE = "zh-HK";

export interface TranscribeOptions {
  /** BCP-47 hint; defaults to Traditional Chinese (Hong Kong). Pass `""` to request auto-detect (not recommended for 繁體). */
  language?: string;
  /** Optional domain context (Realtime provider only per OpenAPI) */
  prompt?: string;
  /** Comma-separated terms for disambiguation */
  terms?: string;
}

/**
 * POST multipart audio to `/v1/audio/transcriptions` (OpenAPI: `audio_file` or `file`).
 */
export async function transcribeAudio(
  blob: Blob,
  filename = "recording.webm",
  options: TranscribeOptions = {},
): Promise<TranscriptionResponse> {
  const form = new FormData();
  form.append("audio_file", blob, filename);

  const language =
    options.language !== undefined ? options.language : DEFAULT_TRANSCRIPTION_LANGUAGE;
  if (language !== "") {
    form.append("language", language);
  }
  if (options.prompt) {
    form.append("prompt", options.prompt);
  }
  if (options.terms) {
    form.append("terms", options.terms);
  }

  const res = await apiFetch(TRANSCRIBE_PATH, {
    method: "POST",
    body: form,
  });

  return res.json() as Promise<TranscriptionResponse>;
}
