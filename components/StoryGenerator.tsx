
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { geminiService } from '../services/geminiService';
import { WORDS_PER_MINUTE, TARGET_READING_TIME_MINUTES, CHUNK_WORD_COUNT_TARGET } from '../constants';
import LoadingSpinner from './LoadingSpinner';
// Fix: Import AUDIO_PREVIEW_TEXT from appUtils
import { calculateReadingTime, sanitizeStoryText, trimIntroductoryPhrases, languageOptions, toneOptions, AUDIO_PREVIEW_TEXT, VOICE_TONE_MAP } from '../utils/appUtils';
import { useAudioPlayer } from '../hooks/useAudioPlayer'; // NEW


const StoryGenerator: React.FC = () => {
  const initialTitle = 'A Aventura Esquecida do Rei Arthur';
  const [story, setStory] = useState<string>('');
  const [title, setTitle] = useState<string>(initialTitle);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [currentWordCount, setCurrentWordCount] = useState<number>(0);
  const [currentReadingTime, setCurrentReadingTime] = useState<number>(0);
  const [isGeneratingManuallyStopped, setIsGeneratingManuallyStopped] = useState<boolean>(false);
  const [targetReadingTimeMinutes, setTargetReadingTimeMinutes] = useState<number>(TARGET_READING_TIME_MINUTES);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('pt');
  const [selectedTone, setSelectedTone] = useState<string>('Neutro'); // NEW: State for selected tone
  const [leadText, setLeadText] = useState<string>(''); // NEW: State for optional lead text

  // NEW: Audio preview states and hook
  const [toneAudioBuffers, setToneAudioBuffers] = useState<Record<string, AudioBuffer>>({});
  const [loadingPreviewTone, setLoadingPreviewTone] = useState<string | null>(null);
  // Fix: Corrected destructuring syntax error 'stopAudio: stopAudio: stopPreviewAudio' to 'stopAudio: stopPreviewAudio'
  const [{ isPlaying: isPreviewPlaying, error: previewError }, { playAudio: playPreviewAudio, stopAudio: stopPreviewAudio }] = useAudioPlayer();


  const storyEndRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef<boolean>(true);
  const storyContentRef = useRef<string>('');
  const stopGenerationRef = useRef<boolean>(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopGenerationRef.current = true;
    };
  }, []);

  useEffect(() => {
    storyContentRef.current = story;
  }, [story]);

  const generateNextChunkLoop = useCallback(async () => {
    if (!isMountedRef.current || stopGenerationRef.current) {
      setIsLoading(false);
      return;
    }

    if (currentReadingTime >= targetReadingTimeMinutes) {
      setIsLoading(false);
      setIsGeneratingManuallyStopped(false);
      return;
    }
    if (error) {
      setIsLoading(false);
      return;
    }

    try {
      const currentFullStory = storyContentRef.current;
      const estimatedNextChunkReadingTime = CHUNK_WORD_COUNT_TARGET / WORDS_PER_MINUTE;
      const currentTotalReadingTime = calculateReadingTime(currentFullStory).readingTimeMinutes;
      const isConcludingChunk = (currentTotalReadingTime + estimatedNextChunkReadingTime >= targetReadingTimeMinutes);

      const newChunk = await geminiService.generateStoryChunk(title, currentFullStory, isConcludingChunk, selectedLanguage, selectedTone, leadText); // Pass selectedTone and leadText

      if (!isMountedRef.current || stopGenerationRef.current) {
        setIsLoading(false);
        return;
      }
      if (!newChunk) {
        setError("Recebido um trecho de história vazio durante a continuação.");
        setIsLoading(false);
        return;
      }

      const sanitizedNewChunk = sanitizeStoryText(newChunk);

      setStory(prevStory => {
        const updatedStory = prevStory + (prevStory ? `\n\n${sanitizedNewChunk}` : sanitizedNewChunk);
        const { wordCount, readingTimeMinutes: newReadingTime } = calculateReadingTime(updatedStory);
        setCurrentWordCount(wordCount);
        setCurrentReadingTime(newReadingTime);

        if (newReadingTime < targetReadingTimeMinutes && !stopGenerationRef.current) {
          setTimeout(generateNextChunkLoop, 1000);
        } else {
          setIsLoading(false);
          if (newReadingTime >= targetReadingTimeMinutes) {
            setIsGeneratingManuallyStopped(false);
          }
        }
        return updatedStory;
      });

    } catch (err: unknown) {
      if (!isMountedRef.current || stopGenerationRef.current) return;
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Ocorreu um erro inesperado ao gerar a história.");
      }
      setIsLoading(false);
    }
  }, [title, currentReadingTime, error, isMountedRef, targetReadingTimeMinutes, selectedLanguage, selectedTone, leadText]); // Added leadText to dependencies

  const handleGenerateFullStory = useCallback(async () => {
    if (isLoading) return;

    setIsLoading(true);
    setError(null);
    setStory('');
    setCurrentWordCount(0);
    setCurrentReadingTime(0);
    storyContentRef.current = '';
    stopGenerationRef.current = false;
    setIsGeneratingManuallyStopped(false);
    stopPreviewAudio(); // Stop any playing preview audio when starting new story generation

    try {
      const estimatedNextChunkReadingTime = CHUNK_WORD_COUNT_TARGET / WORDS_PER_MINUTE;
      const isConcludingChunk = (0 + estimatedNextChunkReadingTime >= targetReadingTimeMinutes);

      let firstChunk = await geminiService.generateStoryChunk(title, '', isConcludingChunk, selectedLanguage, selectedTone, leadText); // Pass selectedTone and leadText

      if (!isMountedRef.current || stopGenerationRef.current) {
        setIsLoading(false);
        return;
      }
      if (!firstChunk) {
        setError("Recebido um primeiro trecho vazio.");
        setIsLoading(false);
        return;
      }

      let processedFirstChunk = sanitizeStoryText(firstChunk);
      processedFirstChunk = trimIntroductoryPhrases(processedFirstChunk, title);


      setStory(processedFirstChunk);
      const { wordCount, readingTimeMinutes: newReadingTime } = calculateReadingTime(processedFirstChunk);
      setCurrentWordCount(wordCount);
      setCurrentReadingTime(newReadingTime);

      if (newReadingTime < targetReadingTimeMinutes && !stopGenerationRef.current) {
        setTimeout(generateNextChunkLoop, 1000);
      } else {
        setIsLoading(false);
        if (newReadingTime >= targetReadingTimeMinutes) {
          setIsGeneratingManuallyStopped(false);
        }
      }

    } catch (err: unknown) {
      if (!isMountedRef.current || stopGenerationRef.current) return;
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Ocorreu um erro inesperado ao gerar o primeiro trecho.");
      }
      setIsLoading(false);
    }
  }, [isLoading, title, isMountedRef, generateNextChunkLoop, targetReadingTimeMinutes, selectedLanguage, selectedTone, leadText, stopPreviewAudio]); // Added selectedTone, leadText and stopPreviewAudio to dependencies

  const handleStopGeneration = useCallback(() => {
    stopGenerationRef.current = true;
    setIsGeneratingManuallyStopped(true);
    setIsLoading(false);
  }, []);

  const handleCopyStory = useCallback(() => {
    if (story) {
      navigator.clipboard.writeText(story).then(() => {
        console.log('Story copied to clipboard!');
      }).catch(err => {
        console.error('Failed to copy story:', err);
      });
    }
  }, [story]);

  const handleDownloadStory = useCallback(() => {
    if (story) {
      const sanitizedTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 50);
      const filename = `${sanitizedTitle || 'historia_gerada'}.txt`;
      const blob = new Blob([story], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, [story, title]);

  // NEW: Handle playing tone preview
  const handlePlayTonePreview = useCallback(async () => {
    if (!selectedTone) {
      setError("Por favor, selecione um tom para pré-visualizar."); // Using main error for now, could be separate
      return;
    }

    if (isPreviewPlaying) {
      stopPreviewAudio(); // Stop if already playing
      if (loadingPreviewTone === selectedTone) {
          // If already loading this tone, and we stop it, don't try to load it again immediately
          setLoadingPreviewTone(null);
          return;
      }
    }

    // If the audio buffer is already cached, play it directly
    if (toneAudioBuffers[selectedTone]) {
      playPreviewAudio(toneAudioBuffers[selectedTone]);
      return;
    }

    // Otherwise, load it
    setLoadingPreviewTone(selectedTone);
    setError(null); // Clear main error before loading preview
    // Clear preview-specific error
    // For now, using the main error state, but it could be separated.

    try {
      const voiceName = VOICE_TONE_MAP[selectedTone];
      if (!voiceName) {
          setError(`Nenhuma voz definida para o tom "${selectedTone}".`);
          setLoadingPreviewTone(null);
          return;
      }
      const audioBuffer = await geminiService.generateSpeech(AUDIO_PREVIEW_TEXT, voiceName, {
          maxRetries: 1, // Only one retry for preview for faster feedback
          initialDelayMs: 500,
          onRetryWait: (delay, retriesLeft, errMsg) => {
            setError(`Retentando prévia (em ${delay / 1000}s)... ${retriesLeft} tentativas restantes. ${errMsg}`);
          }
      });

      setToneAudioBuffers(prev => ({ ...prev, [selectedTone]: audioBuffer }));
      playPreviewAudio(audioBuffer);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(`Erro ao carregar prévia do áudio: ${err.message}`);
      } else {
        setError("Ocorreu um erro inesperado ao carregar a prévia do áudio.");
      }
    } finally {
      setLoadingPreviewTone(null);
    }
  }, [selectedTone, isPreviewPlaying, playPreviewAudio, stopPreviewAudio, toneAudioBuffers, loadingPreviewTone]);


  useEffect(() => {
    if (storyEndRef.current) {
      storyEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [story]);

  const formattedReadingTime = currentReadingTime.toFixed(1);
  const progressPercentage = Math.min(100, (currentReadingTime / targetReadingTimeMinutes) * 100);

  const isStoryComplete = currentReadingTime >= targetReadingTimeMinutes && !isLoading && !isGeneratingManuallyStopped;

  const mainButtonText = isLoading
    ? 'Gerando...'
    : isStoryComplete || isGeneratingManuallyStopped
      ? 'Gerar Nova História'
      : 'Gerar História Completa';

  // Disable inputs and buttons when main story generation is loading OR audio preview is loading/playing
  const inputAndButtonDisabledDuringLoad = isLoading || loadingPreviewTone !== null || isPreviewPlaying;


  return (
    <div className="flex flex-col h-full">
      <h2 className="text-3xl sm:text-4xl font-extrabold text-fuchsia-300 leading-tight drop-shadow-md text-center mb-8">
        Gerador de Histórias
      </h2>

      <div className="mb-6">
        <label htmlFor="storyTitle" className="block text-xl font-semibold text-purple-300 mb-2">
          Gerar História Para O Titulo:
        </label>
        <input
          id="storyTitle"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full p-3 border border-purple-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-400 text-lg bg-gray-800 disabled:bg-gray-700 disabled:text-gray-400 shadow-sm text-white placeholder-purple-400"
          placeholder="Gerar Historia para o Titulo"
          disabled={inputAndButtonDisabledDuringLoad}
          aria-label="Título da história"
        />
      </div>

      {/* NEW: Optional Lead Text Input */}
      <div className="mb-6">
        <label htmlFor="leadTextInput" className="block text-xl font-semibold text-purple-300 mb-2">
          Início do Documentário/Lead (Opcional):
        </label>
        <textarea
          id="leadTextInput"
          value={leadText}
          onChange={(e) => setLeadText(e.target.value)}
          className="w-full p-3 border border-purple-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-400 text-lg bg-gray-800 disabled:bg-gray-700 disabled:text-gray-400 shadow-sm text-white placeholder-purple-400 min-h-[80px]"
          placeholder="Ex: Em um mundo onde a magia se entrelaça com a tecnologia, um segredo antigo jaz esquecido..."
          rows={3}
          disabled={inputAndButtonDisabledDuringLoad}
          aria-label="Texto opcional para iniciar o lead da história"
        />
        <p className="text-sm text-purple-400 mt-2">
          Este texto será usado como o começo do seu documentário ou história, se fornecido.
        </p>
      </div>

      <div className="mb-6">
        <label htmlFor="storyLanguage" className="block text-xl font-semibold text-purple-300 mb-2">
          Idioma da História:
        </label>
        <select
          id="storyLanguage"
          value={selectedLanguage}
          onChange={(e) => setSelectedLanguage(e.target.value)}
          className="w-full p-3 border border-purple-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-400 text-lg bg-gray-800 disabled:bg-gray-700 disabled:text-gray-400 shadow-sm text-white"
          disabled={inputAndButtonDisabledDuringLoad}
          aria-label="Selecione o idioma da história"
        >
          {languageOptions.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.name}
            </option>
          ))}
        </select>
      </div>

      {/* NEW: Tone Selection Dropdown with preview button */}
      <div className="mb-6">
        <label htmlFor="storyTone" className="block text-xl font-semibold text-purple-300 mb-2">
          Tom da História:
        </label>
        <div className="flex items-center space-x-2"> {/* Added flex container */}
          <select
            id="storyTone"
            value={selectedTone}
            onChange={(e) => setSelectedTone(e.target.value)}
            className="w-full p-3 border border-purple-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-400 text-lg bg-gray-800 disabled:bg-gray-700 disabled:text-gray-400 shadow-sm text-white"
            disabled={inputAndButtonDisabledDuringLoad}
            aria-label="Selecione o tom da história"
          >
            {toneOptions.map((tone) => (
              <option key={tone.value} value={tone.value}>
                {tone.label}
              </option>
            ))}
          </select>
          <button
            onClick={handlePlayTonePreview}
            disabled={inputAndButtonDisabledDuringLoad || loadingPreviewTone !== null || !selectedTone}
            className={`
              px-4 py-2 rounded-full text-white font-semibold text-sm shadow-md transition-all duration-300
              ${(loadingPreviewTone !== null || inputAndButtonDisabledDuringLoad || !selectedTone)
                ? 'bg-gray-600 cursor-not-allowed opacity-70'
                : isPreviewPlaying
                  ? 'bg-red-500 hover:bg-red-600'
                  : 'bg-green-500 hover:bg-green-600'
              }
              focus:outline-none focus:ring-2 focus:ring-green-300
            `}
            aria-label={isPreviewPlaying ? "Parar prévia do tom" : "Ouvir prévia do tom"}
            title={isPreviewPlaying ? "Parar prévia do tom" : "Ouvir prévia do tom"}
          >
            {loadingPreviewTone !== null ? 'Carregando...' : isPreviewPlaying ? '⏹️ Parar' : '▶️ Ouvir'}
          </button>
        </div>
        {previewError && ( // Display preview specific errors
            <div className="bg-red-800 border border-red-600 text-red-200 px-4 py-3 rounded-lg relative mt-2 text-sm" role="alert">
              <strong className="font-bold">Erro na prévia: </strong>
              <span className="block sm:inline">{previewError}</span>
            </div>
        )}
      </div>

      {error && (
        <div className="bg-red-800 border border-red-600 text-red-200 px-4 py-3 rounded-lg relative mb-6" role="alert">
          <strong className="font-bold">Erro: </strong>
          <span className="block sm:inline">{error}</span>
        </div>
      )}

      {story && (
        <div className="bg-gray-800 p-6 rounded-xl shadow-inner flex-grow overflow-y-auto mb-6 max-h-[60vh] sm:max-h-[70vh] relative border border-purple-700">
          <h3 className="text-2xl font-bold text-fuchsia-300 mb-4">A História:</h3>
          <div className="whitespace-pre-wrap leading-relaxed text-gray-200 text-lg" aria-live="polite">
            {story}
            <div ref={storyEndRef}></div>
          </div>
        </div>
      )}

      {isLoading && <LoadingSpinner />}

      <footer className="mt-auto p-4 bg-gray-800 rounded-xl shadow-md border border-purple-700">
        <div className="flex flex-col space-y-6">

          <div className="flex flex-col sm:flex-row items-center justify-between space-y-4 sm:space-y-0 sm:space-x-4">
            <div className="text-lg text-purple-300 font-medium flex flex-col sm:flex-row items-center space-y-2 sm:space-y-0 sm:space-x-4">
              <div className="flex items-center space-x-2">
                <label htmlFor="targetReadingTime" className="text-fuchsia-200">
                  Tempo de leitura:
                </label>
                <span className="font-bold text-purple-300">{formattedReadingTime} min</span>
                {' '}
                <input
                  id="targetReadingTime"
                  type="number"
                  value={targetReadingTimeMinutes}
                  onChange={(e) => setTargetReadingTimeMinutes(Number(e.target.value))}
                  className="w-20 p-1 border border-purple-600 rounded-lg focus:outline-none focus:ring-1 focus:ring-fuchsia-400 text-base text-center bg-gray-800 disabled:bg-gray-700 disabled:text-gray-400 text-white"
                  min="5"
                  max="180"
                  step="5"
                  aria-label="Definir tempo de leitura desejado em minutos"
                  disabled={inputAndButtonDisabledDuringLoad}
                />
                <span className="text-sm text-purple-400"> (min alvo)</span>
              </div>
            </div>
            <div className="w-full sm:flex-1 bg-purple-800 rounded-full h-3 relative" role="progressbar" aria-valuenow={progressPercentage} aria-valuemin={0} aria-valuemax={100} aria-label={`Progresso da geração da história: ${progressPercentage.toFixed(1)}%`}>
              <div
                className="bg-gradient-to-r from-purple-500 to-indigo-600 h-3 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progressPercentage}%` }}
                title={`Progresso: ${progressPercentage.toFixed(1)}%`}
              ></div>
              <span className="absolute text-xs text-fuchsia-200 -top-4 left-1/2 -translate-x-1/2">
                {progressPercentage.toFixed(0)}%
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between space-y-4 sm:space-y-0">
            <div className="flex justify-center space-x-4 w-full sm:w-auto">
              {isLoading && (
                <button
                  onClick={handleStopGeneration}
                  className={`px-6 py-3 rounded-full text-white font-semibold text-lg
                    bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 focus:outline-none focus:ring-4 focus:ring-red-300 shadow-lg hover:shadow-xl transform transition-all duration-300 hover:scale-105 active:scale-95`}
                  aria-label="Parar geração de história"
                >
                  Parar História
                </button>
              )}

              <button
                onClick={handleGenerateFullStory}
                disabled={inputAndButtonDisabledDuringLoad}
                className={`px-6 py-3 rounded-full text-white font-semibold text-lg shadow-lg hover:shadow-xl transform transition-all duration-300 hover:scale-105 active:scale-95
                  ${inputAndButtonDisabledDuringLoad
                    ? 'bg-gradient-to-r from-gray-600 to-gray-700 cursor-not-allowed shadow-md'
                    : 'bg-gradient-to-r from-fuchsia-600 to-purple-700 hover:from-fuchsia-700 hover:to-purple-800 focus:outline-none focus:ring-4 focus:ring-fuchsia-400'
                  }`}
                aria-label={mainButtonText}
              >
                {mainButtonText}
              </button>
            </div>

            {story && (
              <div className="flex flex-col sm:flex-row items-center space-y-4 sm:space-y-0 sm:space-x-4 w-full sm:w-auto bg-gray-900 p-4 rounded-xl shadow-inner border border-purple-700">
                <div className="flex flex-col items-center space-y-2 w-full sm:w-auto">
                  <button
                    onClick={handleCopyStory}
                    className="px-6 py-3 rounded-full bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600 focus:outline-none focus:ring-4 focus:ring-cyan-300 text-white font-semibold text-lg shadow-lg hover:shadow-xl transform transition-all duration-300 hover:scale-105 active:scale-95 w-full flex items-center justify-center space-x-2"
                    title="Copiar texto da história"
                    aria-label="Copiar texto da história"
                  >
                    <span className="text-xl">📋</span>
                    <span>Copiar História</span>
                  </button>
                  {isStoryComplete && (
                    <p className="text-center text-emerald-400 font-extrabold text-lg">Projeto Finalizado!</p>
                  )}
                </div>
                <button
                  onClick={handleDownloadStory}
                  className="px-6 py-3 rounded-full bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-300 text-white font-semibold text-lg shadow-lg hover:shadow-xl transform transition-all duration-300 hover:scale-105 active:scale-95 w-full sm:w-auto flex items-center justify-center space-x-2"
                  title="Baixar história em arquivo de texto"
                  aria-label="Baixar história em arquivo de texto"
                >
                  <span className="text-xl">⬇️</span>
                  <span>Download da História</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
};

export default StoryGenerator;