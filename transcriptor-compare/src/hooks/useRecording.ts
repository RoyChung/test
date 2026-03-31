import { useCallback, useRef, useState } from "react";

export type RecordingState = "idle" | "recording" | "error";

export interface UseRecordingResult {
  state: RecordingState;
  error: string | null;
  isRecording: boolean;
  start: () => Promise<void>;
  stop: () => Promise<Blob>;
  resetError: () => void;
}

function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return "";
}

export function useRecording(): UseRecordingResult {
  const [state, setState] = useState<RecordingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const resetError = useCallback(() => setError(null), []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const mimeType = pickMimeType();
      const mr = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };
      mr.start(250);
      setState("recording");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not access microphone";
      setError(msg);
      setState("error");
      throw e;
    }
  }, []);

  const stop = useCallback((): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const mr = mediaRecorderRef.current;
      if (!mr || mr.state === "inactive") {
        reject(new Error("Not recording"));
        return;
      }

      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        mr.stream.getTracks().forEach((t) => t.stop());
        mediaRecorderRef.current = null;
        chunksRef.current = [];
        setState("idle");
        resolve(blob);
      };

      mr.onerror = () => {
        reject(new Error("Recording failed"));
      };

      try {
        mr.stop();
      } catch (e) {
        reject(e instanceof Error ? e : new Error("Stop failed"));
      }
    });
  }, []);

  return {
    state,
    error,
    isRecording: state === "recording",
    start,
    stop,
    resetError,
  };
}
