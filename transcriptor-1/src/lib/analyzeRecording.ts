/**
 * Inspect decoded audio before calling STT to reduce silence/noise hallucinations.
 * Uses short-time RMS (frame-based) — global RMS alone is fooled by steady room noise.
 */

const FRAME_SAMPLES = 2048;
/** Frames above this RMS count as "possibly speech" for ratio metrics. */
const SPEECH_FLOOR = 0.011;

export interface RecordingAnalysis {
  durationSec: number;
  maxAbs: number;
  rms: number;
  maxFrameRms: number;
  meanFrameRms: number;
  medianFrameRms: number;
  speechFrameRatio: number;
}

function frameEnergyStats(buffer: AudioBuffer): Omit<RecordingAnalysis, "durationSec" | "maxAbs" | "rms"> {
  const nCh = buffer.numberOfChannels;
  const len = buffer.length;
  const rmsList: number[] = [];

  for (let start = 0; start < len; start += FRAME_SAMPLES) {
    const end = Math.min(start + FRAME_SAMPLES, len);
    const fl = end - start;
    if (fl < 512) break;

    let sumSq = 0;
    for (let i = start; i < end; i++) {
      let s = 0;
      for (let c = 0; c < nCh; c++) {
        s += buffer.getChannelData(c)[i]!;
      }
      const v = s / nCh;
      sumSq += v * v;
    }
    rmsList.push(Math.sqrt(sumSq / fl));
  }

  if (rmsList.length === 0) {
    return {
      maxFrameRms: 0,
      meanFrameRms: 0,
      medianFrameRms: 0,
      speechFrameRatio: 0,
    };
  }

  const sorted = [...rmsList].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const maxFrameRms = Math.max(...rmsList);
  const meanFrameRms = rmsList.reduce((a, b) => a + b, 0) / rmsList.length;
  const speechFrames = rmsList.filter((r) => r > SPEECH_FLOOR).length;

  return {
    maxFrameRms,
    meanFrameRms,
    medianFrameRms: median,
    speechFrameRatio: speechFrames / rmsList.length,
  };
}

export async function analyzeRecording(blob: Blob): Promise<RecordingAnalysis | null> {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;

    const ctx = new AC();
    const ab = await blob.arrayBuffer();
    const buffer = await ctx.decodeAudioData(ab.slice(0));
    await ctx.close();

    const durationSec = buffer.duration;
    let maxAbs = 0;
    let sumSq = 0;
    let n = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const ch = buffer.getChannelData(c);
      for (let i = 0; i < ch.length; i++) {
        const v = ch[i]!;
        const a = Math.abs(v);
        if (a > maxAbs) maxAbs = a;
        sumSq += v * v;
        n++;
      }
    }
    const rms = n > 0 ? Math.sqrt(sumSq / n) : 0;

    const frame = frameEnergyStats(buffer);
    return { durationSec, maxAbs, rms, ...frame };
  } catch {
    return null;
  }
}

/**
 * Skip STT when clip looks like silence, accidental tap, or flat steady noise with no speech-like bursts.
 */
export function shouldSkipTranscription(analysis: RecordingAnalysis | null): boolean {
  if (!analysis) return false;

  const { durationSec, maxAbs, rms, maxFrameRms, meanFrameRms, medianFrameRms, speechFrameRatio } =
    analysis;

  if (durationSec < 0.28) return true;
  if (maxAbs < 0.003 && rms < 0.001) return true;

  const peakToMean = maxFrameRms / (meanFrameRms + 1e-12);
  const peakToMedian = maxFrameRms / (medianFrameRms + 1e-12);

  if (maxFrameRms < 0.012) return true;

  if (durationSec >= 0.32 && maxFrameRms < 0.045 && peakToMean < 3.2) return true;

  if (durationSec >= 0.32 && maxFrameRms < 0.05 && peakToMedian < 4.2) return true;

  if (speechFrameRatio < 0.035 && maxFrameRms < 0.03) return true;

  return false;
}
