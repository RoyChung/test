import { apiFetch } from "./client";

export interface RealtimeSessionCreateResponse {
  session_id: string;
  ticket: string;
  ws_url: string;
  expires_in: number;
}

const PATH = "/v1/audio/realtime/sessions";

export interface CreateRealtimeSessionOptions {
  /**
   * Live mic: true. Pre-recorded PCM replay: false — avoids VAD/silence heuristics
   * dropping utterances when audio is streamed after decode latency.
   */
  vad?: boolean;
  silence_duration_ms?: number;
}

export async function createRealtimeSession(
  options: CreateRealtimeSessionOptions = {},
): Promise<RealtimeSessionCreateResponse> {
  const vad = options.vad ?? true;
  const silence_duration_ms = options.silence_duration_ms ?? 1200;
  const res = await apiFetch(PATH, {
    method: "POST",
    body: JSON.stringify({
      model: "gpt-realtime",
      vad,
      silence_duration_ms,
      language: "zh-HK",
      prompt: "Transcribe in Traditional Chinese (Hong Kong) where applicable. Do not invent content.",
      terms: [],
    }),
  });
  return res.json() as Promise<RealtimeSessionCreateResponse>;
}
