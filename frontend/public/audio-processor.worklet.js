/**
 * audio-processor.worklet.js
 *
 * AudioWorklet processor running in the dedicated audio thread.
 * Converts Float32 PCM frames (from mic) → Int16 PCM (required by Sarvam STT)
 * and posts each frame's buffer to the main thread for WebSocket transmission.
 *
 * Loaded via: audioContext.audioWorklet.addModule('/audio-processor.worklet.js')
 * AudioContext must be created with sampleRate: 16000 to match Sarvam's requirement.
 */

class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel || channel.length === 0) return true;

    // Convert Float32 [-1, 1] → Int16 [-32768, 32767]
    const int16 = new Int16Array(channel.length);
    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    // Transfer ownership of the ArrayBuffer (zero-copy) to main thread
    this.port.postMessage(int16.buffer, [int16.buffer]);
    return true; // keep processor alive
  }
}

registerProcessor('pcm-processor', PCMProcessor);
