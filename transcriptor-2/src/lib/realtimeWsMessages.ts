/**
 * Normalize AI Builder / OpenAI-style realtime WebSocket JSON into UI updates.
 */

export type TranscriptParts = {
  fullText: string | null;
  deltaOnly: string | null;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Walk common shapes: root, data, item, content[], response, result */
export function extractTranscriptParts(msg: Record<string, unknown>): TranscriptParts {
  let fullText: string | null = null;
  let deltaOnly: string | null = null;

  const tryObj = (o: Record<string, unknown>) => {
    if (!fullText && isNonEmptyString(o.text)) fullText = o.text;
    if (!fullText && isNonEmptyString(o.transcript)) fullText = o.transcript;
    if (!fullText && typeof o.content === "string" && o.content.length > 0) fullText = o.content;
    if (!deltaOnly && isNonEmptyString(o.delta)) deltaOnly = o.delta;

    const item = o.item;
    if (item && typeof item === "object") {
      const it = item as Record<string, unknown>;
      if (!fullText && isNonEmptyString(it.transcript)) fullText = it.transcript;
      if (!fullText && isNonEmptyString(it.text)) fullText = it.text;
      const content = it.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (typeof c === "string" && c.length > 0 && !fullText) {
            fullText = c;
          } else if (c && typeof c === "object") {
            const co = c as Record<string, unknown>;
            if (!fullText && isNonEmptyString(co.text)) fullText = co.text;
            if (!fullText && isNonEmptyString(co.transcript)) fullText = co.transcript;
          }
        }
      }
    }

    const response = o.response;
    if (response && typeof response === "object") {
      const r = response as Record<string, unknown>;
      if (!fullText && isNonEmptyString(r.text)) fullText = r.text;
      if (!fullText && isNonEmptyString(r.transcript)) fullText = r.transcript;
    }

    const result = o.result;
    if (result && typeof result === "object") {
      const r = result as Record<string, unknown>;
      if (!fullText && isNonEmptyString(r.text)) fullText = r.text;
      if (!fullText && isNonEmptyString(r.transcript)) fullText = r.transcript;
    }
  };

  tryObj(msg);

  const rootContent = msg.content;
  if (Array.isArray(rootContent) && rootContent.length > 0 && !fullText) {
    const parts: string[] = [];
    for (const c of rootContent) {
      if (typeof c === "string") parts.push(c);
      else if (c && typeof c === "object") {
        const co = c as Record<string, unknown>;
        const p =
          (typeof co.text === "string" && co.text) ||
          (typeof co.transcript === "string" && co.transcript) ||
          "";
        if (p) parts.push(p);
      }
    }
    const joined = parts.filter(Boolean).join(" ").trim();
    if (joined) fullText = joined;
  }

  const data = msg.data;
  if (data && typeof data === "object") {
    tryObj(data as Record<string, unknown>);
  }

  const output = msg.output;
  if (output && typeof output === "object") {
    tryObj(output as Record<string, unknown>);
  }

  const transcription = msg.transcription;
  if (typeof transcription === "string" && transcription.length > 0 && !fullText) {
    fullText = transcription;
  } else if (transcription && typeof transcription === "object") {
    tryObj(transcription as Record<string, unknown>);
  }

  const segments = msg.segments;
  if (Array.isArray(segments) && segments.length > 0 && !fullText) {
    const parts: string[] = [];
    for (const seg of segments) {
      if (typeof seg === "string") parts.push(seg);
      else if (seg && typeof seg === "object") {
        const s = seg as Record<string, unknown>;
        const p =
          (typeof s.text === "string" && s.text) ||
          (typeof s.transcript === "string" && s.transcript) ||
          "";
        if (p) parts.push(p);
      }
    }
    const joined = parts.filter(Boolean).join(" ").trim();
    if (joined) fullText = joined;
  }

  return { fullText, deltaOnly };
}

export function normalizeEventType(msg: Record<string, unknown>): string {
  const t = msg.type ?? msg.event;
  return typeof t === "string" ? t : "";
}

/**
 * Delta: streaming partials. Completed: final segment / utterance end.
 */
export function classifyTranscriptKind(type: string): "delta" | "completed" | "neutral" {
  const t = type;

  if (
    t === "transcript_delta" ||
    t.includes("transcript_delta") ||
    t.includes("input_audio_transcription.delta") ||
    t.includes("audio_transcript.delta") ||
    t.includes("response.audio_transcript.delta") ||
    (t.includes("transcription") && t.includes(".delta")) ||
    (t.includes("audio_transcript") && t.includes("delta"))
  ) {
    return "delta";
  }

  if (
    t === "transcript_completed" ||
    t.includes("transcript_completed") ||
    t.includes("input_audio_transcription.completed") ||
    (t.includes("transcript") && t.includes("completed") && !t.includes(".delta")) ||
    (t.includes("audio_transcript") && (t.includes("done") || t.includes("completed"))) ||
    (t.includes("transcription") && (t.endsWith(".done") || t.includes(".done"))) ||
    t.includes("transcription.completed") ||
    t.includes("response.audio_transcript.done") ||
    t.includes("response.audio_transcript.completed")
  ) {
    return "completed";
  }

  return "neutral";
}

export function wsMessageDataToJsonString(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder("utf-8").decode(data);
  if (ArrayBuffer.isView(data)) {
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    return new TextDecoder("utf-8").decode(buf);
  }
  return null;
}
