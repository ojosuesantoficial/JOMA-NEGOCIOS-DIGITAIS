
// mp3Worker.js
// This is a placeholder Web Worker for MP3 encoding.
// For full functionality, you would typically import a library like 'lamejs' here.
// Example with lamejs (if available in your project/CDN):
// importScripts('https://unpkg.com/lamejs@1.2.1/lame.min.js');
// The importScripts is commented out for local dev, ensure lame.min.js is accessible if not using CDN.
// For a typical React/Webpack setup, you'd likely copy lame.min.js to a public folder and reference it like:
// `importScripts('/lame.min.js');` or ensure it's bundled correctly.
// For this fix, we assume `lamejs` will be globally available in the worker context
// either via importScripts or through a build setup that makes it so.

self.onmessage = function(event) {
  const { id, channelData, sampleRate, numChannels, quality } = event.data;

  try {
    // Ensure lamejs is available. In a production setup, `importScripts` would make it so.
    // @ts-ignore
    if (typeof lamejs === 'undefined') {
        throw new Error("lamejs not available in Web Worker. Ensure it's imported or globally accessible.");
    }
    
    // channelData is now expected to be an Int16Array (from exportMP3)
    const samples = channelData; 

    // @ts-ignore
    const mp3encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, quality);
    const mp3Data = [];

    // LAME has an internal buffer. For optimal performance, encode in chunks.
    // The exact `sampleBlockSize` can vary. 1152 is common.
    const sampleBlockSize = 1152; 

    for (let i = 0; i < samples.length; i += sampleBlockSize) {
      const sampleChunk = samples.subarray(i, i + sampleBlockSize);
      // @ts-ignore
      const mp3buf = mp3encoder.encodeBuffer(sampleChunk);
      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      }
    }
    // @ts-ignore
    const mp3buf = mp3encoder.flush();   // Flush any remaining data
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }

    self.postMessage({ id, mp3Data: new Blob(mp3Data, { type: 'audio/mpeg' }) });

  } catch (e) {
    self.postMessage({ id, error: `MP3 encoding failed: ${e instanceof Error ? e.message : String(e)}` });
  }
};
