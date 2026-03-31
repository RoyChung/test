import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRealtimeSession } from "@/api/realtimeSession";
import { fetchRealtimeProtocol } from "@/api/realtimeProtocol";
import { getApiConfig, getRealtimeWebSocketUrl } from "@/api/client";
import { downsample48to24, floatTo16BitPCM } from "@/lib/pcm";
import {
  classifyTranscriptKind,
  extractTranscriptParts,
  normalizeEventType,
  wsMessageDataToJsonString,
} from "@/lib/realtimeWsMessages";

import workletUrl from "@/audio/pcm-capture.worklet.js?url";

/** WebSocket + session_ready; mic may be off until Start. */
export type ConnectionState = "disconnected" | "connecting" | "ready" | "error";
export type FinalizeState = "idle" | "waiting_first" | "refining";

const IDLE_DISCONNECT_MS = 5 * 60 * 1000;
/** Server may emit final text after `stop` or after reconnect; allow late events. */
export const REALTIME_POST_STOP_ACCEPT_MS = 8000;
const POST_STOP_ACCEPT_MS = REALTIME_POST_STOP_ACCEPT_MS;
/** Server requires ≥100ms of PCM before commit; pad so buffer is never empty. */
const PCM_PAD_MS = 120;
/** After Stop, indicator shows Ready while WS may reconnect (avoids connecting flicker). */
const POST_STOP_UI_GRACE_MS = 3000;
/** If Stop has no text yet, wait this long for the first post-commit transcript. */
const FIRST_TRANSCRIPT_TIMEOUT_MS = 4500;
/** After first post-Stop transcript arrives, wait for quiet before sending `stop`. */
const POST_FIRST_QUIET_MS = 1000;
/** After a completed/final transcript event, allow a shorter quiet period. */
const COMPLETED_QUIET_MS = 400;
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
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  return [...lines, live]
    .filter(Boolean)
    .map((s) => normalize(s))
    .filter(Boolean)
    .join(" ")
    .trim();
}

/** Server may emit `type: "error"` for non-fatal cases (e.g. empty commit); socket stays open. */
function isRecoverableRealtimeWsError(message: string | undefined, code: string | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  const c = (code ?? "").toLowerCase();
  const combined = `${m} ${c}`;
  if (combined.includes("buffer too small")) return true;
  if (combined.includes("committing input audio")) return true;
  if (combined.includes("input audio buffer") && combined.includes("too small")) return true;
  return false;
}

export interface UseRealtimeTranscriptionResult {
  connectionState: ConnectionState;
  /** For status UI: after Stop, shows `ready` as Ready label for POST_STOP_UI_GRACE_MS while reconnecting. Logic still uses connectionState. */
  connectionUiState: ConnectionState;
  /** `waiting_first`: Stop pressed, waiting for first text. `refining`: text is visible and may still update. */
  finalizeState: FinalizeState;
  /** True while mic is capturing and sending PCM (between Start and Stop). */
  isRecording: boolean;
  /** Shown after Stop: text accumulated for the last utterance (not while recording). */
  displayText: string;
  /** Live panel: updates while recording; after Stop keeps the stop snapshot until new Start or Clear (after-stop). */
  liveDisplayText: string;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  clearTranscript: () => void;
  /** Local time (ms) when user pressed Stop; null after Clear or new Start. */
  lastStopAtMs: number | null;
  /** Local time (ms) when `displayText` last changed for the after-stop panel; null when empty. */
  afterStopTranscriptUpdatedAtMs: number | null;
}

export function useRealtimeTranscription(): UseRealtimeTranscriptionResult {
  const hasToken = getApiConfig().hasToken;
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [isRecording, setIsRecording] = useState(false);
  const [displayText, setDisplayText] = useState("");
  const [liveDisplayText, setLiveDisplayText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [finalizeState, setFinalizeState] = useState<FinalizeState>("idle");
  /** Unix ms when post-Stop UI grace ends; 0 = inactive. */
  const [stopUiGraceUntil, setStopUiGraceUntil] = useState(0);
  const [lastStopAtMs, setLastStopAtMs] = useState<number | null>(null);
  const [afterStopTranscriptUpdatedAtMs, setAfterStopTranscriptUpdatedAtMs] = useState<number | null>(null);

  const connectionStateRef = useRef(connectionState);
  const isRecordingRef = useRef(false);
  const finalizeStateRef = useRef(finalizeState);
  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);
  useEffect(() => {
    finalizeStateRef.current = finalizeState;
  }, [finalizeState]);

  useEffect(() => {
    if (stopUiGraceUntil <= 0) return;
    const ms = stopUiGraceUntil - Date.now();
    if (ms <= 0) {
      setStopUiGraceUntil(0);
      return;
    }
    const id = window.setTimeout(() => setStopUiGraceUntil(0), ms);
    return () => clearTimeout(id);
  }, [stopUiGraceUntil]);

  const connectionUiState = useMemo((): ConnectionState => {
    const now = Date.now();
    if (stopUiGraceUntil > now && connectionState !== "error") {
      if (connectionState === "connecting" || connectionState === "disconnected") {
        return "ready";
      }
    }
    return connectionState;
  }, [connectionState, stopUiGraceUntil]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (isRecording) {
      setAfterStopTranscriptUpdatedAtMs(null);
      return;
    }
    if (displayText) {
      setAfterStopTranscriptUpdatedAtMs(Date.now());
    } else {
      setAfterStopTranscriptUpdatedAtMs(null);
    }
  }, [displayText, isRecording]);

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
  const connectInFlightRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);
  /** After user sends `{ type: "stop" }`, backend may close the socket — reconnect without showing Offline. */
  const reconnectAfterUserStopRef = useRef(false);
  const reconnectAfterStopClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectWebSocketRef = useRef<() => Promise<void>>(async () => {});
  /** True after user Stop + `commit` until `{ type: "stop" }` is sent. */
  const pendingStopSendRef = useRef(false);
  const firstTranscriptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalizeQuietTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const absoluteFinalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendStopMessageIfPendingRef = useRef<() => void>(() => {});

  const clearIdleTimer = useCallback(() => {
    if (idleDisconnectTimerRef.current !== null) {
      clearTimeout(idleDisconnectTimerRef.current);
      idleDisconnectTimerRef.current = null;
    }
  }, []);

  const clearFinalizeTimers = useCallback(() => {
    if (firstTranscriptTimerRef.current !== null) {
      clearTimeout(firstTranscriptTimerRef.current);
      firstTranscriptTimerRef.current = null;
    }
    if (finalizeQuietTimerRef.current !== null) {
      clearTimeout(finalizeQuietTimerRef.current);
      finalizeQuietTimerRef.current = null;
    }
    if (absoluteFinalizeTimerRef.current !== null) {
      clearTimeout(absoluteFinalizeTimerRef.current);
      absoluteFinalizeTimerRef.current = null;
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

  const scheduleFinalizeStop = useCallback(
    (delayMs: number) => {
      if (!pendingStopSendRef.current) return;
      if (finalizeQuietTimerRef.current !== null) {
        clearTimeout(finalizeQuietTimerRef.current);
      }
      finalizeQuietTimerRef.current = window.setTimeout(() => {
        finalizeQuietTimerRef.current = null;
        sendStopMessageIfPendingRef.current();
      }, delayMs);
    },
    [],
  );

  function sendStopMessageIfPending() {
    clearFinalizeTimers();
    postStopAcceptUntilRef.current = 0;
    if (mountedRef.current) setFinalizeState("idle");
    if (!pendingStopSendRef.current) return;
    pendingStopSendRef.current = false;
    const w = wsRef.current;
    if (!w || w.readyState !== WebSocket.OPEN) return;
    try {
      w.send(JSON.stringify({ type: "stop" }));
    } catch {
      reconnectAfterUserStopRef.current = false;
      if (reconnectAfterStopClearTimerRef.current !== null) {
        clearTimeout(reconnectAfterStopClearTimerRef.current);
        reconnectAfterStopClearTimerRef.current = null;
      }
    }
  }
  sendStopMessageIfPendingRef.current = sendStopMessageIfPending;

  const applyTranscriptMessage = useCallback((msg: Record<string, unknown>) => {
    const now = Date.now();
    const isRecording = recordingActiveRef.current;
    const isPostStop = !isRecording && pendingStopSendRef.current && now < postStopAcceptUntilRef.current;
    const accept = isRecording || isPostStop;
    if (!accept) return;

    const t = normalizeEventType(msg);
    const kind = classifyTranscriptKind(t);
    const isCompletedLike = kind === "completed" || t === "session_stopped" || t.includes("session_stopped");
    const { fullText, deltaOnly } = extractTranscriptParts(msg, {
      transcriptOnly: isPostStop,
      allowText: isPostStop && isCompletedLike,
    });

    if (kind === "delta") {
      if (isRecording && fullText !== null) {
        pendingLiveRef.current = fullText;
      } else if (isRecording && deltaOnly !== null) {
        pendingLiveRef.current += deltaOnly;
      } else if (isPostStop && fullText !== null) {
        pendingLiveRef.current = fullText;
      } else if (isPostStop && deltaOnly !== null) {
        pendingLiveRef.current += deltaOnly;
      }
    } else if (kind === "completed") {
      const segment = fullText ?? deltaOnly ?? "";
      if (segment) {
        pendingLinesRef.current = isPostStop ? [segment] : [...pendingLinesRef.current, segment];
        pendingLiveRef.current = "";
      } else if (pendingLiveRef.current) {
        pendingLinesRef.current = isPostStop
          ? [pendingLiveRef.current]
          : [...pendingLinesRef.current, pendingLiveRef.current];
        pendingLiveRef.current = "";
      }
    } else if (t === "session_stopped" || t.includes("session_stopped")) {
      const segment = fullText ?? deltaOnly ?? "";
      if (segment) {
        pendingLinesRef.current = [segment];
        pendingLiveRef.current = "";
      } else if (pendingLiveRef.current) {
        pendingLinesRef.current = [pendingLiveRef.current];
        pendingLiveRef.current = "";
      }
    } else if (isRecording && fullText !== null && (t.includes("transcript") || t.includes("Transcription"))) {
      pendingLiveRef.current = fullText;
    } else if (isRecording && kind === "neutral" && (fullText !== null || deltaOnly !== null)) {
      if (fullText !== null) {
        pendingLinesRef.current = [...pendingLinesRef.current, fullText];
        pendingLiveRef.current = "";
      } else if (deltaOnly !== null) {
        pendingLiveRef.current += deltaOnly;
      }
    }

    // Show transcript in UI only after Stop (not while recording); still accept WS until post-stop window ends.
    if (isPostStop) {
      const merged = mergePendingToText(pendingLinesRef.current, pendingLiveRef.current);
      setDisplayText(merged);
      if (merged) {
        if (firstTranscriptTimerRef.current !== null) {
          clearTimeout(firstTranscriptTimerRef.current);
          firstTranscriptTimerRef.current = null;
        }
        if (finalizeStateRef.current === "waiting_first" && mountedRef.current) {
          setFinalizeState("refining");
        }
        scheduleFinalizeStop(
          kind === "completed" || t === "session_stopped" || t.includes("session_stopped")
            ? COMPLETED_QUIET_MS
            : POST_FIRST_QUIET_MS,
        );
      }
    }

    if (isRecording) {
      setLiveDisplayText(mergePendingToText(pendingLinesRef.current, pendingLiveRef.current));
    }

    if (isPostStop && (t === "session_stopped" || t.includes("session_stopped"))) {
      sendStopMessageIfPendingRef.current();
    }
  }, [clearFinalizeTimers, scheduleFinalizeStop]);

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

      // Protocol (see GET /v1/audio/realtime/protocol): open a new utterance before streaming PCM.
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "start" }));
        } catch {
          /* ignore */
        }
      }
      await new Promise((r) => window.setTimeout(r, 80));

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
        const protocolPromise = fetchRealtimeProtocol().catch(() => null);
        const session = await createRealtimeSession();
        const protocolDoc = await protocolPromise;
        if (import.meta.env.DEV && protocolDoc) {
          console.debug(
            "[transcriptor-2 protocol]",
            protocolDoc.session_endpoint,
            "messages:",
            protocolDoc.websocket_messages?.length ?? 0,
            protocolDoc.notes,
          );
        }
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

      ws.onmessage = async (ev) => {
        let jsonStr: string | null = null;
        if (typeof ev.data === "string") {
          jsonStr = ev.data;
        } else if (ev.data instanceof Blob) {
          try {
            jsonStr = await ev.data.text();
          } catch {
            return;
          }
        } else {
          jsonStr = wsMessageDataToJsonString(ev.data);
        }
        if (!jsonStr?.trim()) return;

        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(jsonStr) as Record<string, unknown>;
        } catch {
          if (import.meta.env.DEV) {
            console.warn("[transcriptor-2 ws] non-JSON frame", jsonStr.slice(0, 200));
          }
          return;
        }

        if (import.meta.env.DEV) {
          wsDebugLogged += 1;
          const t = normalizeEventType(msg);
          console.debug("[transcriptor-2 ws]", t || "(no type)", Object.keys(msg), msg);
        }

        if (msg.type === "session_ready") {
          resolveReady?.();
          resolveReady = null;
          return;
        }
        if (msg.type === "error") {
          const m = msg as { message?: string; code?: string };
          const text = m.message ?? m.code ?? "Realtime error";
          if (isRecoverableRealtimeWsError(m.message, m.code)) {
            if (import.meta.env.DEV) {
              console.warn("[transcriptor-2 ws] recoverable error (ignored for UI):", text);
            }
            return;
          }
          if (mountedRef.current) {
            setError(text);
            setConnectionState("error");
          }
          return;
        }

        applyTranscriptMessage(msg);
      };

      ws.onclose = () => {
        // Ignore close of a socket we already replaced (reconnect / new session).
        if (wsRef.current !== ws) {
          return;
        }
        if (pendingStopSendRef.current) {
          pendingStopSendRef.current = false;
          clearFinalizeTimers();
        }
        postStopAcceptUntilRef.current = 0;
        if (mountedRef.current && finalizeStateRef.current !== "idle") setFinalizeState("idle");
        sessionReuseOkRef.current = false;
        wsRef.current = null;
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
  }, [applyTranscriptMessage, cleanupAudio, clearFinalizeTimers]);

  connectWebSocketRef.current = connectWebSocket;

  /** Connect only when the page is visible and the window has focus — not from Record/Stop. */
  useEffect(() => {
    if (!hasToken) return;

    const tryConnect = () => {
      if (isRecordingRef.current) return;
      const s = connectionStateRef.current;
      if (s === "ready" || s === "connecting") return;
      void connectWebSocket();
    };

    const tryConnectIfFocusedVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (typeof document.hasFocus === "function" && !document.hasFocus()) return;
      tryConnect();
    };

    const onWindowFocus = () => tryConnectIfFocusedVisible();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        tryConnectIfFocusedVisible();
      }
    };

    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    requestAnimationFrame(() => {
      tryConnectIfFocusedVisible();
    });

    return () => {
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
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
    };
  }, []);

  const stop = useCallback(() => {
    const stopAt = Date.now();
    setLastStopAtMs(stopAt);
    clearFinalizeTimers();
    recordingActiveRef.current = false;
    postStopAcceptUntilRef.current = stopAt + POST_STOP_ACCEPT_MS;

    cleanupAudio();

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      pendingStopSendRef.current = true;
      setStopUiGraceUntil(Date.now() + POST_STOP_UI_GRACE_MS);
      reconnectAfterUserStopRef.current = true;
      if (reconnectAfterStopClearTimerRef.current !== null) {
        clearTimeout(reconnectAfterStopClearTimerRef.current);
      }
      reconnectAfterStopClearTimerRef.current = window.setTimeout(() => {
        reconnectAfterStopClearTimerRef.current = null;
        reconnectAfterUserStopRef.current = false;
      }, 8000);
      try {
        ws.send(JSON.stringify({ type: "commit" }));
      } catch {
        pendingStopSendRef.current = false;
        clearFinalizeTimers();
      }
    }

    setIsRecording(false);
    const stoppedSnapshot = mergePendingToText(pendingLinesRef.current, pendingLiveRef.current);
    setDisplayText(stoppedSnapshot);
    setLiveDisplayText(stoppedSnapshot);
    if (pendingStopSendRef.current) {
      absoluteFinalizeTimerRef.current = window.setTimeout(() => {
        absoluteFinalizeTimerRef.current = null;
        sendStopMessageIfPendingRef.current();
      }, POST_STOP_ACCEPT_MS);
      if (stoppedSnapshot) {
        setFinalizeState("refining");
        scheduleFinalizeStop(POST_FIRST_QUIET_MS);
      } else {
        setFinalizeState("waiting_first");
        firstTranscriptTimerRef.current = window.setTimeout(() => {
          firstTranscriptTimerRef.current = null;
          sendStopMessageIfPendingRef.current();
        }, FIRST_TRANSCRIPT_TIMEOUT_MS);
      }
    } else {
      setFinalizeState("idle");
    }

    scheduleIdleDisconnect();
  }, [cleanupAudio, clearFinalizeTimers, scheduleFinalizeStop, scheduleIdleDisconnect]);

  const clearTranscript = useCallback(() => {
    if (recordingActiveRef.current || finalizeStateRef.current !== "idle") return;
    clearFinalizeTimers();
    pendingLinesRef.current = [];
    pendingLiveRef.current = "";
    setDisplayText("");
    setLiveDisplayText("");
    setLastStopAtMs(null);
  }, [clearFinalizeTimers]);

  const start = useCallback(async () => {
    if (pendingStopSendRef.current) {
      sendStopMessageIfPendingRef.current();
    }
    setError(null);
    setDisplayText("");
    setLiveDisplayText("");
    setLastStopAtMs(null);
    clearIdleTimer();
    clearFinalizeTimers();

    pendingLinesRef.current = [];
    pendingLiveRef.current = "";
    recordingActiveRef.current = true;
    postStopAcceptUntilRef.current = 0;
    setFinalizeState("idle");
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
    setError("Focus this window to connect, then press Record when you see Ready.");
  }, [cleanupAudio, clearFinalizeTimers, clearIdleTimer, setupAudioGraph]);

  return {
    connectionState,
    connectionUiState,
    finalizeState,
    isRecording,
    displayText,
    liveDisplayText,
    error,
    start,
    stop,
    clearTranscript,
    lastStopAtMs,
    afterStopTranscriptUpdatedAtMs,
  };
}
