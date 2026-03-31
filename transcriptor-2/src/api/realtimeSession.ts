import { apiFetch } from "./client";

export interface RealtimeSessionCreateRequest {
  language?: string | null;
  prompt?: string | null;
  terms?: string[];
  model?: string;
  vad?: boolean;
  silence_duration_ms?: number;
}

export interface RealtimeSessionCreateResponse {
  session_id: string;
  ticket: string;
  ws_url: string;
  expires_in: number;
}

/** Transcriptor 2 uses only this endpoint for HTTP; audio is streamed on the returned WebSocket. */
const PATH = "/v1/audio/realtime/sessions";

export async function createRealtimeSession(
  body: RealtimeSessionCreateRequest = {},
): Promise<RealtimeSessionCreateResponse> {
  const res = await apiFetch(PATH, {
    method: "POST",
    body: JSON.stringify({
      model: "gpt-realtime",
      vad: true,
      silence_duration_ms: 1200,
      language: "zh-HK",
      prompt: "Transcribe in Traditional Chinese (Hong Kong) where applicable. Do not invent content.",
      terms: [],
      ...body,
    }),
  });
  return res.json() as Promise<RealtimeSessionCreateResponse>;
}
