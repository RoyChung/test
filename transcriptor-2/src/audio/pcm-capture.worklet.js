/**
 * Captures mono input and posts Float32 copies to the main thread (no ScriptProcessorNode).
 * Render quantum is typically 128 frames; main thread resamples to 24 kHz and sends PCM16.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) {
      return true;
    }
    const ch0 = input[0];
    const copy = new Float32Array(ch0.length);
    copy.set(ch0);
    this.port.postMessage(copy);
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
