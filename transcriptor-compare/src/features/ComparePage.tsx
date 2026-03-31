import { useCallback, useMemo, useRef, useState } from "react";
import { getApiConfig } from "@/api/client";
import { transcribeBatch } from "@/api/transcribe";
import { useRecording } from "@/hooks/useRecording";
import { transcribeRealtimeFromBlob } from "@/lib/realtimeFromBlob";
import { transcribeLocalWhisper } from "@/lib/localWhisperTranscribe";
import { toTraditionalChinese } from "@/lib/toTraditionalChinese";
import { RecordButton } from "./RecordButton";

export type MethodId = "batch" | "realtime" | "local";

const METHOD_LABELS: Record<MethodId, string> = {
  batch: "雲端批次 STT",
  realtime: "雲端即時 STT",
  local: "本機 Whisper（Xenova/whisper-tiny）",
};

interface ColResult {
  text: string;
  durationMs: number | null;
  error: string | null;
  status: "idle" | "loading" | "done";
}

const emptyCol: ColResult = { text: "", durationMs: null, error: null, status: "idle" };

async function runTimed<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T; ms: number } | { ok: false; err: string; ms: number }> {
  const t0 = performance.now();
  try {
    const value = await fn();
    return { ok: true, value, ms: performance.now() - t0 };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : "Failed", ms: performance.now() - t0 };
  }
}

function formatRank(n: number): string {
  const medals = ["🥇", "🥈", "🥉"];
  return medals[n - 1] ?? `#${n}`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  return `${(ms / 1000).toFixed(2)} 秒`;
}

export function ComparePage() {
  const { hasToken } = getApiConfig();
  const { isRecording, start, stop, error: recordError, resetError } = useRecording();
  const [busy, setBusy] = useState(false);
  const compareRunIdRef = useRef(0);
  const [cols, setCols] = useState<Record<MethodId, ColResult>>({
    batch: { ...emptyCol },
    realtime: { ...emptyCol },
    local: { ...emptyCol },
  });

  const leaderboard = useMemo(() => {
    const rows: Array<{ id: MethodId; ms: number }> = (["batch", "realtime", "local"] as MethodId[])
      .map((id) => {
        const c = cols[id];
        if (c.status !== "done" || c.error || c.durationMs === null) return null;
        return { id, ms: c.durationMs };
      })
      .filter((x): x is { id: MethodId; ms: number } => x !== null)
      .sort((a, b) => a.ms - b.ms);

    return rows.map((r, i) => ({ ...r, rank: i + 1 }));
  }, [cols]);

  const rankByMethod = useMemo(() => {
    const m = new Map<MethodId, number>();
    for (const row of leaderboard) {
      m.set(row.id, row.rank);
    }
    return m;
  }, [leaderboard]);

  const onPrimary = useCallback(async () => {
    resetError();
    if (!isRecording) {
      try {
        await start();
        setCols({
          batch: { ...emptyCol },
          realtime: { ...emptyCol },
          local: { ...emptyCol },
        });
      } catch {
        return;
      }
      return;
    }

    let blob: Blob;
    try {
      blob = await stop();
    } catch (e) {
      console.error(e);
      return;
    }

    setBusy(true);
    const runId = ++compareRunIdRef.current;
    setCols({
      batch: { text: "", durationMs: null, error: null, status: "loading" },
      realtime: { text: "", durationMs: null, error: null, status: "loading" },
      local: { text: "", durationMs: null, error: null, status: "loading" },
    });

    const tokenMsg = "需要 AI_BUILDER_TOKEN（專案根目錄 .env）";

    const pBatch = hasToken
      ? runTimed(() => transcribeBatch(blob).then((t) => toTraditionalChinese(t)))
      : Promise.resolve({ ok: false as const, err: tokenMsg, ms: 0 });

    const pRealtime = hasToken
      ? runTimed(() => transcribeRealtimeFromBlob(blob))
      : Promise.resolve({ ok: false as const, err: tokenMsg, ms: 0 });

    const pLocal = runTimed(() => transcribeLocalWhisper(blob));

    const applyIfCurrent = (fn: () => void) => {
      if (compareRunIdRef.current !== runId) return;
      fn();
    };

    void pBatch.then((rb) => {
      applyIfCurrent(() =>
        setCols((prev) => ({
          ...prev,
          batch: {
            text: rb.ok ? rb.value : "",
            durationMs: hasToken ? rb.ms : null,
            error: hasToken ? (rb.ok ? null : rb.err) : tokenMsg,
            status: "done",
          },
        })),
      );
    });

    void pRealtime.then((rr) => {
      applyIfCurrent(() =>
        setCols((prev) => ({
          ...prev,
          realtime: {
            text: rr.ok ? rr.value : "",
            durationMs: hasToken ? rr.ms : null,
            error: hasToken ? (rr.ok ? null : rr.err) : tokenMsg,
            status: "done",
          },
        })),
      );
    });

    void pLocal.then((rl) => {
      applyIfCurrent(() =>
        setCols((prev) => ({
          ...prev,
          local: {
            text: rl.ok ? rl.value : "",
            durationMs: rl.ok ? rl.ms : rl.ms,
            error: rl.ok ? null : rl.err,
            status: "done",
          },
        })),
      );
    });

    void Promise.allSettled([pBatch, pRealtime, pLocal]).then(() => {
      applyIfCurrent(() => setBusy(false));
    });
  }, [isRecording, start, stop, resetError, hasToken]);

  const combinedError = recordError;

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-16 pt-12 sm:px-6">
      <header className="mb-10 text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Transcriptor 三合一比較
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          一次錄音，同時跑三種轉寫；邊有結果邊顯示，唔使等齊三個。完成後顯示耗時與速度排名。{" "}
          <span className="font-mono text-2xs text-slate-500">http://localhost:5184</span>
        </p>
      </header>

      {!hasToken && (
        <div
          role="status"
          className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
        >
          未設定 <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-2xs">AI_BUILDER_TOKEN</code>{" "}
          時，雲端兩欄會顯示提示；本機 Whisper 仍可運作（首次需下載模型）。
        </div>
      )}

      <div className="flex flex-col items-center gap-8">
        <RecordButton isRecording={isRecording} isBusy={busy} onPress={onPrimary} />

        {leaderboard.length > 0 && (
          <div className="w-full rounded-xl border border-surface-border bg-surface-raised/60 px-4 py-3 text-center text-sm text-slate-300">
            <span className="text-slate-500">速度排名（由快到慢）：</span>{" "}
            {leaderboard.map((row, i) => (
              <span key={row.id}>
                {i > 0 ? " · " : ""}
                {formatRank(row.rank)} {METHOD_LABELS[row.id]}（{formatDuration(row.ms)}）
              </span>
            ))}
          </div>
        )}

        <div className="grid w-full gap-6 md:grid-cols-3">
          {(["batch", "realtime", "local"] as MethodId[]).map((id) => {
            const c = cols[id];
            const rank = rankByMethod.get(id);
            return (
              <section
                key={id}
                className="flex flex-col rounded-xl border border-surface-border bg-surface-raised/40 p-4 shadow-inner"
              >
                <h2 className="text-sm font-semibold text-accent">{METHOD_LABELS[id]}</h2>
                <div className="mt-3 min-h-[140px] flex-1 rounded-lg border border-surface-border bg-surface/80 p-3 text-sm leading-relaxed text-slate-200">
                  {c.status === "loading" && <p className="text-slate-500">處理中…</p>}
                  {c.status === "done" && c.error && (
                    <p className="text-danger-foreground/90">{c.error}</p>
                  )}
                  {c.status === "done" && !c.error && c.text && (
                    <p className="whitespace-pre-wrap">{c.text}</p>
                  )}
                  {c.status === "done" && !c.error && !c.text && (
                    <p className="text-slate-500">（無文字）</p>
                  )}
                  {c.status === "idle" && <p className="text-slate-600">—</p>}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-surface-border/80 pt-3 text-2xs text-slate-400">
                  <span>
                    回應時間：<span className="font-mono text-slate-300">{formatDuration(c.durationMs)}</span>
                  </span>
                  <span>
                    排名：{" "}
                    {c.status === "done" && !c.error && rank !== undefined ? (
                      <span className="text-amber-200/90">
                        {formatRank(rank)} 第 {rank} 名
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </span>
                </div>
              </section>
            );
          })}
        </div>

        {combinedError && (
          <p className="text-center text-sm text-danger-foreground" role="alert">
            {combinedError}
          </p>
        )}
      </div>
    </div>
  );
}
