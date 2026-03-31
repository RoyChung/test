import { createRealtimeSession } from "@/api/realtimeSession";
import { getRealtimeWebSocketUrl } from "@/api/client";
import { blobTo24kMonoFloat32 } from "@/lib/audio";
import { floatTo16BitPCM } from "@/lib/pcm";
import { toTraditionalChinese } from "@/lib/toTraditionalChinese";

function delay(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

/** Pace PCM like live mic (~2048 samples @ 24k per ~85ms). */
async function paceSendPcm(ws: WebSocket, f24: Float32Array): Promise<void> {
  const chunkSize = 2048;
  const ms = (chunkSize / 24000) * 1000;
  for (let i = 0; i < f24.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, f24.length);
    const chunk = f24.subarray(i, end);
    const pcm = floatTo16BitPCM(chunk);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(pcm.buffer);
    }
    if (end < f24.length) {
      await delay(ms);
    }
  }
}

type WsJson = {
  type?: string;
  text?: string;
  delta?: string;
  transcript?: string;
  message?: string;
  code?: string;
  data?: { text?: string; transcript?: string; delta?: string };
};

function applyTranscriptMessage(
  type: string | undefined,
  msg: WsJson,
  completed: string[],
  liveRef: { current: string },
): void {
  const fromData = msg.data;
  const text =
    typeof msg.text === "string"
      ? msg.text
      : typeof msg.transcript === "string"
        ? msg.transcript
        : typeof fromData?.text === "string"
          ? fromData.text
          : typeof fromData?.transcript === "string"
            ? fromData.transcript
            : null;

  const delta =
    typeof msg.delta === "string"
      ? msg.delta
      : typeof fromData?.delta === "string"
        ? fromData.delta
        : null;

  const t = type ?? "";

  if (
    t === "transcript_delta" ||
    t.includes("transcript_delta") ||
    (t.includes("transcript") && t.includes("delta"))
  ) {
    if (text !== null) {
      liveRef.current = text;
    } else if (delta !== null) {
      liveRef.current += delta;
    }
    return;
  }

  if (
    t === "transcript_completed" ||
    t.includes("transcript_completed") ||
    (t.includes("transcript") && t.includes("completed"))
  ) {
    const segment = text ?? delta ?? "";
    if (segment) {
      completed.push(segment);
    } else if (liveRef.current) {
      completed.push(liveRef.current);
    }
    liveRef.current = "";
    return;
  }

  if (text !== null && (t.includes("transcript") || t.includes("Transcription"))) {
    liveRef.current = text;
  }
}

/**
 * Upload recorded audio via realtime WebSocket (same endpoint as Transcriptor 2),
 * streaming decoded PCM at realtime pace after session_ready.
 *
 * Binds `onmessage` before `open` resolves (same order as useRealtimeTranscription) so
 * early frames like session_ready / transcript are never dropped.
 */
export async function transcribeRealtimeFromBlob(blob: Blob): Promise<string> {
  const session = await createRealtimeSession({ vad: false });
  const wsUrl = getRealtimeWebSocketUrl(session.ws_url);
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  const completed: string[] = [];
  const liveRef = { current: "" };
  let resolveReady: (() => void) | null = null;
  const readyPromise = new Promise<void>((res) => {
    resolveReady = res;
  });

  let serverError: string | null = null;

  ws.onmessage = (ev) => {
    if (typeof ev.data !== "string") return;
    let msg: WsJson;
    try {
      msg = JSON.parse(ev.data) as WsJson;
    } catch {
      return;
    }
    const type = msg.type;
    if (type === "session_ready") {
      resolveReady?.();
      resolveReady = null;
      return;
    }
    if (type === "error") {
      serverError = msg.message ?? msg.code ?? "Realtime error";
      return;
    }
    applyTranscriptMessage(type, msg, completed, liveRef);
  };

  await new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error("WebSocket open timeout")), 15000);
    ws.onopen = () => {
      window.clearTimeout(t);
      resolve();
    };
    ws.onerror = () => reject(new Error("WebSocket error"));
  });

  const decodePromise = blobTo24kMonoFloat32(blob);

  await Promise.race([
    readyPromise,
    new Promise<void>((_, reject) =>
      window.setTimeout(() => reject(new Error("Timed out waiting for session_ready")), 15000),
    ),
  ]);

  const f24 = await decodePromise;
  await paceSendPcm(ws, f24);

  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "stop" }));
  }

  await delay(5000);

  if (serverError) {
    throw new Error(serverError);
  }

  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }

  const raw = [...completed, liveRef.current].filter(Boolean).join("\n").trim();
  return toTraditionalChinese(raw);
}
