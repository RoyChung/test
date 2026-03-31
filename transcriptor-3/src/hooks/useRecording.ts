import { useCallback, useRef, useState } from "react";

export type RecordingState = "idle" | "recording" | "error";

export function useRecording() {
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
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const mr = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.start(250);
      setState("recording");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mic error");
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
