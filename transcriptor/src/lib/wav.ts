/** Build a mono PCM16 little-endian WAV Blob (browser can play via `<audio>` or `URL.createObjectURL`). */

function writeString(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) {
    view.setUint8(offset + i, s.charCodeAt(i));
  }
}

export function concatInt16Chunks(chunks: Int16Array[]): Int16Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Int16Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export function pcm16MonoToWavBlob(pcm: Int16Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  new Int16Array(buffer, 44).set(pcm);

  return new Blob([buffer], { type: "audio/wav" });
}

/** Extract mono PCM16 samples from a standard PCM WAV (e.g. from `pcm16MonoToWavBlob`). */
export async function wavBlobToMonoPcm16(blob: Blob): Promise<Int16Array> {
  const buf = await blob.arrayBuffer();
  if (buf.byteLength < 44) throw new Error("Invalid WAV: too small");
  const u8 = new Uint8Array(buf);
  const riff = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  const wave = String.fromCharCode(u8[8], u8[9], u8[10], u8[11]);
  if (riff !== "RIFF" || wave !== "WAVE") throw new Error("Invalid WAV: not RIFF/WAVE");

  let offset = 12;
  let dataOffset = 0;
  let dataSize = 0;
  while (offset + 8 <= buf.byteLength) {
    const id = String.fromCharCode(u8[offset], u8[offset + 1], u8[offset + 2], u8[offset + 3]);
    const size = new DataView(buf).getUint32(offset + 4, true);
    const chunkDataStart = offset + 8;
    if (id === "data") {
      dataOffset = chunkDataStart;
      dataSize = size;
      break;
    }
    offset = chunkDataStart + size + (size % 2);
  }
  if (dataSize <= 0 || dataOffset + dataSize > buf.byteLength) {
    throw new Error("Invalid WAV: no data chunk");
  }
  const sampleCount = Math.floor(dataSize / 2);
  return new Int16Array(buf, dataOffset, sampleCount);
}
