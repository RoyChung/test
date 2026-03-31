/** Mirrors OpenAPI `TranscriptionResponse` for `/v1/audio/transcriptions`. */
export interface TranscriptionResponse {
  request_id: string;
  text: string;
  segments?: TranscriptionSegment[] | null;
  detected_language?: string | null;
  duration_seconds?: number | null;
  confidence?: number | null;
  billing?: TranscriptionBillingInfo | null;
}

export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
  confidence?: number | null;
}

export interface TranscriptionBillingInfo {
  audio_input_tokens: number;
  text_input_tokens?: number;
  output_tokens: number;
  audio_input_cost: number;
  text_input_cost?: number;
  text_output_cost: number;
  total_cost: number;
}
