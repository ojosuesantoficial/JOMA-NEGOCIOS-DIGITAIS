

import React, { useState, useCallback } from 'react';
import { geminiService } from '../services/geminiService';
import LoadingSpinner from './LoadingSpinner';
import { languageOptions } from '../utils/appUtils';

const ImageGenerator: React.FC = () => {
  const [prompt, setPrompt] = useState<string>('');
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('pt');
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<'1:1' | '16:9' | '9:16'>('1:1'); // NEW: State for aspect ratio

  const handleGenerateImage = useCallback(async () => {
    if (isLoading) return;
    setError(null);
    setGeneratedImageUrl(null);
    setIsLoading(true);

    if (!prompt.trim()) {
      setError("Por favor, insira um prompt para gerar a imagem.");
      setIsLoading(false);
      return;
    }

    try {
      // Note: The image generation model doesn't directly support language config in prompt,
      // but we can hint it in the prompt for better understanding.
      const localizedPrompt = `(${languageOptions.find(l => l.code === selectedLanguage)?.name || 'Português'}) ${prompt}`;
      // FIX: Changed generateImageFromPrompt to generateImage to match the service method
      const imageUrl = await geminiService.generateImage(localizedPrompt, selectedAspectRatio); // Pass selectedAspectRatio
      setGeneratedImageUrl(imageUrl);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Ocorreu um erro inesperado ao gerar a imagem.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [prompt, selectedLanguage, selectedAspectRatio, isLoading]); // Added selectedAspectRatio to dependencies

  return (
    <div className="flex flex-col h-full">
      <h2 className="text-3xl sm:text-4xl font-extrabold text-fuchsia-300 leading-tight drop-shadow-md text-center mb-8">
        Gerador de Imagens
      </h2>

      <div className="mb-6">
        <label htmlFor="imagePrompt" className="block text-xl font-semibold text-purple-300 mb-2">
          Descreva a Imagem:
        </label>
        <textarea
          id="imagePrompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="w-full p-3 border border-purple-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-400 text-lg bg-gray-800 disabled:bg-gray-700 disabled:text-gray-400 shadow-sm text-white placeholder-purple-400 min-h-[120px]"
          placeholder="Uma paisagem surreal com montanhas flutuantes e rios de néon."
          rows={5}
          disabled={isLoading}
          aria-label="Prompt para gerar imagem"
        />
      </div>

      <div className="mb-6">
        <label htmlFor="imageLanguage" className="block text-xl font-semibold text-purple-300 mb-2">
          Idioma do Prompt:
        </label>
        <select
          id="imageLanguage"
          value={selectedLanguage}
          onChange={(e) => setSelectedLanguage(e.target.value)}
          className="w-full p-3 border border-purple-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-400 text-lg bg-gray-800 disabled:bg-gray-700 disabled:text-gray-400 shadow-sm text-white"
          disabled={isLoading}
          aria-label="Selecione o idioma do prompt da imagem"
        >
          {languageOptions.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.name}
            </option>
          ))}
        </select>
      </div>

      {/* NEW: Aspect Ratio Selector */}
      <div className="mb-6">
        <label htmlFor="imageAspectRatio" className="block text-xl font-semibold text-purple-300 mb-2">
          Proporção da Imagem:
        </label>
        <select
          id="imageAspectRatio"
          value={selectedAspectRatio}
          onChange={(e) => setSelectedAspectRatio(e.target.value as '1:1' | '16:9' | '9:16')}
          className="w-full p-3 border border-purple-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-400 text-lg bg-gray-800 disabled:bg-gray-700 disabled:text-gray-400 shadow-sm text-white"
          disabled={isLoading}
          aria-label="Selecione a proporção da imagem"
        >
          <option value="1:1">Quadrado (1:1)</option>
          <option value="16:9">Paisagem (16:9)</option>
          <option value="9:16">Reels/Retrato (9:16)</option>
        </select>
      </div>

      {error && (
        <div className="bg-red-800 border border-red-600 text-red-200 px-4 py-3 rounded-lg relative mb-6" role="alert">
          <strong className="font-bold">Erro: </strong>
          <span className="block sm:inline">{error}</span>
        </div>
      )}

      {isLoading && <LoadingSpinner />}

      {generatedImageUrl && !isLoading && (
        <div className="bg-gray-800 p-6 rounded-xl shadow-inner mb-6 border border-purple-700 flex-grow flex items-center justify-center">
          <h3 className="text-2xl font-bold text-fuchsia-300 sr-only">Imagem Gerada:</h3>
          <img src={generatedImageUrl} alt="Imagem gerada por IA" className="max-w-full h-auto rounded-lg shadow-md max-h-[500px]" />
        </div>
      )}

      <div className="mt-auto flex justify-center">
        <button
          onClick={handleGenerateImage}
          disabled={isLoading || !prompt.trim()}
          className={`px-8 py-4 rounded-full text-white font-semibold text-xl shadow-lg hover:shadow-xl transform transition-all duration-300 hover:scale-105 active:scale-95
            ${isLoading || !prompt.trim()
              ? 'bg-gradient-to-r from-gray-600 to-gray-700 cursor-not-allowed shadow-md'
              : 'bg-gradient-to-r from-fuchsia-600 to-purple-700 hover:from-fuchsia-700 hover:to-purple-800 focus:outline-none focus:ring-4 focus:ring-fuchsia-400'
            }`}
          aria-label="Gerar Imagem"
        >
          {isLoading ? 'Gerando Imagem...' : 'Gerar Imagem'}
        </button>
      </div>
    </div>
  );
};

export default ImageGenerator;