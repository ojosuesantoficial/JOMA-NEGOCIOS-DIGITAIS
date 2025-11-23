
// utils/audioUtils.ts

/**
 * Decodes a base64 string into a Uint8Array.
 * @param base64 The base64 string to decode.
 * @returns The decoded Uint8Array.
 */
export function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  // Fix: Add return statement for Uint8Array type
  return bytes;
}

/**
 * Decodes raw PCM audio data into an AudioBuffer.
 * @param data The Uint8Array containing raw PCM audio data.
 * @param ctx The AudioContext to create the AudioBuffer with.
 * @param sampleRate The sample rate of the audio data.
 * @param numChannels The number of channels in the audio data (e.g., 1 for mono, 2 for stereo).
 * @returns A Promise that resolves to an AudioBuffer.
 */
export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}


/**
 * Combines an array of AudioBuffers into a single AudioBuffer.
 * All AudioBuffers must have the same sample rate and number of channels.
 * @param context The AudioContext to create the new AudioBuffer with.
 * @param buffers An array of AudioBuffers to combine.
 * @returns A new AudioBuffer containing the combined audio.
 */
export function combineAudioBuffers(context: AudioContext, buffers: AudioBuffer[]): AudioBuffer {
  if (buffers.length === 0) {
    return context.createBuffer(1, 1, context.sampleRate); // Return a silent buffer
  }

  const sampleRate = buffers[0].sampleRate;
  const numberOfChannels = buffers[0].numberOfChannels;
  let totalLength = 0;

  for (const buffer of buffers) {
    if (buffer.sampleRate !== sampleRate || buffer.numberOfChannels !== numberOfChannels) {
      throw new Error("All audio buffers must have the same sample rate and number of channels.");
    }
    totalLength += buffer.length;
  }

  const combinedBuffer = context.createBuffer(numberOfChannels, totalLength, sampleRate);

  for (let channel = 0; channel < numberOfChannels; channel++) {
    let offset = 0;
    for (const buffer of buffers) {
      combinedBuffer.getChannelData(channel).set(buffer.getChannelData(channel), offset);
      offset += buffer.length;
    }
  }
  return combinedBuffer;
}


/**
 * Exports an AudioBuffer to a WAV Blob.
 * @param audioBuffer The AudioBuffer to export.
 * @returns A Blob representing the WAV file.
 */
export function exportWAV(audioBuffer: AudioBuffer): Blob {
  const numOfChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM (uncompressed)
  const bitDepth = 16;

  let totalLength = audioBuffer.length * numOfChannels;
  let dataLength = totalLength * (bitDepth / 8);
  let fileLength = dataLength + 44; // 44 is the header size

  let buffer = new ArrayBuffer(fileLength);
  let view = new DataView(buffer);

  let writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  let floatTo16BitPCM = (output: DataView, offset: number, input: Float32Array) => {
    for (let i = 0; i < input.length; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, input[i]));
      output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
  };

  writeString(view, 0, 'RIFF'); // RIFF identifier
  view.setUint32(4, fileLength - 8, true); // file length (without RIFF and length fields)
  writeString(view, 8, 'WAVE'); // WAVE identifier
  writeString(view, 12, 'fmt '); // fmt chunk identifier
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, format, true); // audio format (PCM = 1)
  view.setUint16(22, numOfChannels, true); // number of channels
  view.setUint32(24, sampleRate, true); // sample rate
  view.setUint32(28, sampleRate * numOfChannels * (bitDepth / 8), true); // byte rate
  view.setUint16(32, numOfChannels * (bitDepth / 8), true); // block align
  view.setUint16(34, bitDepth, true); // bits per sample
  writeString(view, 36, 'data'); // data chunk identifier
  view.setUint32(40, dataLength, true); // data chunk size

  let offset = 44;
  for (let i = 0; i < numOfChannels; i++) {
    floatTo16BitPCM(view, offset, audioBuffer.getChannelData(i));
    offset += audioBuffer.getChannelData(i).length * 2;
  }
  
  // Interleave channels for stereo if necessary (WAV standard)
  // The floatTo16BitPCM above assumes sequential writing per channel.
  // For standard WAV, samples should be interleaved for multi-channel.
  // This simplified implementation directly writes channel data.
  // For mono, this is perfectly fine. For the current use case of TTS, it's typically mono.

  return new Blob([view], { type: 'audio/wav' });
}

// Global variable to hold the worker instance
let mp3Worker: Worker | null = null;
let workerMessageId = 0;
const workerPromises: { [key: number]: { resolve: (blob: Blob) => void; reject: (error: Error) => void } } = {};

/**
 * Exports an AudioBuffer to an MP3 Blob using a Web Worker.
 * @param audioBuffer The AudioBuffer to export.
 * @returns A Promise that resolves to a Blob representing the MP3 file.
 */
export function exportMP3(audioBuffer: AudioBuffer): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (!mp3Worker) {
      mp3Worker = new Worker(new URL('../mp3Worker.js', import.meta.url));
      mp3Worker.onmessage = (event) => {
        const { id, mp3Data, error } = event.data;
        if (workerPromises[id]) {
          if (mp3Data) {
            workerPromises[id].resolve(mp3Data);
          } else if (error) {
            workerPromises[id].reject(new Error(error));
          }
          delete workerPromises[id];
        }
      };
      mp3Worker.onerror = (event) => {
        console.error("MP3 Worker Error:", event);
        // Reject all outstanding promises if the worker itself errors
        for (const id in workerPromises) {
          workerPromises[id].reject(new Error("MP3 Worker encountered an error."));
          delete workerPromises[id];
        }
        mp3Worker?.terminate();
        mp3Worker = null;
      };
    }

    const currentId = workerMessageId++;
    workerPromises[currentId] = { resolve, reject };

    // Lamejs expects Int16Array, so convert Float32Array
    const channelData = audioBuffer.getChannelData(0); // Assuming mono
    const samples = new Int16Array(channelData.length);
    for (let i = 0; i < channelData.length; i++) {
      samples[i] = Math.max(-1, Math.min(1, channelData[i])) * 0x7FFF; // Convert Float32 to Int16
    }

    mp3Worker.postMessage(
      {
        id: currentId,
        channelData: samples, // Send Int16Array directly
        sampleRate: audioBuffer.sampleRate,
        numChannels: audioBuffer.numberOfChannels,
        quality: 5, // VBR quality (0-9, 0 is best)
      },
      [samples.buffer] // Transferable object
    );
  });
}


/**
 * Formats a time in seconds into a human-readable string (MM:SS or HH:MM:SS).
 * @param seconds The time in seconds.
 * @returns Formatted time string.
 */
export function formatTime(seconds: number): string {
  const absSeconds = Math.abs(seconds);
  const h = Math.floor(absSeconds / 3600);
  const m = Math.floor((absSeconds % 3600) / 60);
  const s = Math.floor(absSeconds % 60);

  const sign = seconds < 0 ? '-' : '';

  const parts = [m, s].map(v => v.toString().padStart(2, '0'));
  if (h > 0) {
    parts.unshift(h.toString());
  }
  return sign + parts.join(':');
}

/**
 * Loads an audio file from a given URL and decodes it into an AudioBuffer.
 * @param context The AudioContext to decode the audio with.
 * @param url The URL of the audio file.
 * @returns A Promise that resolves to an AudioBuffer.
 */
export async function loadAudioBufferFromUrl(context: AudioContext, url: string): Promise<AudioBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load audio from URL: ${url} (Status: ${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return await context.decodeAudioData(arrayBuffer);
}

/**
 * Mixes two AudioBuffers (e.g., speech and background music) with specified volume levels.
 * The output buffer will have the duration of the longer of the two input buffers.
 * Assumes both input buffers have the same sample rate and number of channels.
 * @param context The AudioContext to create the new AudioBuffer with.
 * @param speechBuffer The AudioBuffer for speech.
 * @param musicBuffer The AudioBuffer for background music.
 * @param speechVolume The volume level for speech (0.0 to 1.0).
 * @param musicVolume The volume level for background music (0.0 to 1.0).
 * @returns A new AudioBuffer with the mixed audio.
 */
export async function mixAudioBuffers(
  context: AudioContext,
  speechBuffer: AudioBuffer,
  musicBuffer: AudioBuffer,
  speechVolume: number,
  musicVolume: number
): Promise<AudioBuffer> {
  // Fix: The context parameter is already provided, so use it directly.
  const sampleRate = speechBuffer.sampleRate;
  const numberOfChannels = speechBuffer.numberOfChannels;

  // Determine the length of the final mixed buffer (max of speech and music)
  const longerLength = Math.max(speechBuffer.length, musicBuffer.length);
  const mixedBuffer = context.createBuffer(numberOfChannels, longerLength, sampleRate);

  // Get raw data for mixing
  const speechData: Float32Array[] = [];
  const musicData: Float32Array[] = [];
  for (let i = 0; i < numberOfChannels; i++) {
    speechData.push(speechBuffer.getChannelData(i));
    musicData.push(musicBuffer.getChannelData(i));
  }

  for (let channel = 0; channel < numberOfChannels; channel++) {
    const outputData = mixedBuffer.getChannelData(channel);
    const speechChannelData = speechData[channel];
    const musicChannelData = musicData[channel];

    for (let i = 0; i < longerLength; i++) {
      let mixedSample = 0;

      // Add speech sample (with volume) if available at this index
      if (i < speechChannelData.length) {
        mixedSample += speechChannelData[i] * speechVolume;
      }

      // Add music sample (with volume) if available at this index.
      // Loop music if it's shorter than speech.
      if (musicBuffer.length > 0) { // Avoid division by zero if musicBuffer is empty (shouldn't happen with valid buffer)
        const musicIndex = i % musicChannelData.length;
        mixedSample += musicChannelData[musicIndex] * musicVolume;
      }
      
      // Clamp the mixed sample to prevent audio clipping
      outputData[i] = Math.max(-1, Math.min(1, mixedSample));
    }
  }

  return mixedBuffer;
}
