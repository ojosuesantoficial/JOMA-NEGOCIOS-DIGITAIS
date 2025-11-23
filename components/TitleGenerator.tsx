import React, { useState, useCallback, useRef, useEffect } from 'react';
import { geminiService } from '../services/geminiService';
import LoadingSpinner from './LoadingSpinner';
import { languageOptions } from '../utils/appUtils';

// Helper function to convert File to Base64
const fileToBase64 = (file: File): Promise<{ base64: string; mimeType: string; blobUrl: string }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const [mimePart, dataPart] = reader.result.split(',');
        const mimeType = mimePart.split(':')[1].split(';')[0];
        const blobUrl = URL.createObjectURL(file); // Create object URL for thumbnail
        resolve({ base64: dataPart, mimeType, blobUrl });
      } else {
        reject(new Error("Falha ao ler o arquivo como URL de dados."));
      }
    };
    reader.onerror = (error) => reject(error);
  });
};

const TitleGenerator: React.FC = () => {
  const [selectedImage, setSelectedImage] = useState<{ base64: string; mimeType: string; blobUrl: string } | null>(null);
  const [numTitles, setNumTitles] = useState<number>(7); // Default to 7 titles as requested
  const [generatedTitles, setGeneratedTitles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('pt'); // Default to Portuguese

  const [isDragging, setIsDragging] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clean up Blob URLs on component unmount or image change
  useEffect(() => {
    return () => {
      if (selectedImage?.blobUrl) {
        URL.revokeObjectURL(selectedImage.blobUrl);
      }
    };
  }, [selectedImage]);

  // Effect to handle paste events
  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      if (isLoading) return; // Do not process paste if already loading

      const items = event.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/')) {
            event.preventDefault(); // Prevent default paste behavior
            setError(null);
            try {
              const file = item.getAsFile();
              if (file) {
                const { base64, mimeType, blobUrl } = await fileToBase64(file);
                // Revoke previous blob URL if exists
                if (selectedImage?.blobUrl) {
                  URL.revokeObjectURL(selectedImage.blobUrl);
                }
                setSelectedImage({ base64, mimeType, blobUrl });
              }
            } catch (e: any) {
              setError(`Erro ao colar a imagem: ${e.message}`);
              setSelectedImage(null);
            }
            return; // Process only the first image found
          }
        }
      }
    };

    document.body.addEventListener('paste', handlePaste);
    return () => {
      document.body.removeEventListener('paste', handlePaste);
    };
  }, [isLoading, selectedImage]);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      setError(null);
      try {
        const { base64, mimeType, blobUrl } = await fileToBase64(files[0]);
        // Revoke previous blob URL if exists
        if (selectedImage?.blobUrl) {
          URL.revokeObjectURL(selectedImage.blobUrl);
        }
        setSelectedImage({ base64, mimeType, blobUrl });
      } catch (e: any) {
        setError(`Erro ao carregar a imagem: ${e.message}`);
        setSelectedImage(null);
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''; // Reset input to allow re-uploading the same file
    }
  }, [selectedImage]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      setError(null);
      try {
        const { base64, mimeType, blobUrl } = await fileToBase64(files[0]);
        if (selectedImage?.blobUrl) {
          URL.revokeObjectURL(selectedImage.blobUrl);
        }
        setSelectedImage({ base64, mimeType, blobUrl });
      } catch (e: any) {
        setError(`Erro ao carregar a imagem: ${e.message}`);
        setSelectedImage(null);
      }
    }
  }, [selectedImage]);

  const handleClearImage = useCallback(() => {
    if (selectedImage?.blobUrl) {
      URL.revokeObjectURL(selectedImage.blobUrl);
    }
    setSelectedImage(null);
    setGeneratedTitles([]); // Clear generated titles when image is cleared
  }, [selectedImage]);

  const handleGenerateTitles = useCallback(async () => {
    if (isLoading) return;
    setError(null);
    setGeneratedTitles([]);
    setIsLoading(true);

    if (!selectedImage) {
      setError("Por favor, carregue uma imagem para gerar títulos.");
      setIsLoading(false);
      return;
    }
    if (numTitles < 5 || numTitles > 10) { // Changed range to 5-10
      setError("O número de títulos deve ser entre 5 e 10.");
      setIsLoading(false);
      return;
    }

    try {
      const titles = await geminiService.generateTitlesFromImage( // Call new service method
        selectedImage.base64,
        selectedImage.mimeType,
        numTitles,
        selectedLanguage
      );
      setGeneratedTitles(titles);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Ocorreu um erro inesperado ao gerar os títulos.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [selectedImage, numTitles, selectedLanguage, isLoading]);

  const handleCopySingleTitle = useCallback((titleToCopy: string) => {
    if (titleToCopy) {
      navigator.clipboard.writeText(titleToCopy).then(() => {
        console.log('Title copied to clipboard!');
      }).catch(err => {
        console.error('Failed to copy title:', err);
        setError('Falha ao copiar o título.');
      });
    }
  }, []);

  const isFormInvalid = !selectedImage || numTitles < 5 || numTitles > 10;

  return (
    <div className="flex flex-col h-full">
      <h2 className="text-3xl sm:text-4xl font-extrabold text-fuchsia-300 leading-tight drop-shadow-md text-center mb-8">
        Gerador de Títulos Criativos
      </h2>

      {/* Image Input Area */}
      <div
        className={`mb-6 p-6 border-2 rounded-lg text-center cursor-pointer transition-all duration-300
          ${isDragging ? 'border-fuchsia-400 bg-purple-900' : selectedImage ? 'border-purple-700 bg-gray-800' : 'border-dashed border-purple-600 bg-gray-800'}
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        aria-label="Área para arrastar e soltar imagens, clicar para selecionar ou colar (Ctrl+V)"
        role="button"
        tabIndex={0}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
          accept="image/png, image/jpeg, image/webp"
          disabled={isLoading}
        />
        {selectedImage ? (
          <div className="flex flex-col items-center">
            <img src={selectedImage.blobUrl} alt="Imagem selecionada para análise" className="max-w-full h-auto max-h-48 rounded-lg shadow-md mb-4" />
            <p className="text-lg font-semibold text-fuchsia-200 mb-2">Imagem carregada.</p>
            <button
              onClick={(e) => { e.stopPropagation(); handleClearImage(); }}
              className="px-4 py-2 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors shadow-md mt-2"
              disabled={isLoading}
              aria-label="Remover imagem selecionada"
            >
              Remover Imagem
            </button>
          </div>
        ) : (
          <>
            <p className="text-xl font-semibold text-fuchsia-200 mb-2">🖼️ Arraste e solte uma imagem aqui</p>
            <p className="text-purple-400">ou clique para selecionar / cole (Ctrl+V)</p>
          </>
        )}
      </div>

      <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <label htmlFor="numTitles" className="block text-xl font-semibold text-purple-300 min-w-max">
          Quantidade de Títulos:
        </label>
        <input
          id="numTitles"
          type="number"
          value={numTitles}
          onChange={(e) => setNumTitles(Number(e.target.value))}
          className="w-24 p-3 border border-purple-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-400 text-lg bg-gray-800 disabled:bg-gray-700 disabled:text-gray-400 shadow-sm text-white text-center"
          min="5" // Min 5 as requested
          max="10"
          disabled={isLoading}
          aria-label="Quantidade de títulos a gerar"
        />
        <span className="text-sm text-purple-400">(5 a 10)</span>
      </div>

      <div className="mb-6">
        <label htmlFor="titleLanguage" className="block text-xl font-semibold text-purple-300 mb-2">
          Idioma dos Títulos:
        </label>
        <select
          id="titleLanguage"
          value={selectedLanguage}
          onChange={(e) => setSelectedLanguage(e.target.value)}
          className="w-full p-3 border border-purple-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-400 text-lg bg-gray-800 disabled:bg-gray-700 disabled:text-gray-400 shadow-sm text-white"
          disabled={isLoading}
          aria-label="Selecione o idioma dos títulos"
        >
          {languageOptions.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="bg-red-800 border border-red-600 text-red-200 px-4 py-3 rounded-lg relative mb-6" role="alert">
          <strong className="font-bold">Erro: </strong>
          <span className="block sm:inline">{error}</span>
        </div>
      )}

      {isLoading && <LoadingSpinner message="Analisando imagem e criando títulos..." />}

      {generatedTitles.length > 0 && !isLoading && (
        <div className="bg-gray-800 p-6 rounded-xl shadow-inner mb-6 border border-purple-700 flex-grow overflow-y-auto">
          <h3 className="text-2xl font-bold text-fuchsia-300 mb-4">Títulos Gerados:</h3>
          <ul className="list-none text-gray-200 text-lg space-y-3">
            {generatedTitles.map((title, index) => (
              <li key={index} className="flex items-start bg-gray-900 p-3 rounded-lg shadow-sm border border-purple-700 group relative">
                <span className="text-purple-400 font-bold mr-3">{index + 1}.</span>
                <span className="flex-grow">{title}</span>
                <button
                  onClick={() => handleCopySingleTitle(title)}
                  className="absolute top-1/2 -translate-y-1/2 right-3 p-2 bg-purple-500 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 focus:outline-none focus:ring-2 focus:ring-purple-400"
                  aria-label={`Copiar título ${index + 1}`}
                  title="Copiar título"
                >
                  📋
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto flex justify-center">
        <button
          onClick={handleGenerateTitles}
          disabled={isFormInvalid || isLoading}
          className={`px-8 py-4 rounded-full text-white font-semibold text-xl shadow-lg hover:shadow-xl transform transition-all duration-300 hover:scale-105 active:scale-95
            ${isFormInvalid || isLoading
              ? 'bg-gradient-to-r from-gray-600 to-gray-700 cursor-not-allowed shadow-md'
              : 'bg-gradient-to-r from-fuchsia-600 to-purple-700 hover:from-fuchsia-700 hover:to-purple-800 focus:outline-none focus:ring-4 focus:ring-fuchsia-400'
            }`}
          aria-label="Gerar Títulos"
        >
          {isLoading ? 'Gerando Títulos...' : 'Gerar Títulos'}
        </button>
      </div>
    </div>
  );
};

export default TitleGenerator;