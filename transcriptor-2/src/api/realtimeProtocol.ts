import { apiFetch } from "./client";

/** Matches OpenAPI `RealtimeProtocolMessageExample`. */
export interface RealtimeProtocolMessageExample {
  direction: "client_to_server" | "server_to_client";
  message_type: string;
  description: string;
  example: Record<string, unknown>;
}

/** Matches OpenAPI `RealtimeProtocolDocResponse` from `GET /v1/audio/realtime/protocol`. */
export interface RealtimeProtocolDocResponse {
  session_endpoint: string;
  websocket_endpoint: string;
  swagger_visibility: string;
  authentication: string;
  prompt_support: string;
  session_request_example: Record<string, unknown>;
  session_response_example: Record<string, unknown>;
  websocket_messages?: RealtimeProtocolMessageExample[];
  notes?: string[];
}

const PATH = "/v1/audio/realtime/protocol";

/**
 * Fetches the discoverable protocol contract (WS message types, examples, notes).
 * Same auth as session creation; safe to call in parallel with `createRealtimeSession`.
 */
export async function fetchRealtimeProtocol(): Promise<RealtimeProtocolDocResponse> {
  const res = await apiFetch(PATH, { method: "GET" });
  return res.json() as Promise<RealtimeProtocolDocResponse>;
}
