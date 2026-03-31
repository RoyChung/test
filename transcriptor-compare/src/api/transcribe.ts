import { apiFetch } from "./client";

export interface TranscriptionResponse {
  request_id: string;
  text: string;
}

const PATH = "/v1/audio/transcriptions";

export async function transcribeBatch(blob: Blob, filename = "recording.webm"): Promise<string> {
  const form = new FormData();
  form.append("audio_file", blob, filename);
  form.append("language", "zh-HK");

  const res = await apiFetch(PATH, {
    method: "POST",
    body: form,
  });

  const json = (await res.json()) as TranscriptionResponse;
  return json.text ?? "";
}
