// hooks/useAudioPlayer.ts

import { useState, useRef, useCallback, useEffect } from 'react';

interface AudioPlayerState {
  isPlaying: boolean;
  isLoading: boolean; // Managed by the component using the hook, not directly by the hook
  error: string | null;
}

interface AudioPlayerControls {
  playAudio: (buffer: AudioBuffer) => void;
  stopAudio: () => void;
  audioContext: AudioContext | null; // Expose context for external management if needed
}

export const useAudioPlayer = (): [AudioPlayerState, AudioPlayerControls] => {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      // Fix: Use window.AudioContext directly as webkitAudioContext is deprecated.
      audioContextRef.current = new window.AudioContext({ sampleRate: 24000 });
    }
    return audioContextRef.current;
  }, []);

  const stopAudio = useCallback(() => {
    if (audioSourceRef.current) {
      audioSourceRef.current.stop();
      audioSourceRef.current.disconnect();
      audioSourceRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const playAudio = useCallback(async (buffer: AudioBuffer) => {
    stopAudio(); // Stop any currently playing audio

    try {
      setError(null);
      const audioContext = getAudioContext();
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.onended = () => {
        setIsPlaying(false);
        audioSourceRef.current = null;
      };
      source.start(0);
      audioSourceRef.current = source;
      setIsPlaying(true);
    } catch (e: any) {
      console.error("Error playing audio:", e);
      setError(`Falha ao reproduzir áudio: ${e.message}`);
      setIsPlaying(false);
    }
  }, [getAudioContext, stopAudio]);

  useEffect(() => {
    return () => {
      stopAudio(); // Ensure any playing audio is stopped when component unmounts
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(e => console.error("Error closing AudioContext:", e));
        audioContextRef.current = null;
      }
    };
  }, [stopAudio]);

  return [
    { isPlaying, isLoading: false, error }, // isLoading is managed by the consumer component
    { playAudio, stopAudio, audioContext: audioContextRef.current }
  ];
};