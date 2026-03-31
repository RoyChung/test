import { downsample48to24 } from "./pcm";

function resampleLinear(input: Float32Array, srcRate: number, dstRate: number): Float32Array {
  if (srcRate === dstRate) return input;
  const ratio = srcRate / dstRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const j = i * ratio;
    const j0 = Math.floor(j);
    const j1 = Math.min(j0 + 1, input.length - 1);
    const f = j - j0;
    out[i] = input[j0]! * (1 - f) + input[j1]! * f;
  }
  return out;
}

function resampleTo24k(input: Float32Array, srcRate: number): Float32Array {
  if (srcRate === 48000) return downsample48to24(input);
  return resampleLinear(input, srcRate, 24000);
}

/** Whisper: mono float32 @ 16 kHz. */
export async function blobTo16kMonoFloat32(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext();
  try {
    const ab = await blob.arrayBuffer();
    const buf = await ctx.decodeAudioData(ab.slice(0));
    const rate = buf.sampleRate;
    const len = buf.length;
    const ch0 = buf.getChannelData(0);
    let mono: Float32Array;
    if (buf.numberOfChannels === 1) {
      mono = ch0;
    } else {
      const ch1 = buf.getChannelData(1);
      mono = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        mono[i] = (ch0[i]! + ch1[i]!) * 0.5;
      }
    }
    if (rate === 16000) return mono;
    return resampleLinear(mono, rate, 16000);
  } finally {
    await ctx.close();
  }
}

/** Realtime API: mono float32 @ 24 kHz (same convention as Transcriptor 2 live path). */
export async function blobTo24kMonoFloat32(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext();
  try {
    const ab = await blob.arrayBuffer();
    const buf = await ctx.decodeAudioData(ab.slice(0));
    const rate = buf.sampleRate;
    const len = buf.length;
    const ch0 = buf.getChannelData(0);
    let mono: Float32Array;
    if (buf.numberOfChannels === 1) {
      mono = ch0;
    } else {
      const ch1 = buf.getChannelData(1);
      mono = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        mono[i] = (ch0[i]! + ch1[i]!) * 0.5;
      }
    }
    return resampleTo24k(mono, rate);
  } finally {
    await ctx.close();
  }
}
