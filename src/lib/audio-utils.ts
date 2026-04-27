// Browser-only utilities — call only from client-side event handlers, never at module init.

export const MAX_STT_AUDIO_BYTES = 100 * 1024 * 1024;

export async function convertToWav(blob: Blob): Promise<Blob> {
  const audioCtx = new AudioContext({ sampleRate: 16000 });
  try {
    const arrayBuf = await blob.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(arrayBuf);
    const mono =
      decoded.numberOfChannels === 1
        ? decoded.getChannelData(0)
        : (() => {
            const ch0 = decoded.getChannelData(0);
            const ch1 = decoded.getChannelData(1);
            const mixed = new Float32Array(ch0.length);
            for (let i = 0; i < ch0.length; i += 1) mixed[i] = (ch0[i] + ch1[i]) / 2;
            return mixed;
          })();
    let samples = mono;
    if (decoded.sampleRate !== 16000) {
      const ratio = 16000 / decoded.sampleRate;
      const newLen = Math.round(mono.length * ratio);
      const resampled = new Float32Array(newLen);
      for (let i = 0; i < newLen; i += 1) resampled[i] = mono[Math.round(i / ratio)] ?? 0;
      samples = resampled;
    }
    const numSamples = samples.length;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);
    const writeStr = (off: number, s: string) => {
      for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 16000 * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, numSamples * 2, true);
    for (let i = 0; i < numSamples; i += 1) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buffer], { type: "audio/wav" });
  } finally {
    await audioCtx.close();
  }
}

export function getMicrophoneErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case "NotFoundError":
        return "No microphone found. Please connect a microphone and try again.";
      case "NotAllowedError":
        return "Microphone access was denied. Please allow microphone access in your browser settings and try again.";
      case "NotReadableError":
        return "Your microphone is in use by another application. Please close other apps using the microphone and try again.";
      case "OverconstrainedError":
        return "Your microphone does not meet the required audio constraints. Please try a different microphone.";
      case "SecurityError":
        return "Microphone access is blocked. Please ensure the page is loaded over HTTPS.";
      default:
        return `Microphone error: ${err.message}`;
    }
  }
  return err instanceof Error ? err.message : "Unable to start recording.";
}
