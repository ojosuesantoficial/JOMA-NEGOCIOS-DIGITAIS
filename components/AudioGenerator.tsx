

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { geminiService, parseGeminiError } from '../services/geminiService';
import LoadingSpinner from './LoadingSpinner';
import { combineAudioBuffers, exportMP3, exportWAV, formatTime, loadAudioBufferFromUrl, mixAudioBuffers } from '../utils/audioUtils';
// Fix: Import AUDIO_PREVIEW_TEXT from appUtils
import { AUDIO_PREVIEW_TEXT, BACKGROUND_MUSIC_OPTIONS, DEFAULT_MUSIC_VOLUME, DEFAULT_SPEECH_VOLUME } from '../utils/appUtils'; // Import new constants
import { useAudioPlayer } from '../hooks/useAudioPlayer'; // Import useAudioPlayer hook

const MAX_TEXT_LENGTH = 70000; // Max characters for audio generation
const MAX_CHARS_PER_AUDIO_CHUNK = 35000; // Increased to 35,000 chars per chunk to reduce API calls
const ESTIMATED_CHARS_PER_SECOND_AUDIO = 18; // Adjusted from 12 to 18 for a more optimistic and realistic estimate with larger chunks
const CONCURRENCY_LIMIT = 4; // NEW: Number of simultaneous API requests allowed

// Voice options for the dropdown
const VOICE_OPTIONS = [
  { name: 'Charon', description: 'Profunda e Autoritária' },
  { name: 'Fenrir', description: 'Ressonante e Impactante' },
  { name: 'Kore', description: 'Clara e Equilibrada' },
  { name: 'Puck', description: 'Jovial e Expressiva' },
  { name: 'Zephyr', description: 'Suave e Calma' },
];

type AudioView = 'generateAudio' | 'cloneVoice';

const AudioGenerator: React.FC = () => {
  const [activeAudioView, setActiveAudioView] = useState<AudioView>('generateAudio'); // NEW: State to manage active sub-view

  const [text, setText] = useState<string>('');
  const [generatedAudioBlobUrl, setGeneratedAudioBlobUrl] = useState<string | null>(null);
  const [currentAudioBuffer, setCurrentAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isGeneratingTTS, setIsGeneratingTTS] = useState<boolean>(false); // For overall TTS API generation
  const [isCombiningAudio, setIsCombiningAudio] = useState<boolean>(false); // For combining chunks
  const [isExportingMP3, setIsExportingMP3] = useState<boolean>(false); // For MP3 export via worker
  const [isLoadingChunkAPI, setIsLoadingChunkAPI] = useState<boolean>(false); // For individual TTS API calls
  const [error, setError] = useState<string | null>(null);

  const [totalCharacters, setTotalCharacters] = useState<number>(0);
  const [generatedCharacterCount, setGeneratedCharacterCount] = useState<number>(0);
  const [currentAudioDuration, setCurrentAudioDuration] = useState<number>(0); // Actual generated audio duration
  const [generationProgress, setGenerationProgress] = useState<number>(0); // 0-100% for TTS (TARGET progress)
  const [generationProgressDisplay, setGenerationProgressDisplay] = useState<number>(0); // Progress actually displayed (ANIMATED)
  const [elapsedTime, setElapsedTime] = useState<number>(0); // Timer for overall TTS process

  const [selectedVoice, setSelectedVoice] = useState<string>(VOICE_OPTIONS[0].name); // Default to the first voice option

  const [fileName, setFileName] = useState<string | null>(null);
  const [fileLoadingError, setFileLoadingError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // NEW: Audio preview states and hook
  const [voiceAudioBuffers, setVoiceAudioBuffers] = useState<Record<string, AudioBuffer>>({});
  const [loadingPreviewVoice, setLoadingPreviewVoice] = useState<string | null>(null);
  const [{ isPlaying: isPreviewPlaying, error: previewError }, { playAudio: playPreviewAudio, stopAudio: stopPreviewAudio }] = useAudioPlayer();

  // NEW: Background music states
  const [selectedBackgroundMusic, setSelectedBackgroundMusic] = useState<string>(BACKGROUND_MUSIC_OPTIONS[0].value);
  const [speechVolume, setSpeechVolume] = useState<number>(DEFAULT_SPEECH_VOLUME);
  const [musicVolume, setMusicVolume] = useState<number>(DEFAULT_MUSIC_VOLUME);
  const [backgroundMusicBuffer, setBackgroundMusicBuffer] = useState<AudioBuffer | null>(null);
  const [isLoadingBackgroundMusic, setIsLoadingBackgroundMusic] = useState<boolean>(false);
  const [backgroundMusicError, setBackgroundMusicError] = useState<string | null>(null);
  const [isMixingAudio, setIsMixingAudio] = useState<boolean>(false); // State for mixing process

  // NEW: State for Clone Voice feature
  const [uploadedMediaFile, setUploadedMediaFile] = useState<File | null>(null);
  const [uploadedMediaDuration, setUploadedMediaDuration] = useState<number | null>(null);
  const [isCloningVoice, setIsCloningVoice] = useState<boolean>(false); // State for cloning process
  const [cloneVoiceError, setCloneVoiceError] = useState<string | null>(null);
  const cloneFileInputRef = useRef<HTMLInputElement>(null);


  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const currentCombinedAudioBuffers = useRef<AudioBuffer[]>([]);
  const stopGenerationRef = useRef<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize AudioContext on first interaction
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new AudioContext({ sampleRate: 24000 });
    }
    return audioContextRef.current;
  }, []);

  // Clean up AudioContext and Blob URLs on unmount
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(e => console.error("Error closing AudioContext:", e));
        audioContextRef.current = null;
      }
      if (generatedAudioBlobUrl) {
        URL.revokeObjectURL(generatedAudioBlobUrl);
      }
      if (audioSourceRef.current) {
        audioSourceRef.current.stop();
        audioSourceRef.current.disconnect();
      }
      stopGenerationRef.current = true; // Ensure loops stop
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      stopPreviewAudio(); // Stop any playing preview audio
      // Clean up uploaded media object URL if any
      if (uploadedMediaFile && uploadedMediaDuration !== null) { // This condition is a bit off, better check the actual URL if created
         // If a Blob URL was created for previewing the uploaded media, it should be revoked here.
         // Currently, no Blob URL is created for the uploaded file itself, only for generated audio.
      }
    };
  }, [generatedAudioBlobUrl, stopPreviewAudio, uploadedMediaFile, uploadedMediaDuration]);

  // Load background music when selectedBackgroundMusic changes
  useEffect(() => {
    const loadBackgroundMusic = async () => {
      if (selectedBackgroundMusic === 'none') {
        setBackgroundMusicBuffer(null);
        setBackgroundMusicError(null);
        setIsLoadingBackgroundMusic(false);
        return;
      }

      const musicOption = BACKGROUND_MUSIC_OPTIONS.find(opt => opt.value === selectedBackgroundMusic);
      if (!musicOption || !musicOption.url) {
        setBackgroundMusicError("URL de fundo musical inválida ou não encontrada.");
        setBackgroundMusicBuffer(null);
        setIsLoadingBackgroundMusic(false);
        return;
      }

      setIsLoadingBackgroundMusic(true);
      setBackgroundMusicError(null);
      try {
        const audioContext = getAudioContext();
        const buffer = await loadAudioBufferFromUrl(audioContext, musicOption.url);
        setBackgroundMusicBuffer(buffer);
      } catch (err: unknown) {
        setBackgroundMusicError(`Erro ao carregar fundo musical: ${err instanceof Error ? err.message : "Erro desconhecido."}`);
        setBackgroundMusicBuffer(null);
      } finally {
        setIsLoadingBackgroundMusic(false);
      }
    };

    loadBackgroundMusic();
  }, [selectedBackgroundMusic, getAudioContext]);


  // Update elapsed time for TTS generation phase
  useEffect(() => {
    if (isGeneratingTTS) {
      startTimeRef.current = performance.now();
      const updateTimer = () => {
        if (!startTimeRef.current) return;
        const newElapsedTime = (performance.now() - startTimeRef.current) / 1000;
        setElapsedTime(newElapsedTime);
        animationFrameRef.current = requestAnimationFrame(updateTimer);
      };
      animationFrameRef.current = requestAnimationFrame(updateTimer);
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      startTimeRef.current = null;
    }
  }, [isGeneratingTTS]); // Removed totalCharacters from dependencies as it's not needed for elapsed time

  // Effect for animating the progress bar display
  useEffect(() => {
    let animationFrameId: number | null = null;
    const step = 1; // Increment by 1% per frame for smooth visual update

    const updateDisplayProgress = () => {
      setGenerationProgressDisplay(prevDisplayed => {
        if (prevDisplayed < generationProgress) {
          return Math.min(generationProgress, prevDisplayed + step);
        } else if (prevDisplayed > generationProgress) {
          // This case should not happen if progress only increases, but useful for robustness
          return Math.max(generationProgress, prevDisplayed - step);
        }
        return prevDisplayed; // Target reached
      });

      // Continue animation if target not reached and generation is active
      if (generationProgressDisplay !== generationProgress && isGeneratingTTS && !stopGenerationRef.current) {
        animationFrameId = requestAnimationFrame(updateDisplayProgress);
      } else {
        // If generation stops, ensure the display matches the final target
        // or is explicitly reset to 0 if generation was stopped prematurely.
        if (!isGeneratingTTS && stopGenerationRef.current) {
          setGenerationProgressDisplay(0);
        } else if (!isGeneratingTTS) { // Generation finished successfully
          setGenerationProgressDisplay(generationProgress); // Ensure it caps at the final target
        }
        animationFrameId = null;
      }
    };

    if (isGeneratingTTS && generationProgressDisplay !== generationProgress && !stopGenerationRef.current) {
      animationFrameId = requestAnimationFrame(updateDisplayProgress);
    } else if (!isGeneratingTTS && generationProgressDisplay !== generationProgress) {
       // When generation stops or changes, ensure progress is correctly set if not animating
       // This handles cases where `generationProgress` might be updated to 100% just before `isGeneratingTTS` becomes false.
      setGenerationProgressDisplay(generationProgress);
    }

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [generationProgress, isGeneratingTTS, stopGenerationRef]); // Removed generationProgressDisplay from dependencies to avoid re-triggering unnecessarily

  const handleGenerateAudio = useCallback(async () => {
    if (isGeneratingTTS || isCombiningAudio || isExportingMP3 || isMixingAudio || isLoadingBackgroundMusic) return; // Prevent multiple generations
    stopGenerationRef.current = false;
    stopPreviewAudio(); // Stop any playing preview audio when starting new audio generation

    setError(null);
    setGeneratedAudioBlobUrl(null);
    setCurrentAudioBuffer(null);
    currentCombinedAudioBuffers.current = [];
    setTotalCharacters(text.length);
    setGeneratedCharacterCount(0);
    setCurrentAudioDuration(0);
    setGenerationProgress(0); // Reset target progress
    setGenerationProgressDisplay(0); // Reset displayed progress
    setElapsedTime(0);

    if (!text.trim()) {
      setError("Por favor, insira algum texto para gerar áudio.");
      return;
    }
    if (text.length > MAX_TEXT_LENGTH) {
      setError(`O texto excede o limite de ${MAX_TEXT_LENGTH} caracteres.`);
      return;
    }

    setIsGeneratingTTS(true);
    setIsLoadingChunkAPI(true); // Indicate initial API call setup

    try {
      const audioContext = getAudioContext();
      // Ensure AudioContext is running
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // Regex to split text into sentences respecting abbreviations, numbers etc.
      const sentenceRegex = /(?<!\w\.\w.)(?<![A-Z][a-z]\.)(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÀÈÌÒÙÃÕÂÊÎÔÛÜÇ])/;
      const paragraphs = text.split(/\n\s*\n/); // Split by double newline for paragraphs
      const textChunks: string[] = [];

      // Split paragraphs into sentences or smaller chunks
      for (const paragraph of paragraphs) {
        if (!paragraph.trim()) continue;
        let currentChunk = '';
        const sentences = paragraph.split(sentenceRegex);
        for (const sentence of sentences) {
          if (!sentence.trim()) continue;
          // Check if adding the sentence exceeds the chunk limit
          if ((currentChunk ? currentChunk.length + sentence.length + 1 : sentence.length) <= MAX_CHARS_PER_AUDIO_CHUNK) {
            currentChunk += (currentChunk ? ' ' : '') + sentence.trim();
          } else {
            // If currentChunk is not empty, push it and start a new one
            if (currentChunk) {
              textChunks.push(currentChunk);
            }
            currentChunk = sentence.trim(); // Start new chunk with the current sentence
            // If even a single sentence is larger than MAX_CHARS_PER_AUDIO_CHUNK, it will be its own chunk
            // but given 15000, it's unlikely for a single sentence to be that long.
            // With 35,000, it's still unlikely.
          }
        }
        if (currentChunk) {
          textChunks.push(currentChunk); // Push any remaining part of the paragraph
        }
      }

      // Handle the edge case where the text is very short and doesn't get chunked by paragraphs/sentences
      if (textChunks.length === 0 && text.trim().length > 0) {
        textChunks.push(text.trim());
      }

      if (textChunks.length === 0) {
        setError("Nenhum texto válido foi encontrado para gerar áudio após a segmentação.");
        setIsGeneratingTTS(false);
        setIsLoadingChunkAPI(false);
        return;
      }

      // Initialize array to store audio buffers in the correct order
      const orderedBuffers: (AudioBuffer | null)[] = new Array(textChunks.length).fill(null);
      let processedChars = 0;

      // HIGH PERFORMANCE: Batch processing with parallel requests
      for (let i = 0; i < textChunks.length; i += CONCURRENCY_LIMIT) {
        if (stopGenerationRef.current) break;
        
        setIsLoadingChunkAPI(true); // Show spinner for batch processing
        
        const batchEnd = Math.min(i + CONCURRENCY_LIMIT, textChunks.length);
        const batchPromises = [];

        for (let j = i; j < batchEnd; j++) {
          const chunk = textChunks[j];
          const promise = geminiService.generateSpeech(chunk, selectedVoice, { 
            maxRetries: 3,
            initialDelayMs: 1000,
            onRetryWait: (delay, retriesLeft, errMsg) => {
               // Log error but allow other concurrent requests to continue
               console.warn(`Retrying chunk ${j}: ${errMsg}`);
            }
          }).then(audioBuffer => {
             if (stopGenerationRef.current) return null;
             orderedBuffers[j] = audioBuffer;
             processedChars += chunk.length;
             // Update progress safely (using functional update to avoid stale closures is hard inside loop, relying on processedChars ref)
             setGeneratedCharacterCount(prev => prev + chunk.length);
             setGenerationProgress(prev => Math.min(100, prev + Math.floor((chunk.length / totalCharacters) * 100)));
             return audioBuffer;
          }).catch(chunkError => {
             if (stopGenerationRef.current) return null;
             const msg = parseGeminiError(chunkError).errorMessage;
             setError(`Erro no trecho ${j + 1}: ${msg}`);
             return null; // Return null to signal failure
          });
          
          batchPromises.push(promise);
        }

        // Wait for the current batch to finish before starting the next batch
        // This prevents flooding the browser network stack while still being much faster than sequential
        await Promise.all(batchPromises);
        
        // If any error set the stop flag or error state, break
        if (error || stopGenerationRef.current) break;
      }
      
      setIsLoadingChunkAPI(false);

      // Filter out failed chunks (nulls) and combine
      const validBuffers = orderedBuffers.filter(b => b !== null) as AudioBuffer[];
      
      // Check if we have all the chunks or at least some content if not fully stopped
      if (!stopGenerationRef.current && validBuffers.length > 0 && validBuffers.length === textChunks.length) {
        currentCombinedAudioBuffers.current = validBuffers;

        setIsGeneratingTTS(false); // TTS API calls are done
        setIsCombiningAudio(true); // Start combining speech chunks
        const combinedSpeechBuffer = combineAudioBuffers(audioContext, currentCombinedAudioBuffers.current);

        // NEW: Mix with background music if selected
        let finalOutputBuffer = combinedSpeechBuffer;
        if (selectedBackgroundMusic !== 'none' && backgroundMusicBuffer) {
          setIsCombiningAudio(false); // Combining speech done
          setIsMixingAudio(true); // Start mixing
          finalOutputBuffer = await mixAudioBuffers(
            audioContext, // Fix: Pass audioContext here
            combinedSpeechBuffer,
            backgroundMusicBuffer,
            speechVolume,
            musicVolume
          );
        }

        setCurrentAudioBuffer(finalOutputBuffer); // Store for WAV/MP3 export
        setCurrentAudioDuration(finalOutputBuffer.duration);

        const wavBlob = exportWAV(finalOutputBuffer);
        setGeneratedAudioBlobUrl(URL.createObjectURL(wavBlob));
        setIsCombiningAudio(false); // Combining phase done
        setIsMixingAudio(false); // Mixing phase done
      } else if (stopGenerationRef.current) {
        setError("Geração de áudio interrompida.");
      } else if (validBuffers.length !== textChunks.length) {
         setError("Alguns trechos do áudio falharam na geração. O áudio incompleto não foi gerado.");
      }

    } catch (err: unknown) {
      if (!stopGenerationRef.current) {
        setError(`Ocorreu um erro inesperado: ${parseGeminiError(err).errorMessage}`);
      }
    } finally {
      setIsGeneratingTTS(false);
      setIsLoadingChunkAPI(false);
      setIsCombiningAudio(false);
      setIsMixingAudio(false); // Ensure mixing state is reset
      stopGenerationRef.current = false; // Reset stop flag
      // Ensure progress bar is 100% at the end if not manually stopped
      setGenerationProgress(100);
      setGenerationProgressDisplay(100); // Ensure visual is also 100%
    }
  }, [text, getAudioContext, totalCharacters, isGeneratingTTS, isCombiningAudio, isExportingMP3, selectedVoice, stopPreviewAudio,
      selectedBackgroundMusic, backgroundMusicBuffer, speechVolume, musicVolume, isMixingAudio, isLoadingBackgroundMusic, error]);

  const handleStopGeneration = useCallback(() => {
    stopGenerationRef.current = true;
    setIsGeneratingTTS(false);
    setIsLoadingChunkAPI(false);
    setIsCombiningAudio(false);
    setIsMixingAudio(false); // Reset mixing state
    if (audioSourceRef.current) {
      audioSourceRef.current.stop();
      audioSourceRef.current.disconnect();
    }
    // Close AudioContext when stopping generation to free up resources
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(e => console.error("Error closing AudioContext on stop:", e));
      audioContextRef.current = null; // Clear the ref
    }
    stopPreviewAudio(); // Stop any playing preview audio
    setGenerationProgress(0); // Reset target progress
    setGenerationProgressDisplay(0); // Reset displayed progress immediately
    setError("Geração de áudio interrompida pelo usuário.");
    setElapsedTime(0); // Reset elapsed time when stopped
  }, [stopPreviewAudio]);

  const handleDownloadWAV = useCallback(() => {
    if (currentAudioBuffer) {
      const wavBlob = exportWAV(currentAudioBuffer);
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audio_gerado_${Date.now()}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, [currentAudioBuffer]);

  const handleDownloadMP3 = useCallback(async () => {
    if (currentAudioBuffer) {
      try {
        setError(null);
        setIsExportingMP3(true); // Indicate MP3 export is in progress
        const mp3Blob = await exportMP3(currentAudioBuffer);
        const url = URL.createObjectURL(mp3Blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audio_gerado_${Date.now()}.mp3`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (mp3Error) {
        let userMessage = `Erro ao exportar MP3: ${mp3Error instanceof Error ? mp3Error.message : "Erro desconhecido"}`;
        // Specific message for the placeholder worker from mp3Worker.js
        if (userMessage.includes("A funcionalidade de exportação MP3 está atualmente desativada ou requer uma biblioteca")) {
          userMessage = "Erro ao exportar MP3: A funcionalidade de exportação MP3 requer uma biblioteca de codificação (e.g., lamejs) no Web Worker para funcionar. Apenas o WAV está totalmente funcional no momento.";
        }
        setError(userMessage);
      } finally {
        setIsExportingMP3(false);
      }
    }
  }, [currentAudioBuffer]);

  // NEW: Handle playing voice preview
  const handlePlayVoicePreview = useCallback(async () => {
    if (!selectedVoice) {
      setError("Por favor, selecione uma voz para pré-visualizar.");
      return;
    }

    if (isPreviewPlaying) {
      stopPreviewAudio(); // Stop if already playing
      if (loadingPreviewVoice === selectedVoice) {
          // If already loading this tone, and we stop it, don't try to load it again immediately
          setLoadingPreviewVoice(null);
          return;
      }
    }

    // If the audio buffer is already cached, play it directly
    if (voiceAudioBuffers[selectedVoice]) {
      playPreviewAudio(voiceAudioBuffers[selectedVoice]);
      return;
    }

    // Otherwise, load it
    setLoadingPreviewVoice(selectedVoice);
    setError(null); // Clear main error before loading preview
    // For now, using the main error state for preview errors too, but could be separated if needed.

    try {
      const audioBuffer = await geminiService.generateSpeech(AUDIO_PREVIEW_TEXT, selectedVoice, {
          maxRetries: 1, // Only one retry for preview for faster feedback
          initialDelayMs: 500,
          onRetryWait: (delay, retriesLeft, errMsg) => {
            setError(`Retentando prévia (em ${delay / 1000}s)... ${retriesLeft} tentativas restantes. ${errMsg}`);
          }
      });

      setVoiceAudioBuffers(prev => ({ ...prev, [selectedVoice]: audioBuffer }));
      playPreviewAudio(audioBuffer);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(`Erro ao carregar prévia do áudio: ${err.message}`);
      } else {
        setError("Ocorreu um erro inesperado ao carregar a prévia do áudio.");
      }
    } finally {
      setLoadingPreviewVoice(null);
    }
  }, [selectedVoice, isPreviewPlaying, playPreviewAudio, stopPreviewAudio, voiceAudioBuffers, loadingPreviewVoice]);

  // File drop functionality for main text input
  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  const processTextFile = useCallback((file: File) => {
    setFileLoadingError(null);
    setFileName(file.name);

    if (file.type === 'text/plain') {
      const reader = new FileReader();
      reader.onload = (e) => {
        const fileContent = e.target?.result as string;
        if (fileContent.length > MAX_TEXT_LENGTH) {
          setFileLoadingError(`O arquivo excede o limite de ${MAX_TEXT_LENGTH} caracteres. (${fileContent.length})`);
          setText(''); // Clear text if too long
        } else {
          setText(fileContent);
          setFileLoadingError(null);
        }
      };
      reader.onerror = () => {
        setFileLoadingError("Falha ao ler o arquivo de texto.");
      };
      reader.readAsText(file);
    } else if (file.type === 'application/pdf') {
      setFileLoadingError("Arquivos PDF não são suportados para leitura direta no momento. Por favor, cole o texto manualmente.");
      setText('');
    } else {
      setFileLoadingError("Formato de arquivo não suportado. Por favor, use .txt ou .pdf.");
      setText('');
    }
  }, []);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      processTextFile(files[0]);
    }
  }, [processTextFile]);

  const handleTextFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      processTextFile(files[0]);
    }
    // Reset the input value so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [processTextFile]);


  // NEW: Clone Voice specific handlers
  const handleCloneFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    setCloneVoiceError(null);
    setUploadedMediaFile(null);
    setUploadedMediaDuration(null);

    const files = event.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      // Basic validation for file type and size (3 hours is a very large file, need to handle)
      if (!['audio/mpeg', 'audio/wav', 'audio/ogg', 'video/avi', 'video/mp4', 'video/quicktime'].includes(file.type)) {
        setCloneVoiceError("Formato de arquivo não suportado. Por favor, use .mp3, .wav, .ogg, .mp4 ou .avi.");
        return;
      }

      const MAX_FILE_SIZE_MB = 300; // Roughly 3 hours of MP3 at ~2MB/min. AVI can be much larger.
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setCloneVoiceError(`O arquivo excede o limite de ${MAX_FILE_SIZE_MB}MB.`);
        return;
      }
      
      setUploadedMediaFile(file);
      
      // Attempt to get audio/video duration
      const url = URL.createObjectURL(file);
      const audio = new Audio(url);
      audio.onloadedmetadata = () => {
        setUploadedMediaDuration(audio.duration);
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        console.error("Error loading media for duration calculation.");
        setUploadedMediaDuration(null); // Could not determine duration
        URL.revokeObjectURL(url);
      };

    }
    if (cloneFileInputRef.current) {
      cloneFileInputRef.current.value = '';
    }
  }, []);

  const handleCloneVoice = useCallback(async () => {
    setCloneVoiceError(null);
    if (!uploadedMediaFile) {
      setCloneVoiceError("Por favor, faça upload de um arquivo de áudio/vídeo para clonar a voz.");
      return;
    }

    setIsCloningVoice(true);
    try {
      // THIS IS THE CRUCIAL PART: Gemini API does NOT support voice cloning directly.
      // This button would typically trigger a call to a dedicated voice cloning API.
      // For this exercise, we will display a disclaimer.
      setCloneVoiceError(
        "A funcionalidade de clonagem de voz diretamente de um arquivo enviado (MP3/AVI) não é suportada pela API Gemini atual. " +
        "As vozes disponíveis são pré-construídas. Para clonagem real, seria necessário uma API de clonagem de voz dedicada, que não está integrada aqui."
      );
      // In a real scenario, here you'd make an API call to a voice cloning service.
      // Example: const clonedVoiceId = await voiceCloningService.uploadAndClone(uploadedMediaFile);
      // Then, you'd store clonedVoiceId and allow its selection in the main TTS area.
      // This is a placeholder for that logic.
    } catch (err: unknown) {
      setCloneVoiceError(`Erro ao tentar clonar a voz: ${err instanceof Error ? err.message : "Erro desconhecido"}`);
    } finally {
      setIsCloningVoice(false);
    }
  }, [uploadedMediaFile]);

  const remainingChars = MAX_TEXT_LENGTH - text.length;
  const isFormInvalid = !text.trim() || text.length > MAX_TEXT_LENGTH;

  // Determine overall loading state for disabling inputs/buttons
  // NEW: Include preview loading/playing states AND cloning states AND background music states
  const overallLoading = isGeneratingTTS || isCombiningAudio || isExportingMP3 || loadingPreviewVoice !== null || isPreviewPlaying || isCloningVoice || isLoadingBackgroundMusic || isMixingAudio;

  let spinnerMessage = "Carregando...";
  if (isGeneratingTTS) {
    spinnerMessage = isLoadingChunkAPI ? "Gerando áudio em alta velocidade (paralelo)..." : "Iniciando geração de áudio...";
  } else if (isCombiningAudio) {
    spinnerMessage = "Combinando áudio...";
  } else if (isMixingAudio) {
    spinnerMessage = "Mixando áudio com fundo musical...";
  } else if (isExportingMP3) {
    spinnerMessage = "Exportando MP3...";
  } else if (loadingPreviewVoice !== null) {
    spinnerMessage = "Carregando prévia da voz...";
  } else if (isCloningVoice) {
    spinnerMessage = "Analisando arquivo e simulando clonagem de voz..."; // Placeholder message
  } else if (isLoadingBackgroundMusic) {
    spinnerMessage = "Carregando fundo musical...";
  }

  const renderAudioGenerator = () => (
    <>
      <h2 className="text-3xl sm:text-4xl font-extrabold text-fuchsia-300 leading-tight drop-shadow-md text-center mb-8">
        Gerador de Áudio
      </h2>

      <div className="mb-6">
        <label htmlFor="audioText" className="block text-xl font-semibold text-purple-300 mb-2">
          Texto para Áudio:
        </label>
        <textarea
          id="audioText"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full p-3 border border-purple-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-400 text-lg bg-gray-800 disabled:bg-gray-700 disabled:text-gray-400 shadow-sm text-white placeholder-purple-400 min-h-[200px]"
          placeholder="Digite o texto que deseja converter em fala (até 70.000 caracteres)."
          rows={10}
          maxLength={MAX_TEXT_LENGTH}
          disabled={overallLoading}
          aria-label="Texto para gerar áudio"
        />
        <p className={`text-sm mt-2 ${remainingChars < 500 ? 'text-red-400' : 'text-purple-400'}`}>
          {text.length} caracteres ({remainingChars} restantes)
        </p>
      </div>

      {/* Voice Selection Dropdown */}
      <div className="mb-6">
        <label htmlFor="voiceSelection" className="block text-xl font-semibold text-purple-300 mb-2">
          Tonalidade de Voz:
        </label>
        <div className="flex items-center space-x-2"> {/* Added flex container */}
          <select
            id="voiceSelection"
            value={selectedVoice}
            onChange={(e) => setSelectedVoice(e.target.value)}
            className="w-full p-3 border border-purple-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-400 text-lg bg-gray-800 disabled:bg-gray-700 disabled:text-gray-400 shadow-sm text-white"
            disabled={overallLoading}
            aria-label="Selecione a tonalidade de voz"
          >
            {VOICE_OPTIONS.map((voice) => (
              <option key={voice.name} value={voice.name}>
                {voice.name} ({voice.description})
              </option>
            ))}
          </select>
          <button
            onClick={handlePlayVoicePreview}
            disabled={overallLoading || !selectedVoice}
            className={`
              px-4 py-2 rounded-full text-white font-semibold text-sm shadow-md transition-all duration-300
              ${(overallLoading || !selectedVoice)
                ? 'bg-gray-600 cursor-not-allowed opacity-70'
                : isPreviewPlaying
                  ? 'bg-red-500 hover:bg-red-600'
                  : 'bg-green-500 hover:bg-green-600'
              }
              focus:outline-none focus:ring-2 focus:ring-green-300
            `}
            aria-label={isPreviewPlaying ? "Parar prévia da voz" : "Ouvir prévia da voz"}
            title={isPreviewPlaying ? "Parar prévia da voz" : "Ouvir prévia da voz"}
          >
            {loadingPreviewVoice !== null ? 'Carregando...' : isPreviewPlaying ? '⏹️ Parar' : '▶️ Ouvir'}
          </button>
        </div>
        {previewError && ( // Display preview specific errors
            <div className="bg-red-800 border border-red-600 text-red-200 px-4 py-3 rounded-lg relative mt-2 text-sm" role="alert">
              <strong className="font-bold">Erro na prévia: </strong>
              <span className="block sm:inline">{previewError}</span>
            </div>
        )}
        <p className="text-sm text-purple-400 mt-2">Escolha uma voz para o seu áudio. As vozes variam de profundas a suaves e expressivas.</p>
      </div>

      {/* NEW: Background Music Selection and Volume Controls */}
      <div className="mb-6 p-4 bg-gray-800 rounded-xl shadow-inner border border-purple-700">
        <h3 className="text-xl font-bold text-fuchsia-300 mb-4">Fundo Musical (Opcional)</h3>
        <div className="mb-4">
          <label htmlFor="backgroundMusic" className="block text-lg font-semibold text-purple-300 mb-2">
            Selecionar Fundo:
          </label>
          <select
            id="backgroundMusic"
            value={selectedBackgroundMusic}
            onChange={(e) => setSelectedBackgroundMusic(e.target.value)}
            className="w-full p-3 border border-purple-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-400 text-lg bg-gray-800 disabled:bg-gray-700 disabled:text-gray-400 shadow-sm text-white"
            disabled={overallLoading}
            aria-label="Selecione uma faixa de fundo musical"
          >
            {BACKGROUND_MUSIC_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {isLoadingBackgroundMusic && (
            <p className="text-purple-400 text-sm mt-2">Carregando fundo musical...</p>
          )}
          {backgroundMusicError && (
            <div className="bg-red-800 border border-red-600 text-red-200 px-4 py-3 rounded-lg relative mt-2 text-sm" role="alert">
              <strong className="font-bold">Erro Fundo Musical: </strong>
              <span className="block sm:inline">{backgroundMusicError}</span>
            </div>
          )}
        </div>

        <div className="mb-4">
          <label htmlFor="speechVolume" className="block text-lg font-semibold text-purple-300 mb-2">
            Volume da Voz: {Math.round(speechVolume * 100)}%
          </label>
          <input
            id="speechVolume"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={speechVolume}
            onChange={(e) => setSpeechVolume(Number(e.target.value))}
            className="w-full h-2 bg-purple-600 rounded-lg appearance-none cursor-pointer range-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-400 disabled:opacity-50"
            disabled={overallLoading || selectedBackgroundMusic === 'none'}
            aria-label="Controlar volume da voz"
          />
        </div>

        <div>
          <label htmlFor="musicVolume" className="block text-lg font-semibold text-purple-300 mb-2">
            Volume do Fundo: {Math.round(musicVolume * 100)}%
          </label>
          <input
            id="musicVolume"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={musicVolume}
            onChange={(e) => setMusicVolume(Number(e.target.value))}
            className="w-full h-2 bg-purple-600 rounded-lg appearance-none cursor-pointer range-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-400 disabled:opacity-50"
            disabled={overallLoading || selectedBackgroundMusic === 'none'}
            aria-label="Controlar volume do fundo musical"
          />
        </div>
      </div>


      {/* File Drop Area */}
      <div
        className={`mb-6 p-6 border-2 ${isDragging ? 'border-fuchsia-400 bg-purple-900' : 'border-dashed border-purple-600 bg-gray-800'} rounded-lg text-center cursor-pointer transition-all duration-300`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        aria-label="Área para arrastar e soltar arquivos de texto (.txt) ou PDF (.pdf)"
        role="button"
        tabIndex={0}
        style={{ pointerEvents: overallLoading ? 'none' : 'auto' }} // Disable interaction when loading
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleTextFileChange} // Changed to handleTextFileChange
          className="hidden"
          accept=".txt,.pdf"
          disabled={overallLoading}
        />
        <p className="text-xl font-semibold text-fuchsia-200 mb-2">📁 Arraste e solte um arquivo .txt ou .pdf aqui</p>
        <p className="text-purple-400">ou clique para selecionar</p>
        {fileName && <p className="mt-2 text-purple-300">Arquivo carregado: <span className="font-medium">{fileName}</span></p>}
      </div>

      {fileLoadingError && (
        <div className="bg-yellow-800 border border-yellow-600 text-yellow-200 px-4 py-3 rounded-lg relative mb-6" role="alert">
          <strong className="font-bold">Atenção: </strong>
          <span className="block sm:inline">{fileLoadingError}</span>
        </div>
      )}

      {error && (
        <div className="bg-red-800 border border-red-600 text-red-200 px-4 py-3 rounded-lg relative mb-6" role="alert">
          <strong className="font-bold">Erro: </strong>
          <span className="block sm:inline">{error}</span>
        </div>
      )}

      {overallLoading && (
        <LoadingSpinner message={spinnerMessage} />
      )}

      {isGeneratingTTS && (
        <div className="p-4 bg-gray-800 rounded-xl shadow-inner mb-6 border border-purple-700">
          <div className="flex justify-between items-center mb-2">
            <span className="text-purple-300 font-medium text-lg">Progresso da Geração:</span>
            <span className="text-white font-bold text-xl">{Math.floor(generationProgressDisplay)}%</span>
          </div>
          <div className="w-full bg-purple-800 rounded-full h-3 relative mb-2" role="progressbar" aria-valuenow={Math.floor(generationProgressDisplay)} aria-valuemin={0} aria-valuemax={100} aria-label={`Progresso da geração de áudio: ${generationProgressDisplay.toFixed(0)}%`}>
            <div
              className="bg-gradient-to-r from-purple-500 to-indigo-600 h-3 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${generationProgressDisplay}%` }}
              title={`Progresso: ${generationProgressDisplay.toFixed(1)}%`}
            ></div>
          </div>
          <div className="flex justify-between text-sm text-purple-400">
            <span>Caracteres processados: {generatedCharacterCount}/{totalCharacters}</span>
            <span>Tempo decorrido: {formatTime(elapsedTime)}</span>
          </div>
        </div>
      )}

      {generatedAudioBlobUrl && !overallLoading && (
        <div className="bg-gray-800 p-6 rounded-xl shadow-inner mb-6 border border-purple-700">
          <h3 className="text-2xl font-bold text-fuchsia-300 mb-4">Áudio Gerado ({formatTime(currentAudioDuration)}):</h3>
          <audio controls src={generatedAudioBlobUrl} className="w-full rounded-lg shadow-md" aria-label="Áudio gerado"></audio>
          <div className="mt-4 flex flex-col sm:flex-row justify-center gap-4">
            <button
              onClick={handleDownloadWAV}
              className="px-6 py-3 rounded-full bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-300 text-white font-semibold text-lg shadow-lg hover:shadow-xl transform transition-all duration-300 hover:scale-105 active:scale-95"
              aria-label="Baixar áudio em formato WAV"
              disabled={isExportingMP3} // Disable if MP3 export is ongoing
            >
              Baixar WAV
            </button>
            <button
              onClick={handleDownloadMP3}
              className={`px-6 py-3 rounded-full text-white font-semibold text-lg shadow-lg hover:shadow-xl transform transition-all duration-300 hover:scale-105 active:scale-95
                ${isExportingMP3 ? 'bg-gradient-to-r from-gray-600 to-gray-700 cursor-not-allowed opacity-70' : 'bg-gradient-to-r from-lime-500 to-green-500 hover:from-lime-600 hover:to-green-600 focus:outline-none focus:ring-4 focus:ring-green-300'}`}
              aria-label="Baixar áudio em formato MP3"
              disabled={isExportingMP3}
            >
              {isExportingMP3 ? 'Exportando MP3...' : 'Baixar MP3'}
            </button>
          </div>
        </div>
      )}

      <div className="mt-auto flex justify-center space-x-4">
        {isGeneratingTTS || isCombiningAudio || isMixingAudio ? (
          <button
            onClick={handleStopGeneration}
            className={`px-8 py-4 rounded-full text-white font-semibold text-xl shadow-lg hover:shadow-xl transform transition-all duration-300 hover:scale-105 active:scale-95
              bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 focus:outline-none focus:ring-4 focus:ring-red-300`}
            aria-label="Parar Geração de Áudio"
          >
            Parar Geração
          </button>
        ) : (
          <button
            onClick={handleGenerateAudio}
            disabled={isFormInvalid || overallLoading}
            className={`px-8 py-4 rounded-full text-white font-semibold text-xl shadow-lg hover:shadow-xl transform transition-all duration-300 hover:scale-105 active:scale-95
            ${isFormInvalid || overallLoading
                ? 'bg-gradient-to-r from-gray-600 to-gray-700 cursor-not-allowed shadow-md'
                : 'bg-gradient-to-r from-fuchsia-600 to-purple-700 hover:from-fuchsia-700 hover:to-purple-800 focus:outline-none focus:ring-4 focus:ring-fuchsia-400'
              }`}
            aria-label="Gerar Áudio"
          >
            Gerar Áudio
          </button>
        )}
      </div>
    </>
  );

  const renderCloneVoiceFeature = () => (
    <>
      <h2 className="text-3xl sm:text-4xl font-extrabold text-fuchsia-300 leading-tight drop-shadow-md text-center mb-8">
        Clonar Voz (Em breve)
      </h2>

      <div className="mb-6">
        <p className="text-xl text-yellow-300 font-semibold mb-4 text-center">
          ⚠️ Funcionalidade Limitada:
        </p>
        <p className="text-lg text-yellow-100 mb-6 text-center">
          A API Gemini atualmente não suporta a clonagem de voz arbitrária a partir de arquivos de áudio/vídeo enviados.
          As vozes disponíveis para geração de áudio são pré-definidas.
          Esta seção serve como um placeholder para uma futura integração, se a funcionalidade for liberada.
        </p>
      </div>

      {/* File Upload Area for Voice Cloning */}
      <div
        className={`mb-6 p-6 border-2 ${isDragging ? 'border-fuchsia-400 bg-purple-900' : 'border-dashed border-purple-600 bg-gray-800'} rounded-lg text-center cursor-pointer transition-all duration-300`}
        onDragOver={handleDragOver} // Reusing drag handlers
        onDragLeave={handleDragLeave}
        onDrop={(e) => { // Specific drop handler for clone voice
          e.preventDefault();
          setIsDragging(false);
          const files = e.dataTransfer.files;
          if (files && files.length > 0) {
            handleCloneFileChange({ target: { files: files } } as React.ChangeEvent<HTMLInputElement>);
          }
        }}
        onClick={() => cloneFileInputRef.current?.click()}
        aria-label="Área para arrastar e soltar arquivos de áudio (.mp3, .wav) ou vídeo (.avi, .mp4) para clonagem de voz."
        role="button"
        tabIndex={0}
        style={{ pointerEvents: overallLoading ? 'none' : 'auto' }}
      >
        <input
          type="file"
          ref={cloneFileInputRef}
          onChange={handleCloneFileChange}
          className="hidden"
          accept=".mp3,.wav,.ogg,.avi,.mp4,.mov" // Updated accepted file types
          disabled={overallLoading}
        />
        <p className="text-xl font-semibold text-fuchsia-200 mb-2">
          {uploadedMediaFile ? '✅ Arquivo Carregado:' : '🎤 Arraste e solte um arquivo de áudio/vídeo aqui'}
        </p>
        {uploadedMediaFile ? (
          <div className="mt-2 text-purple-300">
            <span className="font-medium">{uploadedMediaFile.name}</span>
            {uploadedMediaDuration !== null && (
              <span className="ml-2">({formatTime(uploadedMediaDuration)})</span>
            )}
            <p className="text-sm text-purple-400 mt-1">Tamanho: {(uploadedMediaFile.size / (1024 * 1024)).toFixed(2)} MB</p>
            <p className="text-sm text-purple-400">Formatos aceitos: MP3, WAV, OGG, AVI, MP4, MOV. Duração máxima de 3 horas.</p>
          </div>
        ) : (
          <p className="text-purple-400">ou clique para selecionar (MP3, WAV, OGG, AVI, MP4, MOV, até 3 horas)</p>
        )}
      </div>

      {cloneVoiceError && (
        <div className="bg-red-800 border border-red-600 text-red-200 px-4 py-3 rounded-lg relative mb-6" role="alert">
          <strong className="font-bold">Erro na Clonagem: </strong>
          <span className="block sm:inline">{cloneVoiceError}</span>
        </div>
      )}

      {overallLoading && ( // Show spinner for cloning process
        <LoadingSpinner message={spinnerMessage} />
      )}

      <div className="mt-auto flex justify-center">
        <button
          onClick={handleCloneVoice}
          disabled={!uploadedMediaFile || overallLoading}
          className={`px-8 py-4 rounded-full text-white font-semibold text-xl shadow-lg hover:shadow-xl transform transition-all duration-300 hover:scale-105 active:scale-95
            ${(!uploadedMediaFile || overallLoading)
              ? 'bg-gradient-to-r from-gray-600 to-gray-700 cursor-not-allowed shadow-md'
              : 'bg-gradient-to-r from-fuchsia-600 to-purple-700 hover:from-fuchsia-700 hover:to-purple-800 focus:outline-none focus:ring-4 focus:ring-fuchsia-400'
            }`}
          aria-label="Clonar Voz"
        >
          {isCloningVoice ? 'Analisando Voz...' : 'Clonar Voz'}
        </button>
      </div>
    </>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Tab Navigation for Audio Sub-features */}
      <div className="flex justify-center mb-8">
        <button
          onClick={() => setActiveAudioView('generateAudio')}
          className={`px-6 py-3 rounded-l-full text-lg font-semibold transition-all duration-300
            ${activeAudioView === 'generateAudio'
              ? 'bg-gradient-to-r from-fuchsia-600 to-purple-700 text-white shadow-lg'
              : 'bg-gray-800 text-purple-200 hover:bg-gray-700'
            }
            focus:outline-none focus:ring-2 focus:ring-fuchsia-400 focus:ring-opacity-75`}
          disabled={overallLoading}
          aria-selected={activeAudioView === 'generateAudio'}
          role="tab"
        >
          Gerar Áudio
        </button>
        <button
          onClick={() => setActiveAudioView('cloneVoice')}
          className={`px-6 py-3 rounded-r-full text-lg font-semibold transition-all duration-300
            ${activeAudioView === 'cloneVoice'
              ? 'bg-gradient-to-r from-fuchsia-600 to-purple-700 text-white shadow-lg'
              : 'bg-gray-800 text-purple-200 hover:bg-gray-700'
            }
            focus:outline-none focus:ring-2 focus:ring-fuchsia-400 focus:ring-opacity-75`}
          disabled={overallLoading}
          aria-selected={activeAudioView === 'cloneVoice'}
          role="tab"
        >
          Clonar Voz
        </button>
      </div>

      {/* Render active sub-feature */}
      {activeAudioView === 'generateAudio' ? renderAudioGenerator() : renderCloneVoiceFeature()}
    </div>
  );
};

export default AudioGenerator;
