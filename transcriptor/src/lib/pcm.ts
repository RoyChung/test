/** Downsample 48kHz mono float to 24kHz (one sample every two). */
export function downsample48to24(input: Float32Array): Float32Array {
  const n = input.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = input[i * 2];
  }
  return out;
}

export function floatTo16BitPCM(float32: Float32Array): Int16Array {
  const s = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const x = Math.max(-1, Math.min(1, float32[i]));
    s[i] = x < 0 ? (x * 0x8000) | 0 : (x * 0x7fff) | 0;
  }
  return s;
}
