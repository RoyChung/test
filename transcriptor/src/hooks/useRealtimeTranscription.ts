import { useCallback, useEffect, useRef, useState } from "react";
import { createRealtimeSession } from "@/api/realtimeSession";
import { getApiConfig, getRealtimeWebSocketUrl } from "@/api/client";
import { downsample48to24, floatTo16BitPCM } from "@/lib/pcm";
import {
  classifyTranscriptKind,
  extractTranscriptParts,
  normalizeEventType,
  wsMessageDataToJsonString,
} from "@/lib/realtimeWsMessages";

import workletUrl from "@/audio/pcm-capture.worklet.js?url";
import { concatInt16Chunks, pcm16MonoToWavBlob, wavBlobToMonoPcm16 } from "@/lib/wav";

/** WebSocket + session_ready; mic may be off until Start. */
export type ConnectionState = "disconnected" | "connecting" | "ready" | "error";

const IDLE_DISCONNECT_MS = 5 * 60 * 1000;
/** Server may emit final text after `stop` or after reconnect; allow late events. */
const POST_STOP_ACCEPT_MS = 12000;
/** Backup flush after stop window; primary updates happen in applyTranscriptMessage. */
const FLUSH_DELAY_MS = POST_STOP_ACCEPT_MS + 500;
/** Server requires ≥100ms of PCM before commit; pad so buffer is never empty. */
const PCM_PAD_MS = 120;
const SAMPLE_RATE_OUT = 24000;

function resampleTo24k(input: Float32Array, srcRate: number): Float32Array {
  if (srcRate === 48000) return downsample48to24(input);
  const dstRate = 24000;
  const ratio = srcRate / dstRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const j = i * ratio;
    const j0 = Math.floor(j);
    const j1 = Math.min(j0 + 1, input.length - 1);
    const f = j - j0;
    out[i] = input[j0] * (1 - f) + input[j1] * f;
  }
  return out;
}

let wsDebugLogged = 0;

function mergePendingToText(lines: string[], live: string): string {
  return [...lines, live].filter(Boolean).join("\n").trim();
}

/** Shared OpenAI-style transcript delta/completed handling (mutates refs only). */
function applyTranscriptMessageToPending(
  msg: Record<string, unknown>,
  linesRef: { current: string[] },
  liveRef: { current: string },
): void {
  const t = normalizeEventType(msg);
  const { fullText, deltaOnly } = extractTranscriptParts(msg);
  const kind = classifyTranscriptKind(t);

  if (kind === "delta") {
    if (fullText !== null) {
      liveRef.current = fullText;
    } else if (deltaOnly !== null) {
      liveRef.current += deltaOnly;
    }
  } else if (kind === "completed") {
    const segment = fullText ?? deltaOnly ?? "";
    if (segment) {
      linesRef.current = [...linesRef.current, segment];
      liveRef.current = "";
    } else if (liveRef.current) {
      linesRef.current = [...linesRef.current, liveRef.current];
      liveRef.current = "";
    }
  } else if (t === "session_stopped" || t.includes("session_stopped")) {
    const segment = fullText ?? deltaOnly ?? "";
    if (segment) {
      linesRef.current = [...linesRef.current, segment];
      liveRef.current = "";
    } else if (liveRef.current) {
      linesRef.current = [...linesRef.current, liveRef.current];
      liveRef.current = "";
    }
  } else if (fullText !== null && (t.includes("transcript") || t.includes("Transcription"))) {
    liveRef.current = fullText;
  } else if (kind === "neutral" && (fullText !== null || deltaOnly !== null)) {
    if (fullText !== null) {
      linesRef.current = [...linesRef.current, fullText];
      liveRef.current = "";
    } else if (deltaOnly !== null) {
      liveRef.current += deltaOnly;
    }
  }
}

export interface UseRealtimeTranscriptionResult {
  connectionState: ConnectionState;
  /** True while mic is capturing and sending PCM (between Start and Stop). */
  isRecording: boolean;
  /** Shown only after Stop — text from the last Start–Stop segment only (no accumulation). */
  displayText: string;
  /** Object URL for the last take’s WAV replay, or null if none / cleared. */
  replayAudioUrl: string | null;
  /** Approximate duration of `replayAudioUrl` in seconds (for UI). */
  replayDurationSec: number | null;
  /** Same WAV as replay — streamed over the realtime WebSocket when re-sending. */
  lastTakeWavBlob: Blob | null;
  /** Transcript from sending the last take again over `/v1/audio/realtime/sessions` WebSocket (PCM replay). */
  replayWsText: string | null;
  replayWsError: string | null;
  isReplaySending: boolean;
  /** Stream `lastTakeWavBlob` PCM over the existing realtime WebSocket (same API as live mic). */
  sendRecordingViaRealtime: () => Promise<void>;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

export function useRealtimeTranscription(): UseRealtimeTranscriptionResult {
  const hasToken = getApiConfig().hasToken;
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [isRecording, setIsRecording] = useState(false);
  const [displayText, setDisplayText] = useState("");
  const [replayAudioUrl, setReplayAudioUrl] = useState<string | null>(null);
  const [replayDurationSec, setReplayDurationSec] = useState<number | null>(null);
  const [lastTakeWavBlob, setLastTakeWavBlob] = useState<Blob | null>(null);
  const [replayWsText, setReplayWsText] = useState<string | null>(null);
  const [replayWsError, setReplayWsError] = useState<string | null>(null);
  const [isReplaySending, setIsReplaySending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pcmChunksRef = useRef<Int16Array[]>([]);
  const replayObjectUrlRef = useRef<string | null>(null);

  const revokeReplayUrl = useCallback(() => {
    if (replayObjectUrlRef.current) {
      URL.revokeObjectURL(replayObjectUrlRef.current);
      replayObjectUrlRef.current = null;
    }
    setReplayAudioUrl(null);
    setReplayDurationSec(null);
    setLastTakeWavBlob(null);
  }, []);

  const connectionStateRef = useRef(connectionState);
  const isRecordingRef = useRef(false);
  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const liveRef = useRef(false);

  const sessionReuseOkRef = useRef(false);
  const recordingActiveRef = useRef(false);
  const postStopAcceptUntilRef = useRef(0);
  const pendingLinesRef = useRef<string[]>([]);
  const pendingLiveRef = useRef("");

  const idleDisconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectInFlightRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);
  /** After user sends `{ type: "stop" }`, backend may close the socket — reconnect without showing offline. */
  const reconnectAfterUserStopRef = useRef(false);
  const reconnectAfterStopClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectWebSocketRef = useRef<() => Promise<void>>(async () => {});

  const clearIdleTimer = useCallback(() => {
    if (idleDisconnectTimerRef.current !== null) {
      clearTimeout(idleDisconnectTimerRef.current);
      idleDisconnectTimerRef.current = null;
    }
  }, []);

  const clearFlushTimer = useCallback(() => {
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const scheduleIdleDisconnect = useCallback(() => {
    clearIdleTimer();
    idleDisconnectTimerRef.current = window.setTimeout(() => {
      idleDisconnectTimerRef.current = null;
      const ws = wsRef.current;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
      wsRef.current = null;
      sessionReuseOkRef.current = false;
    }, IDLE_DISCONNECT_MS);
  }, [clearIdleTimer]);

  const flushPendingToDisplay = useCallback(() => {
    const text = mergePendingToText(pendingLinesRef.current, pendingLiveRef.current);
    pendingLinesRef.current = [];
    pendingLiveRef.current = "";
    setDisplayText(text);
  }, []);

  const replaySendActiveRef = useRef(false);
  const replayPostStopUntilRef = useRef(0);
  const replayPendingLinesRef = useRef<string[]>([]);
  const replayPendingLiveRef = useRef("");
  const replayFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearReplayFlushTimer = useCallback(() => {
    if (replayFlushTimerRef.current !== null) {
      clearTimeout(replayFlushTimerRef.current);
      replayFlushTimerRef.current = null;
    }
  }, []);

  const flushReplayPendingToDisplay = useCallback(() => {
    const text = mergePendingToText(replayPendingLinesRef.current, replayPendingLiveRef.current);
    replayPendingLinesRef.current = [];
    replayPendingLiveRef.current = "";
    setReplayWsText(text);
  }, []);

  const applyTranscriptMessage = useCallback((msg: Record<string, unknown>) => {
    const replayAccept =
      replaySendActiveRef.current || Date.now() < replayPostStopUntilRef.current;
    const liveAccept =
      !replayAccept &&
      (recordingActiveRef.current || Date.now() < postStopAcceptUntilRef.current);

    if (!replayAccept && !liveAccept) return;

    if (replayAccept) {
      applyTranscriptMessageToPending(msg, replayPendingLinesRef, replayPendingLiveRef);
      setReplayWsText(mergePendingToText(replayPendingLinesRef.current, replayPendingLiveRef.current));
      return;
    }

    applyTranscriptMessageToPending(msg, pendingLinesRef, pendingLiveRef);
    /** `liveAccept` implies recording or post-stop — always reflect partial + committed text. */
    setDisplayText(mergePendingToText(pendingLinesRef.current, pendingLiveRef.current));
  }, []);

  const cleanupAudio = useCallback(() => {
    workletRef.current?.disconnect();
    workletRef.current = null;
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    liveRef.current = false;
  }, []);

  const setupAudioGraph = useCallback(
    async (ws: WebSocket) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      await ctx.audioWorklet.addModule(workletUrl);

      const srcRate = ctx.sampleRate;
      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const capture = new AudioWorkletNode(ctx, "pcm-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      workletRef.current = capture;

      capture.port.onmessage = (ev: MessageEvent) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const raw = ev.data;
        const input =
          raw instanceof Float32Array
            ? raw
            : raw instanceof ArrayBuffer
              ? new Float32Array(raw)
              : ArrayBuffer.isView(raw)
                ? new Float32Array(
                    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
                  )
                : null;
        if (!input || input.length === 0) return;
        const f32 = resampleTo24k(input, srcRate);
        const pcm = floatTo16BitPCM(f32);
        ws.send(pcm.buffer);
        pcmChunksRef.current.push(new Int16Array(pcm));
      };

      const mute = ctx.createGain();
      mute.gain.value = 0;
      source.connect(capture);
      capture.connect(mute);
      mute.connect(ctx.destination);

      if (ctx.state !== "running") {
        await ctx.resume();
      }
      let tries = 0;
      while (ctx.state !== "running" && tries < 100) {
        await new Promise((r) => window.setTimeout(r, 10));
        tries += 1;
      }

      const padSamples = Math.ceil((SAMPLE_RATE_OUT * PCM_PAD_MS) / 1000);
      const padF32 = new Float32Array(padSamples);
      const padPcm = floatTo16BitPCM(padF32);
      if (ws.readyState === WebSocket.OPEN && padPcm.byteLength > 0) {
        ws.send(padPcm.buffer);
      }

      liveRef.current = true;
    },
    [],
  );

  const connectWebSocket = useCallback(async (): Promise<void> => {
    if (connectInFlightRef.current) {
      await connectInFlightRef.current;
      return;
    }
    if (sessionReuseOkRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
      if (mountedRef.current) setConnectionState("ready");
      return;
    }

    const run = async () => {
      const prev = wsRef.current;
      if (prev) {
        try {
          prev.close();
        } catch {
          /* ignore */
        }
        wsRef.current = null;
      }
      sessionReuseOkRef.current = false;

      if (mountedRef.current) {
        setConnectionState("connecting");
        setError(null);
      }

      let ws: WebSocket;
      try {
        const session = await createRealtimeSession({
          vad: false,
        });
        const wsUrl = getRealtimeWebSocketUrl(session.ws_url);
        ws = new WebSocket(wsUrl);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;
      } catch (e) {
        if (mountedRef.current) {
          setError(e instanceof Error ? e.message : "Session failed");
          setConnectionState("error");
        }
        return;
      }

      let resolveReady: (() => void) | null = null;
      const readyPromise = new Promise<void>((res) => {
        resolveReady = res;
      });

      ws.onmessage = (ev) => {
        const jsonStr = wsMessageDataToJsonString(ev.data);
        if (!jsonStr) return;

        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(jsonStr) as Record<string, unknown>;
        } catch {
          return;
        }

        if (import.meta.env.DEV && wsDebugLogged < 48) {
          wsDebugLogged += 1;
          const t = normalizeEventType(msg);
          console.debug("[Transcriptor! ws]", t || "(no type)", Object.keys(msg), msg);
        }

        if (msg.type === "session_ready") {
          resolveReady?.();
          resolveReady = null;
          return;
        }
        if (msg.type === "error") {
          const m = msg as { message?: string; code?: string };
          if (mountedRef.current) {
            setError(m.message ?? m.code ?? "Realtime error");
            setConnectionState("error");
          }
          return;
        }

        applyTranscriptMessage(msg);
      };

      ws.onclose = () => {
        if (wsRef.current !== ws) {
          return;
        }
        sessionReuseOkRef.current = false;
        wsRef.current = null;
        if (replaySendActiveRef.current) {
          replaySendActiveRef.current = false;
          replayPostStopUntilRef.current = 0;
        }
        if (recordingActiveRef.current) {
          recordingActiveRef.current = false;
          cleanupAudio();
          if (mountedRef.current) setIsRecording(false);
        }
        if (
          reconnectAfterUserStopRef.current &&
          !recordingActiveRef.current &&
          mountedRef.current
        ) {
          reconnectAfterUserStopRef.current = false;
          if (reconnectAfterStopClearTimerRef.current !== null) {
            clearTimeout(reconnectAfterStopClearTimerRef.current);
            reconnectAfterStopClearTimerRef.current = null;
          }
          setConnectionState("connecting");
          void connectWebSocketRef.current();
          return;
        }
        if (mountedRef.current) setConnectionState("disconnected");
      };

      ws.onerror = () => {
        if (!liveRef.current && mountedRef.current) {
          setError("WebSocket error");
          setConnectionState("error");
        }
      };

      try {
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error("WebSocket open timeout")), 15000);
          ws.onopen = () => {
            window.clearTimeout(timer);
            resolve();
          };
        });

        await Promise.race([
          readyPromise,
          new Promise<void>((_, reject) =>
            window.setTimeout(() => reject(new Error("Timed out waiting for session_ready")), 15000),
          ),
        ]);

        sessionReuseOkRef.current = true;
        if (mountedRef.current) setConnectionState("ready");
      } catch (e) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        if (wsRef.current === ws) wsRef.current = null;
        sessionReuseOkRef.current = false;
        if (mountedRef.current) {
          setError(e instanceof Error ? e.message : "Failed to connect realtime");
          setConnectionState("error");
        }
      }
    };

    const p = run().finally(() => {
      connectInFlightRef.current = null;
    });
    connectInFlightRef.current = p;
    await p;
  }, [applyTranscriptMessage, cleanupAudio]);

  connectWebSocketRef.current = connectWebSocket;

  /** Auto-connect when the page opens (token present). */
  useEffect(() => {
    if (!hasToken) return;
    void connectWebSocket();
  }, [hasToken, connectWebSocket]);

  /** If disconnected, focusing the window or returning to the tab retries the connection. */
  useEffect(() => {
    if (!hasToken) return;

    const tryReconnect = () => {
      if (isRecordingRef.current) return;
      const s = connectionStateRef.current;
      if (s === "ready" || s === "connecting") return;
      void connectWebSocket();
    };

    const onFocus = () => tryReconnect();
    const onVisibility = () => {
      if (document.visibilityState === "visible") tryReconnect();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hasToken, connectWebSocket]);

  useEffect(() => {
    return () => {
      const ws = wsRef.current;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
      wsRef.current = null;
      sessionReuseOkRef.current = false;
      if (replayObjectUrlRef.current) {
        URL.revokeObjectURL(replayObjectUrlRef.current);
        replayObjectUrlRef.current = null;
      }
    };
  }, []);

  const stop = useCallback(() => {
    clearFlushTimer();
    recordingActiveRef.current = false;
    postStopAcceptUntilRef.current = Date.now() + POST_STOP_ACCEPT_MS;

    cleanupAudio();

    const chunks = pcmChunksRef.current;
    pcmChunksRef.current = [];
    revokeReplayUrl();
    const merged = concatInt16Chunks(chunks);
    if (merged.length > 0) {
      const blob = pcm16MonoToWavBlob(merged, SAMPLE_RATE_OUT);
      const url = URL.createObjectURL(blob);
      replayObjectUrlRef.current = url;
      setReplayAudioUrl(url);
      setReplayDurationSec(merged.length / SAMPLE_RATE_OUT);
      setLastTakeWavBlob(blob);
    }

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      reconnectAfterUserStopRef.current = true;
      if (reconnectAfterStopClearTimerRef.current !== null) {
        clearTimeout(reconnectAfterStopClearTimerRef.current);
      }
      reconnectAfterStopClearTimerRef.current = window.setTimeout(() => {
        reconnectAfterStopClearTimerRef.current = null;
        reconnectAfterUserStopRef.current = false;
      }, 8000);
      try {
        ws.send(JSON.stringify({ type: "stop" }));
      } catch {
        reconnectAfterUserStopRef.current = false;
        if (reconnectAfterStopClearTimerRef.current !== null) {
          clearTimeout(reconnectAfterStopClearTimerRef.current);
          reconnectAfterStopClearTimerRef.current = null;
        }
      }
    }

    setIsRecording(false);

    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushPendingToDisplay();
    }, FLUSH_DELAY_MS);

    scheduleIdleDisconnect();
  }, [cleanupAudio, clearFlushTimer, flushPendingToDisplay, revokeReplayUrl, scheduleIdleDisconnect]);

  const sendRecordingViaRealtime = useCallback(async () => {
    if (!lastTakeWavBlob || isRecordingRef.current) return;
    clearReplayFlushTimer();
    setIsReplaySending(true);
    setReplayWsError(null);
    setReplayWsText(null);
    replayPendingLinesRef.current = [];
    replayPendingLiveRef.current = "";
    postStopAcceptUntilRef.current = 0;

    try {
      if (connectionStateRef.current !== "ready") {
        await connectWebSocket();
      }
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error("WebSocket not ready — wait for Live or click the window to reconnect.");
      }

      const pcm = await wavBlobToMonoPcm16(lastTakeWavBlob);
      if (pcm.length === 0) throw new Error("Empty audio");

      replaySendActiveRef.current = true;

      /**
       * Protocol (GET /v1/audio/realtime/protocol):
       * - After a prior `stop`, send `start` before more PCM so the server opens a new utterance.
       * - With `vad: false`, `commit` requests a transcript; mic path often works on first segment via `stop` alone.
       */
      ws.send(JSON.stringify({ type: "start" }));
      await new Promise((r) => window.setTimeout(r, 80));

      const padSamples = Math.ceil((SAMPLE_RATE_OUT * PCM_PAD_MS) / 1000);
      const padPcm = floatTo16BitPCM(new Float32Array(padSamples));
      ws.send(padPcm.buffer);

      const CHUNK = 2400;
      for (let i = 0; i < pcm.length; i += CHUNK) {
        if (ws.readyState !== WebSocket.OPEN) throw new Error("WebSocket closed during replay");
        const slice = pcm.subarray(i, Math.min(i + CHUNK, pcm.length));
        const chunkCopy = new Int16Array(slice.length);
        chunkCopy.set(slice);
        ws.send(chunkCopy.buffer);
        await new Promise((r) => window.setTimeout(r, 100));
      }

      ws.send(JSON.stringify({ type: "commit" }));
      await new Promise((r) => window.setTimeout(r, 60));

      replaySendActiveRef.current = false;
      replayPostStopUntilRef.current = Date.now() + POST_STOP_ACCEPT_MS;

      reconnectAfterUserStopRef.current = true;
      if (reconnectAfterStopClearTimerRef.current !== null) {
        clearTimeout(reconnectAfterStopClearTimerRef.current);
      }
      reconnectAfterStopClearTimerRef.current = window.setTimeout(() => {
        reconnectAfterStopClearTimerRef.current = null;
        reconnectAfterUserStopRef.current = false;
      }, 8000);
      ws.send(JSON.stringify({ type: "stop" }));

      replayFlushTimerRef.current = window.setTimeout(() => {
        replayFlushTimerRef.current = null;
        flushReplayPendingToDisplay();
      }, FLUSH_DELAY_MS);

      scheduleIdleDisconnect();
    } catch (e) {
      replaySendActiveRef.current = false;
      replayPostStopUntilRef.current = 0;
      setReplayWsText(null);
      setReplayWsError(e instanceof Error ? e.message : "Replay send failed");
    } finally {
      setIsReplaySending(false);
    }
  }, [
    lastTakeWavBlob,
    connectWebSocket,
    clearReplayFlushTimer,
    flushReplayPendingToDisplay,
    scheduleIdleDisconnect,
  ]);

  const start = useCallback(async () => {
    setError(null);
    setDisplayText("");
    setReplayWsText(null);
    setReplayWsError(null);
    clearIdleTimer();
    clearFlushTimer();
    pcmChunksRef.current = [];
    revokeReplayUrl();

    pendingLinesRef.current = [];
    pendingLiveRef.current = "";
    recordingActiveRef.current = true;
    postStopAcceptUntilRef.current = 0;
    wsDebugLogged = 0;

    const existing = wsRef.current;
    const reuse =
      sessionReuseOkRef.current &&
      existing &&
      existing.readyState === WebSocket.OPEN;

    if (reuse) {
      try {
        await setupAudioGraph(existing);
        setIsRecording(true);
      } catch (e) {
        recordingActiveRef.current = false;
        cleanupAudio();
        setError(e instanceof Error ? e.message : "Failed to start recording");
        setConnectionState("error");
      }
      return;
    }

    recordingActiveRef.current = false;
    setError("Wait for Live before recording.");
  }, [cleanupAudio, clearFlushTimer, clearIdleTimer, revokeReplayUrl, setupAudioGraph]);

  return {
    connectionState,
    isRecording,
    displayText,
    replayAudioUrl,
    replayDurationSec,
    lastTakeWavBlob,
    replayWsText,
    replayWsError,
    isReplaySending,
    sendRecordingViaRealtime,
    error,
    start,
    stop,
  };
}
